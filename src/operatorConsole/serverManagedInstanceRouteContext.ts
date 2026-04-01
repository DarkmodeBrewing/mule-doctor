import type {
  DiagnosticTargetRef,
  ManagedInstanceRecord,
} from "../types/contracts.js";
import type { LlmInvocationGate } from "../llm/invocationGate.js";
import type {
  DiagnosticTargetControl,
  DiscoverabilityResultsStore,
  ManagedInstanceAnalysis,
  ManagedInstanceControl,
  ManagedInstanceDiscoverability,
  ManagedInstanceDiagnostics,
  ManagedInstancePresets,
  ManagedInstanceSharing,
  ManagedInstanceSurfaceDiagnostics,
  OperatorEventsStore,
  OperatorSearches,
  SearchHealthResultsStore,
} from "./types.js";

export interface ManagedInstanceRouteContext {
  managedInstances?: ManagedInstanceControl;
  managedInstanceDiagnostics?: ManagedInstanceDiagnostics;
  managedInstanceSurfaceDiagnostics?: ManagedInstanceSurfaceDiagnostics;
  managedInstanceAnalysis?: ManagedInstanceAnalysis;
  managedInstanceSharing?: ManagedInstanceSharing;
  managedInstanceDiscoverability?: ManagedInstanceDiscoverability;
  operatorSearches?: OperatorSearches;
  managedInstancePresets?: ManagedInstancePresets;
  diagnosticTarget?: DiagnosticTargetControl;
  discoverabilityResults?: DiscoverabilityResultsStore;
  searchHealthResults?: SearchHealthResultsStore;
  humanInvocationGate?: Pick<LlmInvocationGate, "tryAcquire">;
  appendManagedInstanceControlEvent: (
    instance: ManagedInstanceRecord,
    message: string,
  ) => Promise<void>;
  appendManagedInstanceControlEvents: (
    instances: ManagedInstanceRecord[],
    buildMessage: (instance: ManagedInstanceRecord) => string,
  ) => Promise<void>;
  appendOperatorEvent: (
    event: Parameters<NonNullable<OperatorEventsStore["append"]>>[0],
  ) => Promise<void>;
  appendInvocationAudit: (record: {
    surface: "managed_instance_analysis" | "manual_observer_run";
    trigger: "human";
    target?: DiagnosticTargetRef;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    toolCalls: number;
    toolRounds: number;
    finishReason: "rate_limited";
    rateLimitReason?: "cooldown" | "in_flight";
    retryAfterSec?: number;
  }) => Promise<void>;
  findManagedInstance: (id: string) => Promise<ManagedInstanceRecord | undefined>;
}

export function pastTenseVerb(action: "start" | "stop" | "restart"): string {
  if (action === "start") return "started";
  if (action === "stop") return "stopped";
  return "restarted";
}
