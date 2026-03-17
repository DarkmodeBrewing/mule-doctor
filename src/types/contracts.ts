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
  | "managed_instance_control_applied"
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

export type LlmInvocationSurface =
  | "observer_cycle"
  | "mattermost_command"
  | "managed_instance_analysis"
  | "manual_observer_run";

export type LlmInvocationTrigger = "scheduled" | "human";

export type LlmInvocationFinishReason =
  | "completed"
  | "tool_round_limit"
  | "tool_call_limit"
  | "duration_limit"
  | "failed"
  | "rate_limited";

export interface LlmInvocationRecord {
  recordedAt: string;
  surface: LlmInvocationSurface;
  trigger: LlmInvocationTrigger;
  target?: DiagnosticTargetRef;
  model?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  toolCalls: number;
  toolRounds: number;
  finishReason: LlmInvocationFinishReason;
  command?: string;
  rateLimitReason?: "cooldown" | "in_flight";
  retryAfterSec?: number;
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
  sharedDir: string;
  metadataPath: string;
}

export interface ManagedInstancePresetMembership {
  presetId: string;
  prefix: string;
}

export interface ManagedInstanceRecord {
  id: string;
  status: ManagedInstanceStatus;
  createdAt: string;
  updatedAt: string;
  apiHost: string;
  apiPort: number;
  runtime: ManagedInstanceRuntimePaths;
  preset?: ManagedInstancePresetMembership;
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

export interface ManagedSharedFixture {
  fixtureId: string;
  token: string;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

export interface ManagedInstanceSharedOverview {
  instanceId: string;
  sharedDir: string;
  files: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  downloads: Record<string, unknown>[];
}

export interface ManagedSharedFixtureSnapshot {
  file?: Record<string, unknown>;
  actions: Record<string, unknown>[];
  downloads: Record<string, unknown>[];
}

export type ManagedDiscoverabilityOutcome = "found" | "completed_empty" | "timed_out";

export interface ManagedDiscoverabilityStateSample {
  observedAt: string;
  state: string;
  hits: number;
}

export interface ManagedDiscoverabilityCheckResult {
  publisherInstanceId: string;
  searcherInstanceId: string;
  fixture: ManagedSharedFixture;
  query: string;
  dispatchedAt: string;
  searchId: string;
  readinessAtDispatch: {
    publisherStatusReady: boolean;
    publisherSearchesReady: boolean;
    publisherReady: boolean;
    searcherStatusReady: boolean;
    searcherSearchesReady: boolean;
    searcherReady: boolean;
  };
  peerCountAtDispatch: {
    publisher: number;
    searcher: number;
  };
  publisherSharedBefore: ManagedSharedFixtureSnapshot;
  publisherSharedAfter: ManagedSharedFixtureSnapshot;
  states: ManagedDiscoverabilityStateSample[];
  resultCount: number;
  outcome: ManagedDiscoverabilityOutcome;
  finalState: string;
}

export interface ManagedDiscoverabilityFixtureSummary {
  fixtureId: string;
  fileName: string;
  relativePath: string;
  sizeBytes: number;
}

export interface ManagedDiscoverabilitySummaryResult {
  publisherInstanceId: string;
  searcherInstanceId: string;
  fixture: ManagedDiscoverabilityFixtureSummary;
  query: string;
  dispatchedAt: string;
  searchId: string;
  readinessAtDispatch: {
    publisherStatusReady: boolean;
    publisherSearchesReady: boolean;
    publisherReady: boolean;
    searcherStatusReady: boolean;
    searcherSearchesReady: boolean;
    searcherReady: boolean;
  };
  peerCountAtDispatch: {
    publisher: number;
    searcher: number;
  };
  states: ManagedDiscoverabilityStateSample[];
  resultCount: number;
  outcome: ManagedDiscoverabilityOutcome;
  finalState: string;
}

export interface ManagedDiscoverabilityRecord {
  recordedAt: string;
  result: ManagedDiscoverabilitySummaryResult;
}

export interface ManagedDiscoverabilitySummary {
  windowSize: number;
  totalChecks: number;
  foundCount: number;
  completedEmptyCount: number;
  timedOutCount: number;
  successRatePct?: number;
  latestRecordedAt?: string;
  latestOutcome?: ManagedDiscoverabilityOutcome;
  latestQuery?: string;
  latestPair?: {
    publisherInstanceId: string;
    searcherInstanceId: string;
  };
  lastSuccessAt?: string;
}

export type SearchHealthRecordSource = "controlled_discoverability";
export type SearchHealthOutcome = ManagedDiscoverabilityOutcome;

export interface SearchHealthReadinessSnapshot {
  statusReady: boolean;
  searchesReady: boolean;
  ready: boolean;
}

export interface SearchHealthTransportSnapshot {
  peerCount: number;
  degradedIndicators: string[];
}

export interface SearchHealthControlledContext {
  publisherInstanceId: string;
  searcherInstanceId: string;
  fixture: ManagedDiscoverabilityFixtureSummary;
}

export interface SearchHealthRecord {
  recordedAt: string;
  source: SearchHealthRecordSource;
  query: string;
  searchId: string;
  dispatchedAt: string;
  readinessAtDispatch: {
    publisher: SearchHealthReadinessSnapshot;
    searcher: SearchHealthReadinessSnapshot;
  };
  transportAtDispatch: {
    publisher: SearchHealthTransportSnapshot;
    searcher: SearchHealthTransportSnapshot;
  };
  states: ManagedDiscoverabilityStateSample[];
  resultCount: number;
  outcome: SearchHealthOutcome;
  finalState: string;
  controlledContext?: SearchHealthControlledContext;
}

export interface SearchHealthSummary {
  windowSize: number;
  totalSearches: number;
  foundCount: number;
  completedEmptyCount: number;
  timedOutCount: number;
  dispatchReadyCount: number;
  dispatchNotReadyCount: number;
  degradedTransportCount: number;
  successRatePct?: number;
  latestRecordedAt?: string;
  latestOutcome?: SearchHealthOutcome;
  latestQuery?: string;
  latestSource?: SearchHealthRecordSource;
  latestPair?: {
    publisherInstanceId: string;
    searcherInstanceId: string;
  };
  lastSuccessAt?: string;
}

export interface ManagedInstancePresetNode {
  suffix: string;
}

export interface ManagedInstancePresetDefinition {
  id: string;
  name: string;
  description: string;
  nodes: ManagedInstancePresetNode[];
}

export interface ApplyManagedInstancePresetInput {
  presetId: string;
  prefix: string;
}

export interface AppliedManagedInstancePreset {
  presetId: string;
  prefix: string;
  instances: ManagedInstanceRecord[];
}

export type ManagedInstancePresetAction = "start" | "stop" | "restart";

export interface ManagedInstancePresetActionResult {
  presetId: string;
  prefix: string;
  action: ManagedInstancePresetAction;
  instances: ManagedInstanceRecord[];
  failures: Array<{
    instanceId: string;
    error: string;
  }>;
}

// Backward-compatible alias for older callers that only knew about start results.
export type StartedManagedInstancePreset = ManagedInstancePresetActionResult;
