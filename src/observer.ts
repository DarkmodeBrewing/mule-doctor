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
import type { SearchHealthLog } from "./searchHealth/searchHealthLog.js";
import type {
  DiagnosticTargetRef,
  HistoryEntry,
  ObserverCycleOutcome,
  RuntimeState,
} from "./types/contracts.js";
import { getNetworkHealth } from "./health/healthScore.js";
import { redactText } from "./logs/redaction.js";
import type { OperatorEventLog } from "./operatorConsole/operatorEventLog.js";
import type { RustMuleReadiness } from "./api/rustMuleClient.js";
import type {
  ObserverTargetDescriptor,
  ObserverTargetRuntime,
  ObserverTargetResolver,
} from "./observerTargetResolver.js";
import { appendObservedSearchHealth } from "./observerSearchTracking.js";
import {
  buildCycleStatePatch,
  buildObserverAnalysisPrompt,
  log,
  readAverageHops,
  type ObserverCycleContext,
} from "./observerShared.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface ObserverConfig {
  intervalMs?: number;
  client?: RustMuleClient;
  logWatcher?: LogWatcher;
  runtimeStore?: RuntimeStore;
  searchHealthLog?: SearchHealthLog;
  targetResolver?: ObserverTargetResolver;
  analyzerFactory?: AnalyzerFactory;
  eventLog?: OperatorEventLog;
}

export interface ObserverStatus {
  started: boolean;
  cycleInFlight: boolean;
  intervalMs: number;
  currentCycleStartedAt?: string;
  currentCycleTarget?: DiagnosticTargetRef;
}

export interface ObserverRunNowResult {
  accepted: boolean;
  reason?: string;
}

type AnalyzerFactory = (target: ObserverTargetRuntime) => Analyzer;

export class Observer {
  private readonly analyzer: Analyzer;
  private readonly mattermost: MattermostClient;
  private readonly intervalMs: number;
  private readonly client: RustMuleClient | undefined;
  private readonly logWatcher: LogWatcher | undefined;
  private readonly runtimeStore: RuntimeStore | undefined;
  private readonly searchHealthLog: SearchHealthLog | undefined;
  private readonly targetResolver: ObserverTargetResolver | undefined;
  private readonly analyzerFactory: AnalyzerFactory | undefined;
  private readonly eventLog: OperatorEventLog | undefined;
  private readonly lastObservedSearchSignatures = new Map<string, string>();
  private readonly lastObservedSearchStates = new Map<string, string>();
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private cycleInFlight: Promise<void> | undefined;
  private generation = 0;
  private currentCycleStartedAt: string | undefined;
  private currentCycleTarget: DiagnosticTargetRef | undefined;

  constructor(analyzer: Analyzer, mattermost: MattermostClient, config: ObserverConfig = {}) {
    this.analyzer = analyzer;
    this.mattermost = mattermost;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.client = config.client;
    this.logWatcher = config.logWatcher;
    this.runtimeStore = config.runtimeStore;
    this.searchHealthLog = config.searchHealthLog;
    this.targetResolver = config.targetResolver;
    this.analyzerFactory = config.analyzerFactory;
    this.eventLog = config.eventLog;
  }

  /** Start the periodic observation loop. */
  start(): void {
    if (this.started) {
      log("warn", "observer", "Start requested while observer is already running");
      return;
    }
    this.started = true;
    this.generation += 1;
    log("info", "observer", `Starting observation loop (interval: ${this.intervalMs}ms)`);
    // Run immediately, then schedule the next cycle after completion.
    this.maybeStartCycle();
  }

  /** Stop the observation loop. */
  stop(): void {
    this.started = false;
    this.generation += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    log("info", "observer", "Stopped");
  }

  getStatus(): ObserverStatus {
    return {
      started: this.started,
      cycleInFlight: Boolean(this.cycleInFlight),
      intervalMs: this.intervalMs,
      currentCycleStartedAt: this.currentCycleStartedAt,
      currentCycleTarget: this.currentCycleTarget,
    };
  }

