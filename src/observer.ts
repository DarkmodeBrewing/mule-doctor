/**
 * observer.ts
 * Periodic observation loop: polls the rust-mule node, runs LLM analysis,
 * and posts the result to Mattermost on a configurable cadence.
 */

import type { Analyzer } from "./llm/analyzer.js";
import type { MattermostClient } from "./integrations/mattermost.js";
import type { RustMuleClient } from "./api/rustMuleClient.js";
import type { LogWatcher } from "./logs/logWatcher.js";
import type { RuntimeStore } from "./storage/runtimeStore.js";
import type { HistoryEntry, RuntimeState } from "./types/contracts.js";
import { getNetworkHealth } from "./health/healthScore.js";
import type { NetworkHealthResult } from "./health/healthScore.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface ObserverConfig {
  intervalMs?: number;
  client?: RustMuleClient;
  logWatcher?: LogWatcher;
  runtimeStore?: RuntimeStore;
}

interface ObserverCycleContext {
  nodeInfo: Record<string, unknown>;
  peerCount: number;
  routingBucketCount: number;
  lookupStats: Record<string, unknown>;
  networkHealth: NetworkHealthResult;
  recentHistory: HistoryEntry[];
}

export class Observer {
  private readonly analyzer: Analyzer;
  private readonly mattermost: MattermostClient;
  private readonly intervalMs: number;
  private readonly client: RustMuleClient | undefined;
  private readonly logWatcher: LogWatcher | undefined;
  private readonly runtimeStore: RuntimeStore | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    analyzer: Analyzer,
    mattermost: MattermostClient,
    config: ObserverConfig = {}
  ) {
    this.analyzer = analyzer;
    this.mattermost = mattermost;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.client = config.client;
    this.logWatcher = config.logWatcher;
    this.runtimeStore = config.runtimeStore;
  }

  /** Start the periodic observation loop. */
  start(): void {
    log("info", "observer", `Starting observation loop (interval: ${this.intervalMs}ms)`);
    // Run immediately, then on a fixed cadence.
    this.runCycle().catch((err) =>
      log("error", "observer", `Cycle error: ${String(err)}`)
    );
    this.timer = setInterval(() => {
      this.runCycle().catch((err) =>
        log("error", "observer", `Cycle error: ${String(err)}`)
      );
    }, this.intervalMs);
  }

  /** Stop the observation loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    log("info", "observer", "Stopped");
  }

  private async runCycle(): Promise<void> {
    log("info", "observer", "Running diagnostic cycle");
    const context = await this.collectAndPersistContext();
    const prompt = this.buildPrompt(context);
    const summary = await this.analyzer.analyze(prompt);
    await this.mattermost.postPeriodicReport({
      summary,
      healthScore: context?.networkHealth.score,
      peerCount: context?.peerCount,
      routingBucketCount: context?.routingBucketCount,
      lookupSuccessPct:
        typeof context?.networkHealth.components.lookup_success === "number"
          ? context.networkHealth.components.lookup_success
          : undefined,
      lookupTimeoutPct:
        typeof context?.lookupStats.timeoutsPerSent === "number"
          ? context.lookupStats.timeoutsPerSent * 100
          : undefined,
    });

    const usageSummary = await this.analyzer.consumeDailyUsageReport();
    if (usageSummary) {
      await this.mattermost.postDailyUsageReport(usageSummary);
    }
  }

  private async collectAndPersistContext(): Promise<ObserverCycleContext | undefined> {
    if (!this.client || !this.runtimeStore || !this.logWatcher) {
      return undefined;
    }

    try {
      const [nodeInfo, peers, routingBuckets, lookupStats, recentHistory] =
        await Promise.all([
          this.client.getNodeInfo(),
          this.client.getPeers(),
          this.client.getRoutingBuckets(),
          this.client.getLookupStats(),
          this.runtimeStore.getRecentHistory(10),
        ]);

      const timestamp = new Date().toISOString();
      const avgHops = readAverageHops(lookupStats);
      const health = getNetworkHealth({
        peerCount: peers.length,
        routingBuckets,
        lookupStats,
        avgHops,
      });
      const lookupSuccess =
        typeof lookupStats.matchPerSent === "number"
          ? lookupStats.matchPerSent
          : health.components.lookup_success / 100;

      const historyEntry: HistoryEntry = {
        timestamp,
        peerCount: peers.length,
        routingBalance: health.components.bucket_balance / 100,
        lookupSuccess,
        avgHops,
        healthScore: health.score,
      };
      await this.runtimeStore.appendHistory(historyEntry);

      const statePatch: RuntimeState = {
        lastRun: timestamp,
        lastHealthScore: health.score,
        logOffset: this.logWatcher.getOffset(),
      };
      await this.runtimeStore.updateState(statePatch);

      return {
        nodeInfo,
        peerCount: peers.length,
        routingBucketCount: routingBuckets.length,
        lookupStats,
        networkHealth: health,
        recentHistory,
      };
    } catch (err) {
      log("warn", "observer", `Context persistence failed: ${String(err)}`);
      return undefined;
    }
  }

  private buildPrompt(context: ObserverCycleContext | undefined): string {
    if (!context) {
      return "Run a full diagnostic check on the rust-mule node and provide a concise status report.";
    }

    return (
      "Run a full diagnostic check on the rust-mule node and provide a concise status report. " +
      "Use this latest observer snapshot as baseline context, then verify through tools.\n\n" +
      JSON.stringify(context)
    );
  }
}

function readAverageHops(lookupStats: Record<string, unknown>): number | undefined {
  const candidates = ["avgHops", "avg_hops", "average_hops"];
  for (const key of candidates) {
    const value = lookupStats[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
