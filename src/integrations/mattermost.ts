/**
 * mattermost.ts
 * Mattermost integration: posts status reports via incoming webhook and
 * handles inbound slash-command / mention payloads.
 */

import type { Analyzer } from "../llm/analyzer.js";
import type { LlmInvocationAuditSink } from "../llm/invocationAuditLog.js";
import type { LlmInvocationGate } from "../llm/invocationGate.js";
import { normalizeInvocationKeyPart } from "../llm/invocationGate.js";
import type { UsageSummary } from "../llm/usageTracker.js";
import type { SearchPublishDiagnosticsSummary } from "../diagnostics/rustMuleSurfaceSummaries.js";
import type {
  DiagnosticTargetRef,
  ManagedDiscoverabilitySummary,
  SearchHealthSummary,
} from "../types/contracts.js";

export interface MattermostCommandContext {
  command: string;
  triggeredBy?: string;
}

interface MattermostAttachment {
  title: string;
  color: string;
  text: string;
}

interface MattermostPayload {
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

const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
const DEFAULT_DISCOVERABILITY_REPORT_LIMIT = 3;
const DEFAULT_SEARCH_HEALTH_REPORT_LIMIT = 5;

export class MattermostClient {
  private readonly webhookUrl: string;
  private readonly analyzer: Analyzer;
  private readonly requestTimeoutMs: number;
  private readonly discoverabilityResults: DiscoverabilityReportSource | undefined;
  private readonly searchHealthResults: SearchHealthReportSource | undefined;
  private readonly humanInvocationGate: LlmInvocationGate | undefined;
  private readonly invocationAudit: LlmInvocationAuditSink | undefined;
  private readonly managedInstanceSurfaceDiagnostics:
    | MattermostReportSources["managedInstanceSurfaceDiagnostics"]
    | undefined;

  constructor(webhookUrl: string, analyzer: Analyzer, requestTimeoutMs?: number);
  constructor(
    webhookUrl: string,
    analyzer: Analyzer,
    reportSources: MattermostReportSources | undefined,
    requestTimeoutMs?: number,
  );
  constructor(
    webhookUrl: string,
    analyzer: Analyzer,
    reportSourcesOrTimeout?: MattermostReportSources | number,
    requestTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  ) {
    this.webhookUrl = webhookUrl;
    this.analyzer = analyzer;
    if (typeof reportSourcesOrTimeout === "number") {
      if (requestTimeoutMs !== DEFAULT_HTTP_TIMEOUT_MS) {
        throw new Error(
          "MattermostClient timeout-only constructor does not accept a fourth argument",
        );
      }
      this.discoverabilityResults = undefined;
      this.searchHealthResults = undefined;
      this.humanInvocationGate = undefined;
      this.invocationAudit = undefined;
      this.managedInstanceSurfaceDiagnostics = undefined;
      this.requestTimeoutMs = clampTimeout(reportSourcesOrTimeout);
    } else {
      this.discoverabilityResults = reportSourcesOrTimeout?.discoverabilityResults;
      this.searchHealthResults = reportSourcesOrTimeout?.searchHealthResults;
      this.humanInvocationGate = reportSourcesOrTimeout?.humanInvocationGate;
      this.invocationAudit = reportSourcesOrTimeout?.invocationAudit;
      this.managedInstanceSurfaceDiagnostics =
        reportSourcesOrTimeout?.managedInstanceSurfaceDiagnostics;
      this.requestTimeoutMs = clampTimeout(requestTimeoutMs);
    }
  }

  /** Post a plain-text message to the configured Mattermost channel. */
  async post(text: string): Promise<void> {
    await this.postPayload({ text });
  }