  triggerRunNow(): ObserverRunNowResult {
    if (!this.started) {
      return { accepted: false, reason: "observer is not running" };
    }
    if (this.cycleInFlight) {
      return { accepted: false, reason: "observer cycle already in progress" };
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.maybeStartCycle();
    return { accepted: true };
  }

  private maybeStartCycle(): void {
    if (!this.started || this.timer) {
      return;
    }

    if (this.cycleInFlight) {
      const inFlight = this.cycleInFlight;
      inFlight.finally(() => {
        this.maybeStartCycle();
      });
      return;
    }

    const cycleGeneration = this.generation;
    this.cycleInFlight = this.runCycle()
      .catch((err) => log("error", "observer", `Cycle error: ${String(err)}`))
      .finally(() => {
        this.cycleInFlight = undefined;
        if (!this.started) return;
        if (this.generation !== cycleGeneration) {
          // Start/stop happened while this cycle was in-flight; immediately evaluate next step.
          this.maybeStartCycle();
          return;
        }
        this.timer = setTimeout(() => {
          this.timer = undefined;
          if (!this.started) return;
          this.maybeStartCycle();
        }, this.intervalMs);
      });
  }

  private async runCycle(): Promise<void> {
    log("info", "observer", "Running diagnostic cycle");
    try {
      const targetDescriptor = await this.describeTarget();
      const cycleStartedAt = new Date().toISOString();
      await this.markCycleStarted(cycleStartedAt, targetDescriptor.target);
      await this.eventLog?.append({
        type: "observer_cycle_started",
        message: `Observer cycle started for ${targetDescriptor.label}`,
        target: targetDescriptor.target,
      });

      let target: ObserverTargetRuntime | undefined;
      let readiness: RustMuleReadiness | undefined;
      try {
        target = await this.resolveTarget();
      } catch (err) {
        await this.handleUnavailableTarget(targetDescriptor, err, cycleStartedAt);
        return;
      }
      if (target) {
        try {
          readiness = await this.ensureTargetReady(target);
        } catch (err) {
          await this.handleUnavailableTarget(targetDescriptor, err, cycleStartedAt);
          return;
        }
      }

      const context = await this.collectAndPersistContext(target, readiness);
      const prompt = buildObserverAnalysisPrompt(context);
      const analyzer = target && this.analyzerFactory ? this.analyzerFactory(target) : this.analyzer;
      const summary = await analyzer.analyze(prompt, {
        surface: "observer_cycle",
        trigger: "scheduled",
        target: targetDescriptor.target,
      });
      await this.mattermost.postPeriodicReport({
        summary,
        target: targetDescriptor.target,
        targetLabel: context?.targetLabel ?? targetDescriptor.label,
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

      const usageSummary = await analyzer.consumeDailyUsageReport();
      if (usageSummary) {
        await this.mattermost.postDailyUsageReport(usageSummary);
      }

      await this.finishCycle({
        target: targetDescriptor.target,
        startedAt: cycleStartedAt,
        outcome: "success",
      });
      await this.eventLog?.append({
        type: "observer_cycle_completed",
        message: `Observer cycle completed successfully for ${targetDescriptor.label}`,
        target: targetDescriptor.target,
        outcome: "success",
      });
    } catch (err) {
      await this.handleCycleError(err);
    }
  }

  private async collectAndPersistContext(
    target?: ObserverTargetRuntime,
    readiness?: RustMuleReadiness,
  ): Promise<ObserverCycleContext | undefined> {
    const resolvedTarget = target ?? (await this.resolveTarget());
    if (!resolvedTarget || !this.runtimeStore) {
      return undefined;
    }

    try {
      const [nodeInfo, peers, routingBuckets, lookupStats, recentHistory, targetReadiness] =
        await Promise.all([
        resolvedTarget.client.getNodeInfo(),
        resolvedTarget.client.getPeers(),
        resolvedTarget.client.getRoutingBuckets(),
        resolvedTarget.client.getLookupStats(),
        this.runtimeStore.getRecentHistory(10),
        readiness ? Promise.resolve(readiness) : resolvedTarget.client.getReadiness(),
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
        target: resolvedTarget.target,
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
        logOffset: resolvedTarget.logOffset,
        lastObservedTarget: resolvedTarget.target,
        lastTargetFailureReason: undefined,
      };
      await this.runtimeStore.updateState(statePatch);
      await this.recordObservedSearchHealth(resolvedTarget, targetReadiness, peers.length, timestamp);

      return {
        targetLabel: resolvedTarget.label,
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

  private async resolveTarget(): Promise<ObserverTargetRuntime | undefined> {
    if (this.targetResolver) {
      return this.targetResolver.resolve();
    }
    if (!this.client || !this.logWatcher) {
      return undefined;
    }
    return {
      target: { kind: "external" },
      label: "external configured rust-mule client",
      client: this.client,
      logSource: this.logWatcher,
      logOffset: this.logWatcher.getOffset(),
    };
  }

  private async ensureTargetReady(target: ObserverTargetRuntime): Promise<RustMuleReadiness> {
    const readiness = await target.client.getReadiness();
    if (readiness.ready) {
      return readiness;
    }

    const reasons: string[] = [];
    if (!readiness.statusReady) {
      reasons.push("/api/v1/status.ready=false");
    }
    if (!readiness.searchesReady) {
      reasons.push("/api/v1/searches.ready=false");
    }

    throw new Error(
      `rust-mule target not ready (${reasons.join(", ") || "readiness checks incomplete"})`,
    );
  }

  private async recordObservedSearchHealth(
    target: ObserverTargetRuntime,
    readiness: RustMuleReadiness,
    peerCount: number,
    recordedAt: string,
  ): Promise<void> {
    await appendObservedSearchHealth({
      target,
      readiness,
      peerCount,
      recordedAt,
      searchHealthLog: this.searchHealthLog,
      lastObservedSearchSignatures: this.lastObservedSearchSignatures,
      lastObservedSearchStates: this.lastObservedSearchStates,
    });
  }

  private async describeTarget(): Promise<ObserverTargetDescriptor> {
    if (this.targetResolver) {
      return this.targetResolver.describeActiveTarget();
    }
    return {
      target: { kind: "external" },
      label: "external configured rust-mule client",
    };
  }

  private async handleUnavailableTarget(
    target: ObserverTargetDescriptor,
    err: unknown,
    startedAt: string,
  ): Promise<void> {
    const reason = redactText(err instanceof Error ? err.message : String(err));
    log("warn", "observer", `Active target unavailable (${target.label}): ${reason}`);

    const timestamp = new Date().toISOString();
    if (this.runtimeStore) {
      await this.runtimeStore.appendHistory({
        timestamp,
        target: target.target,
        healthScore: 0,
      });
      await this.runtimeStore.updateState({
        lastRun: timestamp,
        lastHealthScore: 0,
        lastObservedTarget: target.target,
        lastTargetFailureReason: reason,
        logOffset: undefined,
        ...buildCycleStatePatch({
          target: target.target,
          startedAt,
          completedAt: timestamp,
          outcome: "unavailable",
          lastRun: timestamp,
        }),
      });
    }

    this.currentCycleStartedAt = undefined;
    this.currentCycleTarget = undefined;

      await this.mattermost.postPeriodicReport({
        summary: `Active diagnostic target unavailable: ${reason}`,
        target: target.target,
        targetLabel: target.label,
        healthScore: 0,
      });
    await this.eventLog?.append({
      type: "observer_cycle_completed",
      message: `Observer cycle unavailable for ${target.label}: ${reason}`,
      target: target.target,
      outcome: "unavailable",
    });
  }

  private async handleCycleError(err: unknown): Promise<void> {
    const reason = redactText(err instanceof Error ? err.message : String(err));
    log("error", "observer", `Cycle failed: ${reason}`);
    const completedAt = new Date().toISOString();
    const target = this.currentCycleTarget;
    const startedAt = this.currentCycleStartedAt ?? completedAt;
    this.currentCycleStartedAt = undefined;
    this.currentCycleTarget = undefined;

    if (!this.runtimeStore) {
      return;
    }

    await this.runtimeStore.updateState({
      lastRun: completedAt,
      lastObservedTarget: target,
      lastTargetFailureReason: reason,
      ...buildCycleStatePatch({
        target,
        startedAt,
        completedAt,
        outcome: "error",
        lastRun: completedAt,
      }),
    });
    await this.eventLog?.append({
      type: "observer_cycle_completed",
      message: `Observer cycle failed: ${reason}`,
      target,
      outcome: "error",
    });
  }

  private async markCycleStarted(
    startedAt: string,
    target: DiagnosticTargetRef | undefined,
  ): Promise<void> {
    this.currentCycleStartedAt = startedAt;
    this.currentCycleTarget = target;
    if (!this.runtimeStore) {
      return;
    }
    await this.runtimeStore.updateState({
      currentCycleStartedAt: startedAt,
      currentCycleTarget: target,
    });
  }

  private async finishCycle(config: {
    target: DiagnosticTargetRef | undefined;
    startedAt: string;
    outcome: ObserverCycleOutcome;
  }): Promise<void> {
    const completedAt = new Date().toISOString();
    this.currentCycleStartedAt = undefined;
    this.currentCycleTarget = undefined;
    if (!this.runtimeStore) {
      return;
    }
    await this.runtimeStore.updateState(
      buildCycleStatePatch({
        target: config.target,
        startedAt: config.startedAt,
        completedAt,
        outcome: config.outcome,
        lastRun: completedAt,
      }),
    );
  }
}
export { buildObserverAnalysisPrompt } from "./observerShared.js";
