/**
 * analyzer.ts
 * LLM-powered diagnostic analysis using the official OpenAI SDK
 * (Chat Completions API with tool calling). The model may call any
 * tool registered in the ToolRegistry to gather node data before
 * producing its summary.
 */

import OpenAI from "openai";
import type { ToolRegistry } from "../tools/toolRegistry.js";
import type { ToolResult } from "../types/contracts.js";
import { type UsageSummary, type UsageTracker } from "./usageTracker.js";

const DEFAULT_MODEL = "gpt-5-mini";
const MAX_TOOL_ROUNDS = 5;

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type ToolDefinition = OpenAI.Chat.Completions.ChatCompletionTool;

export function buildSystemPrompt(): string {
  return `You are mule-doctor, an external diagnostic agent for rust-mule.
You must diagnose using observable runtime surfaces only:
- documented HTTP endpoints
- logs
- persisted state and history
- explicit diagnostic tools exposed to you

Do not rely on guessed internals. Do not invent missing facts.

Tool-use policy:
- Start from the provided prompt and supplied context.
- Do not call tools if the provided context already answers the question.
- Use the fewest tools needed to verify important uncertainties.
- Do not repeat equivalent tool calls unless you need to confirm a changed state.
- Tool budget is limited. Prefer targeted verification over broad exploration.
- If evidence is sufficient, stop calling tools and answer.
- If evidence remains incomplete, say so explicitly.

Diagnostic rules:
- Separate confirmed issues, probable issues, and hypotheses.
- Cite the source of each important conclusion: snapshot, logs, history, endpoint/tool result, or prior state.
- If the target is unavailable or not ready, say that directly instead of presenting a healthy diagnosis.
- Prefer concise, high-signal findings over exhaustive narration.

Output format:
1. Overall status
2. Confirmed issues
3. Probable issues or risks
4. Hypotheses or unknowns
5. Supporting evidence
6. Recommended next steps`;
}

export interface AnalyzerConfig {
  model?: string;
  usageTracker?: UsageTracker;
}

export class Analyzer {
  private readonly client: OpenAI;
  private readonly tools: ToolRegistry;
  private readonly model: string;
  private readonly usageTracker: UsageTracker | undefined;

  constructor(apiKey: string, tools: ToolRegistry, config: AnalyzerConfig = {}) {
    this.client = new OpenAI({ apiKey });
    this.tools = tools;
    const model = config.model?.trim();
    this.model = model && model.length > 0 ? model : DEFAULT_MODEL;
    this.usageTracker = config.usageTracker;
  }

  /**
   * Run a full agentic diagnostic cycle.
   * The LLM may call tools multiple times before producing a final summary.
   */
  async analyze(prompt: string): Promise<string> {
    const messages: Message[] = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: prompt },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.chatCompletion(messages);
      if (!response.choices.length) {
        throw new Error("OpenAI response contained no choices");
      }
      const choice = response.choices[0];
      const msg = choice.message;

      messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });

      if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
        return msg.content ?? "(no response)";
      }

      // Execute all tool calls requested in this round.
      for (const call of msg.tool_calls) {
        const toolResult = await this.executeToolCall(call);
        const result = JSON.stringify(toolResult);
        log(
          "info",
          "analyzer",
          `Tool ${readToolCallName(call)} completed (success=${toolResult.success})`,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    return "(analysis incomplete: tool round limit reached)";
  }

  private async chatCompletion(messages: Message[]) {
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: this.tools.getDefinitions() as ToolDefinition[],
        tool_choice: "auto",
      });
    } catch (err) {
      throw new Error(`OpenAI API request failed: ${formatError(err)}`, { cause: err });
    }

    if (this.usageTracker) {
      const usage = response.usage;
      const modelUsed = response.model ?? this.model;
      try {
        await this.usageTracker.record({
          timestamp: new Date().toISOString(),
          model: modelUsed,
          tokensIn: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
          tokensOut: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
        });
      } catch (err) {
        log("warn", "analyzer", `Usage tracking failed: ${String(err)}`);
      }
    }

    return response;
  }

  private async executeToolCall(call: ToolCall): Promise<ToolResult> {
    if (call.type !== "function") {
      return {
        tool: "unknown",
        success: false,
        error: `Unsupported tool call type: ${call.type}`,
      };
    }

    let args: Record<string, unknown> = {};
    const rawArgs = call.function.arguments?.trim();
    if (rawArgs && rawArgs.length > 0) {
      try {
        args = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch (err) {
        return {
          tool: call.function.name,
          success: false,
          error: `Invalid tool arguments: ${String(err)}`,
        };
      }
    }
    return this.tools.invoke(call.function.name, args);
  }

  async consumeDailyUsageReport(): Promise<UsageSummary | null> {
    if (!this.usageTracker) return null;
    return this.usageTracker.consumeDailyReport();
  }
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}

function formatError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    const details = [`status=${err.status ?? "unknown"}`];
    if (typeof err.code === "string" || typeof err.code === "number") {
      details.push(`code=${String(err.code)}`);
    }
    if (typeof err.type === "string" && err.type.length > 0) {
      details.push(`type=${err.type}`);
    }
    return `${details.join(" ")}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function readToolCallName(call: ToolCall): string {
  if (call.type === "function") {
    return call.function.name;
  }
  return "unknown";
}
