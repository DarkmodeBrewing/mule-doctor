import type {
  DiagnosticTargetRef,
  HistoryEntry,
  ObserverCycleOutcome,
  RuntimeState,
} from "./types/contracts.js";
import type { NetworkHealthResult } from "./health/healthScore.js";

export interface ObserverCycleContext {
  targetLabel: string;
  nodeInfo: Record<string, unknown>;
  peerCount: number;
  routingBucketCount: number;
  lookupStats: Record<string, unknown>;
  networkHealth: NetworkHealthResult;
  recentHistory: HistoryEntry[];
}

export function buildObserverAnalysisPrompt(context: ObserverCycleContext | undefined): string {
  if (!context) {
    return [
      "Analyze the current rust-mule target and provide a focused diagnostic report.",
      "Use tools only if you need to verify a material uncertainty or fill a missing evidence gap.",
      "Do not broad-scan by default. Keep tool use bounded and evidence-based.",
      "Return:",
      "1. Overall status",
      "2. Confirmed issues",
      "3. Probable issues or risks",
      "4. Hypotheses or unknowns",
      "5. Supporting evidence",
      "6. Recommended next steps",
    ].join("\n");
  }

  return [
    `Analyze ${context.targetLabel} using the provided observer snapshot as the baseline context.`,
    "Inspect the snapshot first.",
    "Only call tools if you need to verify a suspected issue, refresh stale information, or fill a material evidence gap.",
    "Do not re-fetch everything by default. Keep tool use bounded and evidence-based.",
    "Return:",
    "1. Overall status",
    "2. Confirmed issues",
    "3. Probable issues or risks",
    "4. Hypotheses or unknowns",
    "5. Supporting evidence",
    "6. Recommended next steps",
    "",
    "Observer snapshot:",
    JSON.stringify(context),
  ].join("\n");
}

export function buildCycleStatePatch(config: {
  target: DiagnosticTargetRef | undefined;
  startedAt: string;
  completedAt: string;
  outcome: ObserverCycleOutcome;
  lastRun?: string;
}): RuntimeState {
  const startedMs = Date.parse(config.startedAt);
  const completedMs = Date.parse(config.completedAt);
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(completedMs)
      ? Math.max(0, completedMs - startedMs)
      : undefined;
  return {
    currentCycleStartedAt: undefined,
    currentCycleTarget: undefined,
    lastCycleStartedAt: config.startedAt,
    lastCycleCompletedAt: config.completedAt,
    lastCycleDurationMs: durationMs,
    lastCycleOutcome: config.outcome,
    lastRun: config.lastRun,
  };
}

export function readAverageHops(lookupStats: Record<string, unknown>): number | undefined {
  const candidates = ["avgHops", "avg_hops", "average_hops"];
  for (const key of candidates) {
    const value = lookupStats[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}