  async postPeriodicReport(report: PeriodicReportInput): Promise<void> {
    const color = healthColor(report.healthScore);
    const status = healthStatus(report.healthScore);
    const metricsLines = [
      metricLine(
        "Health score",
        formatMaybe(report.healthScore, (v) => `${v}/100`),
      ),
      metricLine(
        "Peers",
        formatMaybe(report.peerCount, (v) => String(v)),
      ),
      metricLine(
        "Routing buckets",
        formatMaybe(report.routingBucketCount, (v) => String(v)),
      ),
      metricLine(
        "Lookup success",
        formatMaybe(report.lookupSuccessPct, (v) => `${v.toFixed(1)}%`),
      ),
      metricLine(
        "Timeout rate",
        formatMaybe(report.lookupTimeoutPct, (v) => `${v.toFixed(1)}%`),
      ),
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const summaryText = report.summary.trim().length > 0 ? report.summary : "(no summary)";
    const targetLine = report.targetLabel ? `Target: ${report.targetLabel}` : undefined;
    const attachments: MattermostAttachment[] = [
      {
        title: "Node Metrics",
        color,
        text: metricsLines || "No metrics available",
      },
      {
        title: "Observations",
        color: "#3498db",
        text: summaryText,
      },
    ];
    const discoverabilityAttachment = await this.buildDiscoverabilityAttachment();
    if (discoverabilityAttachment) {
      attachments.push(discoverabilityAttachment);
    }
    const searchHealthAttachment = await this.buildSearchHealthAttachment();
    if (searchHealthAttachment) {
      attachments.push(searchHealthAttachment);
    }
    const surfaceDiagnosticsAttachment = await this.buildManagedInstanceSurfaceAttachment(report);
    if (surfaceDiagnosticsAttachment) {
      attachments.push(surfaceDiagnosticsAttachment);
    }

    const payload: MattermostPayload = {
      text: ["mule-doctor", targetLine, "", `Node status: ${status}`]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
      attachments,
    };
    await this.postPayload(payload);
  }

  async postDailyUsageReport(summary: UsageSummary): Promise<void> {
    const payload: MattermostPayload = {
      text: "rust-mule spending report",
      attachments: [
        {
          title: "Today's usage",
          color: "#f1c40f",
          text: usageBucketText(summary.today, summary.dateKey),
        },
        {
          title: "Monthly usage",
          color: "#3498db",
          text: usageBucketText(summary.month, summary.monthKey),
        },
      ],
    };
    await this.postPayload(payload);
  }

  async postPatchProposal(input: PatchProposalInput): Promise<void> {
    const { body, truncated } = clampPatchBody(input.diff, MAX_PATCH_BODY_CHARS);
    const payload: MattermostPayload = {
      text: "rust-mule patch proposal available",
      attachments: [
        {
          title: "Patch Proposal Metadata",
          color: "#3498db",
          text: [
            `Artifact: ${input.artifactPath}`,
            `Bytes: ${input.bytes}`,
            `Lines: ${input.lines}`,
            `Content truncated: ${truncated ? "yes" : "no"}`,
          ].join("\n"),
        },
        {
          title: "Patch Content",
          color: "#f1c40f",
          text: `\`\`\`diff\n${escapeCodeFence(body)}\n\`\`\``,
        },
      ],
    };
    await this.postPayload(payload);
  }

  private async postPayload(payload: MattermostPayload): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.requestTimeoutMs);

