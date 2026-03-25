import type { SearchPublishDiagnosticsSummary } from "../diagnostics/rustMuleSurfaceSummaries.js";
import type { LlmInvocationAuditSink } from "../llm/invocationAuditLog.js";
import type { LlmInvocationGate } from "../llm/invocationGate.js";
import type {
  DiagnosticTargetRef,
  ManagedDiscoverabilitySummary,
  SearchHealthSummary,
} from "../types/contracts.js";

export interface MattermostCommandContext {
  command: string;
  triggeredBy?: string;
}

export interface MattermostAttachment {
  title: string;
  color: string;
  text: string;
}

export interface MattermostPayload {
  text: string;
  attachments?: MattermostAttachment[];
}

export interface PeriodicReportInput {
  summary: string;
  target?: DiagnosticTargetRef;
  targetLabel?: string;
  healthScore?: number;
  peerCount?: number;
  routingBucketCount?: number;
  lookupSuccessPct?: number;
  lookupTimeoutPct?: number;
}

export interface PatchProposalInput {
  artifactPath: string;
  diff: string;
  bytes: number;
  lines: number;
}

export interface DiscoverabilityReportSource {
  summarizeRecent(limit?: number): Promise<ManagedDiscoverabilitySummary>;
}

export interface SearchHealthReportSource {
  summarizeRecent(limit?: number): Promise<SearchHealthSummary>;
}

export interface MattermostReportSources {
  discoverabilityResults?: DiscoverabilityReportSource;
  searchHealthResults?: SearchHealthReportSource;
  humanInvocationGate?: LlmInvocationGate;
  invocationAudit?: LlmInvocationAuditSink;
  managedInstanceSurfaceDiagnostics?: {
    getSummary(id: string): Promise<{
      instanceId: string;
      observedAt: string;
      summary: SearchPublishDiagnosticsSummary;
    }>;
  };
}

export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
export const DEFAULT_DISCOVERABILITY_REPORT_LIMIT = 3;
export const DEFAULT_SEARCH_HEALTH_REPORT_LIMIT = 5;
export const MAX_PATCH_BODY_CHARS = 12_000;

export function healthColor(score: number | undefined): string {
  if (typeof score !== "number") return "#3498db";
  if (score >= 80) return "#2ecc71";
  if (score >= 60) return "#f1c40f";
  return "#e74c3c";
}

export function healthStatus(score: number | undefined): string {
  if (typeof score !== "number") return "UNKNOWN";
  if (score >= 80) return "HEALTHY";
  if (score >= 60) return "WARNING";
  return "DEGRADED";
}

export function metricLine(label: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return `${label}: ${value}`;
}

export function formatMaybe<T>(
  value: T | undefined,
  formatter: (value: T) => string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return formatter(value);
}

export function usageBucketText(
  bucket: { calls: number; tokensIn: number; tokensOut: number; estimatedCost: number },
  key: string,
): string {
  return [
    `Period: ${key}`,
    `Calls: ${bucket.calls}`,
    `Tokens in: ${bucket.tokensIn}`,
    `Tokens out: ${bucket.tokensOut}`,
    `Estimated cost: $${bucket.estimatedCost.toFixed(6)}`,
  ].join("\n");
}

export function clampPatchBody(diff: string, maxChars: number): {
  body: string;
  truncated: boolean;
} {
  if (diff.length <= maxChars) {
    return { body: diff, truncated: false };
  }
  return { body: diff.slice(0, maxChars), truncated: true };
}

export function escapeCodeFence(text: string): string {
  return text.replaceAll("```", "``\\`");
}

export function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}

export function clampTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 100 || value > 120_000) {
    return DEFAULT_HTTP_TIMEOUT_MS;
  }
  return value;
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    typeof err["name"] === "string" &&
    err["name"] === "AbortError"
  );
}
