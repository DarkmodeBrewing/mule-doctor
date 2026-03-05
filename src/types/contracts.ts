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
  peerCount?: number;
  routingBalance?: number;
  lookupSuccess?: number;
  avgHops?: number;
  healthScore?: number;
}

export interface RuntimeState {
  lastRun?: string;
  lastHealthScore?: number;
  logOffset?: number;
  lastAlert?: string;
  usage?: RuntimeUsageState;
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
