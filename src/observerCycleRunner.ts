import type { RustMuleReadiness } from "./api/rustMuleClient.js";
import type { Analyzer } from "./llm/analyzer.js";
import { getNetworkHealth } from "./health/healthScore.js";
import type { MattermostClient } from "./integrations/mattermost.js";
import { redactText } from "./logs/redaction.js";
import type { OperatorEventLog } from "./operatorConsole/operatorEventLog.js";
import type { ObserverTargetDescriptor, ObserverTargetResolver, ObserverTargetRuntime } from "./observerTargetResolver.js";
import { appendObservedSearchHealth } from "./observerSearchTracking.js";
import type { SearchHealthLog } from "./searchHealth/searchHealthLog.js";
import type { RuntimeStore } from "./storage/runtimeStore.js";
import type { DiagnosticTargetRef, HistoryEntry, ObserverCycleOutcome, RuntimeState } from "./types/contracts.js";
import type { RustMuleClient } from "./api/rustMuleClient.js";
import type { LogWatcher } from "./logs/logWatcher.js";
import {
  buildCycleStatePatch,
  buildObserverAnalysisPrompt,
  log,
  readAverageHops,
  type ObserverCycleContext,
} from "./observerShared.js";

type AnalyzerFactory = (target: ObserverTargetRuntime) => Analyzer;

export interface ObserverCycleRunnerConfig {
  analyzer: Analyzer;
  analyzerFactory?: AnalyzerFactory;
  mattermost: MattermostClient;
  client?: RustMuleClient;
  logWatcher?: LogWatcher;
  runtimeStore?: RuntimeStore;
  searchHealthLog?: SearchHealthLog;
  targetResolver?: ObserverTargetResolver;
  eventLog?: OperatorEventLog;
  lastObservedSearchSignatures: Map<string, string>;
  lastObservedSearchStates: Map<string, string>;
  getCurrentCycleState: () => {
    startedAt?: string;
    target?: DiagnosticTargetRef;
  };
  clearCurrentCycleState: () => void;
  markCycleStarted: (
    startedAt: string,
    target: DiagnosticTargetRef | undefined,
  ) => Promise<void>;
  finishCycle: (config: {
    target: DiagnosticTargetRef | undefined;
    startedAt: string;
    outcome: ObserverCycleOutcome;
  }) => Promise<void>;
}

