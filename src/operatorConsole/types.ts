import type { DiagnosticTargetRef, ManagedInstanceAnalysisResult, ManagedInstanceDiagnosticSnapshot, ManagedInstancePresetActionResult, ManagedInstancePresetDefinition, ManagedInstanceRecord, ObserverCycleOutcome, OperatorEventEntry, RuntimeState, AppliedManagedInstancePreset, ApplyManagedInstancePresetInput, ManagedInstanceSharedOverview, ManagedSharedFixture, ManagedDiscoverabilityCheckResult } from "../types/contracts.js";

export interface ListedFile {
  name: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface AuthState {
  ok: boolean;
}

export interface StreamChunk {
  nextOffset: number;
  lines: string[];
  partial: string;
}

export interface ManagedInstanceControl {
  listInstances(): Promise<ManagedInstanceRecord[]>;
  createPlannedInstance(input: { id: string; apiPort?: number }): Promise<ManagedInstanceRecord>;
  startInstance(id: string): Promise<ManagedInstanceRecord>;
  stopInstance(id: string, reason?: string): Promise<ManagedInstanceRecord>;
  restartInstance(id: string): Promise<ManagedInstanceRecord>;
}

export interface ManagedInstanceDiagnostics {
  getSnapshot(id: string): Promise<ManagedInstanceDiagnosticSnapshot>;
}

export interface ManagedInstancePresets {
  listPresets(): ManagedInstancePresetDefinition[];
  applyPreset(input: ApplyManagedInstancePresetInput): Promise<AppliedManagedInstancePreset>;
  startPreset(prefix: string): Promise<ManagedInstancePresetActionResult>;
  stopPreset(prefix: string): Promise<ManagedInstancePresetActionResult>;
  restartPreset(prefix: string): Promise<ManagedInstancePresetActionResult>;
}

export type ConsoleManagedInstanceRecord = Omit<ManagedInstanceRecord, "runtime"> & {
  runtime: Omit<ManagedInstanceRecord["runtime"], "logPath">;
};

export interface ManagedInstanceComparisonResponse {
  left: {
    instance: ConsoleManagedInstanceRecord;
    snapshot: ManagedInstanceDiagnosticSnapshot;
  };
  right: {
    instance: ConsoleManagedInstanceRecord;
    snapshot: ManagedInstanceDiagnosticSnapshot;
  };
}

export interface ManagedInstanceAnalysis {
  analyze(id: string): Promise<ManagedInstanceAnalysisResult>;
}

export interface ManagedInstanceSharing {
  getOverview(id: string): Promise<ManagedInstanceSharedOverview>;
  ensureFixture(
    id: string,
    input?: { fixtureId?: string },
  ): Promise<ManagedSharedFixture>;
  reindex(id: string): Promise<ManagedInstanceSharedOverview>;
  republishSources(id: string): Promise<ManagedInstanceSharedOverview>;
  republishKeywords(id: string): Promise<ManagedInstanceSharedOverview>;
}

export interface ManagedInstanceDiscoverability {
  runControlledCheck(input: {
    publisherInstanceId: string;
    searcherInstanceId: string;
    fixtureId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<ManagedDiscoverabilityCheckResult>;
}

export interface DiagnosticTargetControl {
  getActiveTarget(): Promise<DiagnosticTargetRef>;
  setActiveTarget(target: DiagnosticTargetRef): Promise<DiagnosticTargetRef>;
}

export interface ObserverControl {
  getStatus(): {
    started: boolean;
    cycleInFlight: boolean;
    intervalMs: number;
    currentCycleStartedAt?: string;
    currentCycleTarget?: DiagnosticTargetRef;
  };
  triggerRunNow(): { accepted: boolean; reason?: string };
}

export interface OperatorEventsStore {
  listRecent(limit?: number): Promise<OperatorEventEntry[]>;
  append(input: {
    type: OperatorEventEntry["type"];
    message: string;
    target?: DiagnosticTargetRef;
    outcome?: ObserverCycleOutcome;
    actor?: string;
  }): Promise<void>;
  appendMany?(inputs: {
    type: OperatorEventEntry["type"];
    message: string;
    target?: DiagnosticTargetRef;
    outcome?: ObserverCycleOutcome;
    actor?: string;
  }[]): Promise<void>;
}

export interface OperatorConsoleConfig {
  authToken?: string;
  host?: string;
  port?: number;
  rustMuleLogPath: string;
  llmLogDir: string;
  proposalDir: string;
  getAppLogs: (n?: number) => string[];
  getRuntimeState?: () => Promise<RuntimeState>;
  subscribeToAppLogs?: (listener: (line: string) => void) => () => void;
  rustMuleStreamPollMs?: number;
  managedInstances?: ManagedInstanceControl;
  managedInstanceDiagnostics?: ManagedInstanceDiagnostics;
  managedInstanceAnalysis?: ManagedInstanceAnalysis;
  managedInstanceSharing?: ManagedInstanceSharing;
  managedInstanceDiscoverability?: ManagedInstanceDiscoverability;
  managedInstancePresets?: ManagedInstancePresets;
  diagnosticTarget?: DiagnosticTargetControl;
  observerControl?: ObserverControl;
  operatorEvents?: OperatorEventsStore;
}

export interface SafeReadResult {
  name: string;
  sizeBytes: number;
  truncated: boolean;
  content: string;
}
