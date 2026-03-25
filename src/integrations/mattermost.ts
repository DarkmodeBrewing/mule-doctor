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
import {
  buildDailyUsagePayload,
  buildPatchProposalPayload,
  buildPeriodicReportPayload,
} from "./mattermostPayloadBuilders.js";
import {
  clampTimeout,
  DEFAULT_HTTP_TIMEOUT_MS,
  isAbortError,
  log,
} from "./mattermostShared.js";
import type {
  DiscoverabilityReportSource,
  MattermostCommandContext,
  MattermostPayload,
  MattermostReportSources,
  PatchProposalInput,
  PeriodicReportInput,
  SearchHealthReportSource,
} from "./mattermostShared.js";

export type {
  DiscoverabilityReportSource,
  MattermostCommandContext,
  MattermostReportSources,
  PatchProposalInput,
  PeriodicReportInput,
  SearchHealthReportSource,
} from "./mattermostShared.js";

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
    await this.postPayload(
      await buildPeriodicReportPayload(report, {
        discoverabilityResults: this.discoverabilityResults,
        searchHealthResults: this.searchHealthResults,
        managedInstanceSurfaceDiagnostics: this.managedInstanceSurfaceDiagnostics,
      }),
    );
  }

  async postDailyUsageReport(summary: UsageSummary): Promise<void> {
    await this.postPayload(buildDailyUsagePayload(summary));
  }

  async postPatchProposal(input: PatchProposalInput): Promise<void> {
    await this.postPayload(buildPatchProposalPayload(input));
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
      const recordedAt = new Date().toISOString();
      await this.appendInvocationAudit({
        surface: "mattermost_command",
        trigger: "human",
        startedAt: recordedAt,
        completedAt: recordedAt,
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