    let res: Response;
    try {
      res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new Error(`Mattermost webhook timed out after ${this.requestTimeoutMs}ms`, {
          cause: err,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new Error(`Mattermost webhook error: ${res.status}`);
    }
    log("info", "mattermost", "Message posted");
  }

  /**
   * Handle an inbound command string (from a bot mention or slash command).
   *
   * Supported commands:
   *   @mule-doctor status   – brief node status
   *   @mule-doctor analyze  – full LLM diagnostic
   *   @mule-doctor peers    – peer list summary
   */
  async handleCommand(ctx: MattermostCommandContext): Promise<void> {
    const cmd = ctx.command
      .trim()
      .replace(/^@mule-doctor\s*/i, "")
      .toLowerCase();
    log("info", "mattermost", `Handling command: ${cmd}`);

    const prompt = buildMattermostCommandPrompt(cmd);
    if (!prompt) {
      await this.post(
        `Unknown command: \`${cmd}\`.\n` + "Available commands: `status`, `analyze`, `peers`",
      );
      return;
    }

    const normalizedTriggeredBy = normalizeInvocationKeyPart(ctx.triggeredBy);
    const decision = this.humanInvocationGate?.tryAcquire([
      { key: "human_llm:global", cooldownMs: 30_000 },
      { key: "human_llm:mattermost", cooldownMs: 60_000 },
      ...(normalizedTriggeredBy
        ? [{ key: `human_llm:mattermost:user:${normalizedTriggeredBy}`, cooldownMs: 60_000 }]
        : []),
    ]);
    if (decision && !decision.ok) {
      await this.appendInvocationAudit({
        surface: "mattermost_command",
        trigger: "human",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        toolCalls: 0,
        toolRounds: 0,
        finishReason: "rate_limited",
        command: cmd,
        rateLimitReason: decision.reason,
        retryAfterSec: decision.retryAfterSec,
      });
      await this.post(
        `LLM analysis is temporarily rate-limited (${decision.reason}). Retry in about ${decision.retryAfterSec}s.`,
      );
      return;
    }

    try {
      const response = await this.analyzer.analyze(prompt, {
        surface: "mattermost_command",
        trigger: "human",
        command: cmd,
      });
      await this.post(response);
    } finally {
      decision?.lease.release();
    }
  }

  private async appendInvocationAudit(record: {
    surface: "mattermost_command";
    trigger: "human";
    startedAt: string;
    completedAt: string;
    durationMs: number;
    toolCalls: number;
    toolRounds: number;
    finishReason: "rate_limited";
    command?: string;
    rateLimitReason?: "cooldown" | "in_flight";
    retryAfterSec?: number;
  }): Promise<void> {
    if (!this.invocationAudit) {
      return;
    }
    try {
      await this.invocationAudit.append({
        recordedAt: record.completedAt,
        surface: record.surface,
        trigger: record.trigger,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        durationMs: record.durationMs,
        toolCalls: record.toolCalls,
        toolRounds: record.toolRounds,
        finishReason: record.finishReason,
        command: record.command,
        rateLimitReason: record.rateLimitReason,
        retryAfterSec: record.retryAfterSec,
      });
    } catch (err) {
      log("warn", "mattermost", `Failed to append invocation audit: ${String(err)}`);
    }
  }

  private async buildDiscoverabilityAttachment(): Promise<MattermostAttachment | undefined> {
    if (!this.discoverabilityResults) {
      return undefined;
    }
    let summary: ManagedDiscoverabilitySummary;
    try {
      summary = await this.discoverabilityResults.summarizeRecent(
        DEFAULT_DISCOVERABILITY_REPORT_LIMIT,
      );
    } catch (err) {
      log(
        "warn",
        "mattermost",
        `Failed to load discoverability report summary: ${String(err)}`,
      );
      return undefined;
    }
    if (summary.totalChecks === 0) {
      return undefined;
    }
    const lines = [
      `Window: ${summary.windowSize} recent checks`,
      `Found: ${summary.foundCount}`,
      `Completed empty: ${summary.completedEmptyCount}`,
      `Timed out: ${summary.timedOutCount}`,
      summary.successRatePct !== undefined
        ? `Success rate: ${summary.successRatePct.toFixed(1)}%`
        : undefined,
      summary.latestOutcome ? `Latest outcome: ${summary.latestOutcome}` : undefined,
      summary.latestPair
        ? `Latest path: ${summary.latestPair.publisherInstanceId} -> ${summary.latestPair.searcherInstanceId}`
        : undefined,
      summary.latestQuery ? `Latest query: ${summary.latestQuery}` : undefined,
      summary.lastSuccessAt ? `Last success: ${summary.lastSuccessAt}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
    return {
      title: "Discoverability Summary",
      color: "#8cf0c6",
      text: lines,
    };
  }

  private async buildSearchHealthAttachment(): Promise<MattermostAttachment | undefined> {
    if (!this.searchHealthResults) {
      return undefined;
    }
    let summary: SearchHealthSummary;
    try {
      summary = await this.searchHealthResults.summarizeRecent(DEFAULT_SEARCH_HEALTH_REPORT_LIMIT);
    } catch (err) {
      log("warn", "mattermost", `Failed to load search health summary: ${String(err)}`);
      return undefined;
    }
    if (summary.totalSearches === 0) {
      return undefined;
    }
    const lines = [
      `Window: ${summary.windowSize} recent searches`,
      `Found: ${summary.foundCount}`,
      `Completed empty: ${summary.completedEmptyCount}`,
      `Timed out: ${summary.timedOutCount}`,
      `Dispatch-ready: ${summary.dispatchReadyCount}`,
      `Dispatch-not-ready: ${summary.dispatchNotReadyCount}`,
      `Degraded transport: ${summary.degradedTransportCount}`,
      summary.successRatePct !== undefined
        ? `Success rate: ${summary.successRatePct.toFixed(1)}%`
        : undefined,
      summary.latestOutcome ? `Latest outcome: ${summary.latestOutcome}` : undefined,
      summary.latestPair
        ? `Latest path: ${summary.latestPair.publisherInstanceId} -> ${summary.latestPair.searcherInstanceId}`
        : undefined,
      summary.latestQuery ? `Latest query: ${summary.latestQuery}` : undefined,
      summary.lastSuccessAt ? `Last success: ${summary.lastSuccessAt}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
    return {
      title: "Search Health Summary",
      color: "#7fd1ff",
      text: lines,
    };
  }

  private async buildManagedInstanceSurfaceAttachment(
    report: PeriodicReportInput,
  ): Promise<MattermostAttachment | undefined> {
    if (
      !this.managedInstanceSurfaceDiagnostics ||
      report.target?.kind !== "managed_instance" ||
      !report.target.instanceId
    ) {
      return undefined;
    }

    try {
      const diagnostics = await this.managedInstanceSurfaceDiagnostics.getSummary(
        report.target.instanceId,
      );
      return {
        title: "Managed Surface Diagnostics",
        color: "#9b59b6",
        text: [
          `Instance: ${diagnostics.instanceId}`,
          `Observed: ${diagnostics.observedAt}`,
          `Searches: ${diagnostics.summary.searches.totalSearches} total, ${diagnostics.summary.searches.activeSearches} active, ready=${diagnostics.summary.searches.ready ? "yes" : "no"}`,
          `Shared files: ${diagnostics.summary.sharedLibrary.totalFiles}, keyword queued=${diagnostics.summary.sharedLibrary.keywordPublishQueuedCount}, failed=${diagnostics.summary.sharedLibrary.keywordPublishFailedCount}, acked=${diagnostics.summary.sharedLibrary.keywordPublishAckedCount}`,
          `Downloads: ${diagnostics.summary.downloads.totalDownloads} total, ${diagnostics.summary.downloads.activeDownloads} active, errors=${diagnostics.summary.downloads.downloadsWithErrors}`,
        ].join("\n"),
      };
    } catch (err) {
      log(
        "warn",
        "mattermost",
        `Failed to load managed surface diagnostics: ${String(err)}`,
      );
      return undefined;
    }
  }
}

export function buildMattermostCommandPrompt(cmd: string): string | undefined {
  switch (cmd) {
    case "status":
      return [
        "Provide a brief rust-mule status summary in 3 to 5 bullets.",
        "Use tools only if needed to verify an important uncertainty.",
        "Focus on current health, readiness, and any clearly visible issues.",
      ].join(" ");
    case "analyze":
      return [
        "Perform a focused diagnostic analysis of the rust-mule node.",
        "Start from currently available context.",
        "Use tools only to verify important uncertainties or fill missing evidence gaps.",
        "Do not use all tools by default.",
        "Return: overall status, confirmed issues, probable issues or risks, hypotheses or unknowns, supporting evidence, and recommended next steps.",
      ].join(" ");
    case "peers":
      return [
        "Summarize the current peer situation.",
        "Focus on total peer count, obvious connectivity concerns, and any evidence of degraded peer health.",
        "Use tools only if needed to confirm missing evidence.",
      ].join(" ");
    default:
      return undefined;
  }
}

function healthColor(score: number | undefined): string {
  if (typeof score !== "number") return "#3498db";
  if (score >= 80) return "#2ecc71";
  if (score >= 60) return "#f1c40f";
  return "#e74c3c";
}

function healthStatus(score: number | undefined): string {
  if (typeof score !== "number") return "UNKNOWN";
  if (score >= 80) return "HEALTHY";
  if (score >= 60) return "WARNING";
  return "DEGRADED";
}

function metricLine(label: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return `${label}: ${value}`;
}

function formatMaybe<T>(value: T | undefined, formatter: (value: T) => string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return formatter(value);
}

function usageBucketText(
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

const MAX_PATCH_BODY_CHARS = 12_000;

function clampPatchBody(diff: string, maxChars: number): { body: string; truncated: boolean } {
  if (diff.length <= maxChars) {
    return { body: diff, truncated: false };
  }
  return { body: diff.slice(0, maxChars), truncated: true };
}

function escapeCodeFence(text: string): string {
  return text.replaceAll("```", "``\\`");
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}

function clampTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 100 || value > 120_000) {
    return DEFAULT_HTTP_TIMEOUT_MS;
  }
  return value;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    typeof err["name"] === "string" &&
    err["name"] === "AbortError"
  );
}
