import type { LlmInvocationGate } from "../llm/invocationGate.js";
import type {
  DiagnosticTargetRef,
  RuntimeState,
} from "../types/contracts.js";
import type {
  DiagnosticTargetControl,
  DiscoverabilityResultsStore,
  LlmInvocationResultsStore,
  ManagedInstanceControl,
  ManagedInstanceDiagnostics,
  ObserverControl,
  OperatorEventsStore,
  SearchHealthResultsStore,
} from "./types.js";

export interface GeneralRouteContext {
  startedAt: string;
  rustMuleLogPath: string;
  llmLogDir: string;
  proposalDir: string;
  getAppLogs: (n?: number) => string[];
  getRuntimeState?: () => Promise<RuntimeState>;
  managedInstances?: ManagedInstanceControl;
  managedInstanceDiagnostics?: ManagedInstanceDiagnostics;
  diagnosticTarget?: DiagnosticTargetControl;
  observerControl?: ObserverControl;
  humanInvocationGate?: Pick<LlmInvocationGate, "tryAcquire">;
  operatorEvents?: OperatorEventsStore;
  discoverabilityResults?: DiscoverabilityResultsStore;
  searchHealthResults?: SearchHealthResultsStore;
  llmInvocationResults?: LlmInvocationResultsStore;
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
}
