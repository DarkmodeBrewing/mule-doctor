/**
 * observer.ts
 * Periodic observation loop: polls the rust-mule node, runs LLM analysis,
 * and posts the result to Mattermost on a configurable cadence.
 */

import type { Analyzer } from "./llm/analyzer.js";
import type { MattermostClient } from "./integrations/mattermost.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface ObserverConfig {
  intervalMs?: number;
}

export class Observer {
  private readonly analyzer: Analyzer;
  private readonly mattermost: MattermostClient;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    analyzer: Analyzer,
    mattermost: MattermostClient,
    config: ObserverConfig = {}
  ) {
    this.analyzer = analyzer;
    this.mattermost = mattermost;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
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
    const summary = await this.analyzer.analyze(
      "Run a full diagnostic check on the rust-mule node and provide a concise status report."
    );
    await this.mattermost.post(`### mule-doctor periodic report\n\n${summary}`);
  }
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
