/**
 * mattermost.ts
 * Mattermost integration: posts status reports via incoming webhook and
 * handles inbound slash-command / mention payloads.
 */

import type { Analyzer } from "../llm/analyzer.js";

export interface MattermostCommandContext {
  command: string;
  triggeredBy?: string;
}

export class MattermostClient {
  private readonly webhookUrl: string;
  private readonly analyzer: Analyzer;

  constructor(webhookUrl: string, analyzer: Analyzer) {
    this.webhookUrl = webhookUrl;
    this.analyzer = analyzer;
  }

  /** Post a plain-text message to the configured Mattermost channel. */
  async post(text: string): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
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
    const cmd = ctx.command.trim().replace(/^@mule-doctor\s*/i, "").toLowerCase();
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
          `Unknown command: \`${cmd}\`.\n` +
            "Available commands: `status`, `analyze`, `peers`"
        );
        return;
    }

    const response = await this.analyzer.analyze(prompt);
    await this.post(response);
  }
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
