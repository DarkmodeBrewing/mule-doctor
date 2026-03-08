/**
 * Shared contracts used across diagnostics, tooling, and persisted runtime data.
 */

export interface ToolSuccess<T = unknown> {
  tool: string;
  success: true;
  data: T;
}

export interface ToolFailure {
  tool: string;
  success: false;
  error: string;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export interface ObserverSnapshot {
  timestamp: string;
  nodeInfo: Record<string, unknown>;
  peerCount: number;
  routingBucketCount: number;
  lookupStats: Record<string, unknown>;
}

export interface HistoryEntry {
  timestamp: string;
  target?: DiagnosticTargetRef;
  peerCount?: number;
  routingBalance?: number;
  lookupSuccess?: number;
  avgHops?: number;
  healthScore?: number;
}

export type OperatorEventType =
  | "diagnostic_target_changed"
  | "observer_run_requested"
  | "observer_cycle_started"
  | "observer_cycle_completed";

export interface OperatorEventEntry {
  timestamp: string;
  type: OperatorEventType;
  message: string;
  target?: DiagnosticTargetRef;
  outcome?: ObserverCycleOutcome;
  actor?: string;
}

export interface RuntimeState {
  lastRun?: string;
  lastHealthScore?: number;
  logOffset?: number;
  lastAlert?: string;
  activeDiagnosticTarget?: DiagnosticTargetRef;
  lastObservedTarget?: DiagnosticTargetRef;
  lastTargetFailureReason?: string;
  currentCycleStartedAt?: string;
  currentCycleTarget?: DiagnosticTargetRef;
  lastCycleStartedAt?: string;
  lastCycleCompletedAt?: string;
  lastCycleDurationMs?: number;
  lastCycleOutcome?: ObserverCycleOutcome;
  usage?: RuntimeUsageState;
}

export type ObserverCycleOutcome = "success" | "unavailable" | "error";

export type DiagnosticTargetKind = "external" | "managed_instance";

export interface DiagnosticTargetRef {
  kind: DiagnosticTargetKind;
  instanceId?: string;
}

export interface UsageBucket {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
}

export interface RuntimeUsageState {
  daily: Record<string, UsageBucket>;
  monthly: Record<string, UsageBucket>;
  lastReportDate?: string;
}

export type ManagedInstanceStatus = "planned" | "stopped" | "running" | "failed";

export interface ManagedInstanceProcessState {
  pid: number;
  command: string[];
  cwd: string;
  startedAt: string;
}

export interface ManagedInstanceExitState {
  at: string;
  exitCode: number | null;
  signal: string | null;
  reason?: string;
  error?: string;
}

export interface ManagedInstanceRuntimePaths {
  rootDir: string;
  configPath: string;
  tokenPath: string;
  debugTokenPath: string;
  logDir: string;
  logPath: string;
  stateDir: string;
  metadataPath: string;
}

export interface ManagedInstanceRecord {
  id: string;
  status: ManagedInstanceStatus;
  createdAt: string;
  updatedAt: string;
  apiHost: string;
  apiPort: number;
  runtime: ManagedInstanceRuntimePaths;
  currentProcess?: ManagedInstanceProcessState;
  lastExit?: ManagedInstanceExitState;
  lastError?: string;
}

export interface ManagedInstanceDiagnosticSnapshot {
  instanceId: string;
  observedAt: string;
  available: boolean;
  reason?: string;
  nodeInfo?: Record<string, unknown>;
  peerCount?: number;
  routingBucketCount?: number;
  lookupStats?: Record<string, unknown>;
  networkHealth?: {
    score: number;
    components: Record<string, number>;
  };
}

export interface ManagedInstanceAnalysisResult {
  instanceId: string;
  analyzedAt: string;
  available: boolean;
  reason?: string;
  summary: string;
  snapshot?: ManagedInstanceDiagnosticSnapshot;
}
