/**
 * mattermost.ts
 * Mattermost integration: posts status reports via incoming webhook and
 * handles inbound slash-command / mention payloads.
 */

import type { Analyzer } from "../llm/analyzer.js";
import type { UsageSummary } from "../llm/usageTracker.js";

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

const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

export class MattermostClient {
  private readonly webhookUrl: string;
  private readonly analyzer: Analyzer;
  private readonly requestTimeoutMs: number;

  constructor(webhookUrl: string, analyzer: Analyzer, requestTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS) {
    this.webhookUrl = webhookUrl;
    this.analyzer = analyzer;
    this.requestTimeoutMs = clampTimeout(requestTimeoutMs);
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
    const payload: MattermostPayload = {
      text: ["mule-doctor", targetLine, "", `Node status: ${status}`]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
      attachments: [
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
      ],
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

    let prompt: string;
    switch (cmd) {
      case "status":
        prompt = "Provide a brief (3–5 bullet point) status summary of the rust-mule node.";
        break;
      case "analyze":
        prompt =
          "Perform a thorough diagnostic analysis of the rust-mule node. " +
          "Use all available tools and report any issues, anomalies, or recommendations.";
        break;
      case "peers":
        prompt =
          "Summarize the current peer list: total count, geographic spread if known, " +
          "any peers with high latency or connectivity issues.";
        break;
      default:
        await this.post(
          `Unknown command: \`${cmd}\`.\n` + "Available commands: `status`, `analyze`, `peers`",
        );
        return;
    }

    const response = await this.analyzer.analyze(prompt);
    await this.post(response);
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
