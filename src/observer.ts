/**
 * observer.ts
 * Periodic observation loop: polls the rust-mule node, runs LLM analysis,
 * and posts the result to Mattermost on a configurable cadence.
 */

import type { Analyzer } from "./llm/analyzer.js";
import type { MattermostClient } from "./integrations/mattermost.js";
import type { RustMuleClient } from "./api/rustMuleClient.js";
import type { RustMuleReadiness } from "./api/rustMuleClient.js";
import type { LogWatcher } from "./logs/logWatcher.js";
import type { RuntimeStore } from "./storage/runtimeStore.js";
import type { SearchHealthLog } from "./searchHealth/searchHealthLog.js";
import type {
  DiagnosticTargetRef,
  ObserverCycleOutcome,
} from "./types/contracts.js";
import type { OperatorEventLog } from "./operatorConsole/operatorEventLog.js";
import type {
  ObserverTargetResolver,
  ObserverTargetRuntime,
} from "./observerTargetResolver.js";
import {
  collectAndPersistObserverContext,
  runObserverCycle,
} from "./observerCycleRunner.js";
import {
  buildCycleStatePatch,
  log,
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
    await runObserverCycle({
      analyzer: this.analyzer,
      analyzerFactory: this.analyzerFactory,
      mattermost: this.mattermost,
      client: this.client,
      logWatcher: this.logWatcher,
      runtimeStore: this.runtimeStore,
      searchHealthLog: this.searchHealthLog,
      targetResolver: this.targetResolver,
      eventLog: this.eventLog,
      lastObservedSearchSignatures: this.lastObservedSearchSignatures,
      lastObservedSearchStates: this.lastObservedSearchStates,
      getCurrentCycleState: () => ({
        startedAt: this.currentCycleStartedAt,
        target: this.currentCycleTarget,
      }),
      clearCurrentCycleState: () => {
        this.currentCycleStartedAt = undefined;
        this.currentCycleTarget = undefined;
      },
      markCycleStarted: this.markCycleStarted.bind(this),
      finishCycle: this.finishCycle.bind(this),
    });
  }

  private async collectAndPersistContext(
    target?: ObserverTargetRuntime,
    readiness?: RustMuleReadiness,
  ) {
    return collectAndPersistObserverContext(
      {
        analyzer: this.analyzer,
        analyzerFactory: this.analyzerFactory,
        mattermost: this.mattermost,
        client: this.client,
        logWatcher: this.logWatcher,
        runtimeStore: this.runtimeStore,
        searchHealthLog: this.searchHealthLog,
        targetResolver: this.targetResolver,
        eventLog: this.eventLog,
        lastObservedSearchSignatures: this.lastObservedSearchSignatures,
        lastObservedSearchStates: this.lastObservedSearchStates,
        getCurrentCycleState: () => ({
          startedAt: this.currentCycleStartedAt,
          target: this.currentCycleTarget,
        }),
        clearCurrentCycleState: () => {
          this.currentCycleStartedAt = undefined;
          this.currentCycleTarget = undefined;
        },
        markCycleStarted: this.markCycleStarted.bind(this),
        finishCycle: this.finishCycle.bind(this),
      },
      target,
      readiness,
    );
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