export async function runObserverCycle(config: ObserverCycleRunnerConfig): Promise<void> {
  log("info", "observer", "Running diagnostic cycle");
  try {
    const targetDescriptor = await describeTarget(config);
    const cycleStartedAt = new Date().toISOString();
    await config.markCycleStarted(cycleStartedAt, targetDescriptor.target);
    await config.eventLog?.append({
      type: "observer_cycle_started",
      message: `Observer cycle started for ${targetDescriptor.label}`,
      target: targetDescriptor.target,
    });

    let target: ObserverTargetRuntime | undefined;
    let readiness: RustMuleReadiness | undefined;
    try {
      target = await resolveTarget(config);
    } catch (err) {
      await handleUnavailableTarget(config, targetDescriptor, err, cycleStartedAt);
      return;
    }
    if (target) {
      try {
        readiness = await ensureTargetReady(target);
      } catch (err) {
        await handleUnavailableTarget(config, targetDescriptor, err, cycleStartedAt);
        return;
      }
    }

    const context = await collectAndPersistContext(config, target, readiness);
    const prompt = buildObserverAnalysisPrompt(context);
    const analyzer = target && config.analyzerFactory ? config.analyzerFactory(target) : config.analyzer;
    const summary = await analyzer.analyze(prompt, {
      surface: "observer_cycle",
      trigger: "scheduled",
      target: targetDescriptor.target,
    });
    await config.mattermost.postPeriodicReport({
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
      await config.mattermost.postDailyUsageReport(usageSummary);
    }

    await config.finishCycle({
      target: targetDescriptor.target,
      startedAt: cycleStartedAt,
      outcome: "success",
    });
    await config.eventLog?.append({
      type: "observer_cycle_completed",
      message: `Observer cycle completed successfully for ${targetDescriptor.label}`,
      target: targetDescriptor.target,
      outcome: "success",
    });
  } catch (err) {
    await handleCycleError(config, err);
  }
}

async function collectAndPersistContext(
  config: ObserverCycleRunnerConfig,
  target?: ObserverTargetRuntime,
  readiness?: RustMuleReadiness,
): Promise<ObserverCycleContext | undefined> {
  const resolvedTarget = target ?? (await resolveTarget(config));
  if (!resolvedTarget || !config.runtimeStore) {
    return undefined;
  }

  try {
    const [nodeInfo, peers, routingBuckets, lookupStats, recentHistory, targetReadiness] =
      await Promise.all([
        resolvedTarget.client.getNodeInfo(),
        resolvedTarget.client.getPeers(),
        resolvedTarget.client.getRoutingBuckets(),
        resolvedTarget.client.getLookupStats(),
        config.runtimeStore.getRecentHistory(10),
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
    await config.runtimeStore.appendHistory(historyEntry);

    const statePatch: RuntimeState = {
      lastRun: timestamp,
      lastHealthScore: health.score,
      logOffset: resolvedTarget.logOffset,
      lastObservedTarget: resolvedTarget.target,
      lastTargetFailureReason: undefined,
    };
    await config.runtimeStore.updateState(statePatch);
    await recordObservedSearchHealth(config, resolvedTarget, targetReadiness, peers.length, timestamp);

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

async function resolveTarget(
  config: ObserverCycleRunnerConfig,
): Promise<ObserverTargetRuntime | undefined> {
  if (config.targetResolver) {
    return config.targetResolver.resolve();
  }
  if (!config.client || !config.logWatcher) {
    return undefined;
  }
  return {
    target: { kind: "external" },
    label: "external configured rust-mule client",
    client: config.client,
    logSource: config.logWatcher,
    logOffset: config.logWatcher.getOffset(),
  };
}

async function ensureTargetReady(target: ObserverTargetRuntime): Promise<RustMuleReadiness> {
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

async function recordObservedSearchHealth(
  config: ObserverCycleRunnerConfig,
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
    searchHealthLog: config.searchHealthLog,
    lastObservedSearchSignatures: config.lastObservedSearchSignatures,
    lastObservedSearchStates: config.lastObservedSearchStates,
  });
}

async function describeTarget(config: ObserverCycleRunnerConfig): Promise<ObserverTargetDescriptor> {
  if (config.targetResolver) {
    return config.targetResolver.describeActiveTarget();
  }
  return {
    target: { kind: "external" },
    label: "external configured rust-mule client",
  };
}

async function handleUnavailableTarget(
  config: ObserverCycleRunnerConfig,
  target: ObserverTargetDescriptor,
  err: unknown,
  startedAt: string,
): Promise<void> {
  const reason = redactText(err instanceof Error ? err.message : String(err));
  log("warn", "observer", `Active target unavailable (${target.label}): ${reason}`);

  const timestamp = new Date().toISOString();
  if (config.runtimeStore) {
    await config.runtimeStore.appendHistory({
      timestamp,
      target: target.target,
      healthScore: 0,
    });
    await config.runtimeStore.updateState({
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

  config.clearCurrentCycleState();

  await config.mattermost.postPeriodicReport({
    summary: `Active diagnostic target unavailable: ${reason}`,
    target: target.target,
    targetLabel: target.label,
    healthScore: 0,
  });
  await config.eventLog?.append({
    type: "observer_cycle_completed",
    message: `Observer cycle unavailable for ${target.label}: ${reason}`,
    target: target.target,
    outcome: "unavailable",
  });
}

async function handleCycleError(
  config: ObserverCycleRunnerConfig,
  err: unknown,
): Promise<void> {
  const reason = redactText(err instanceof Error ? err.message : String(err));
  log("error", "observer", `Cycle failed: ${reason}`);
  const completedAt = new Date().toISOString();
  const cycleState = config.getCurrentCycleState();
  const target = cycleState.target;
  const startedAt = cycleState.startedAt ?? completedAt;
  config.clearCurrentCycleState();

  if (!config.runtimeStore) {
    return;
  }

  await config.runtimeStore.updateState({
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
  await config.eventLog?.append({
    type: "observer_cycle_completed",
    message: `Observer cycle failed: ${reason}`,
    target,
    outcome: "error",
  });
}
