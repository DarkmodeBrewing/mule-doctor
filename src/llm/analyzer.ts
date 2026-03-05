/**
 * analyzer.ts
 * LLM-powered diagnostic analysis using the OpenAI Chat Completions API
 * with tool calling.  The model may call any tool registered in the
 * ToolRegistry to gather node data before producing its summary.
 */

import type { ToolRegistry } from "../tools/toolRegistry.js";
import type { ToolResult } from "../types/contracts.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5-mini";
const MAX_TOOL_ROUNDS = 5;

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
}

const SYSTEM_PROMPT = `You are mule-doctor, an expert diagnostic agent for rust-mule P2P nodes.
You have access to tools that can query the live node. Use them to gather relevant data, then
provide a concise, structured diagnostic report covering: node health, peer connectivity,
routing table status, and any anomalies visible in recent logs.`;

export interface AnalyzerConfig {
  model?: string;
}

export class Analyzer {
  private readonly apiKey: string;
  private readonly tools: ToolRegistry;
  private readonly model: string;

  constructor(apiKey: string, tools: ToolRegistry, config: AnalyzerConfig = {}) {
    this.apiKey = apiKey;
    this.tools = tools;
    const model = config.model?.trim();
    this.model = model && model.length > 0 ? model : DEFAULT_MODEL;
  }

  /**
   * Run a full agentic diagnostic cycle.
   * The LLM may call tools multiple times before producing a final summary.
   */
  async analyze(prompt: string): Promise<string> {
    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.chatCompletion(messages);
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
        log("info", "analyzer", `Tool ${call.function.name} → ${result.slice(0, 80)}…`);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: result,
        });
      }
    }

    return "(analysis incomplete: tool round limit reached)";
  }

  private async chatCompletion(messages: Message[]): Promise<ChatResponse> {
    const body = JSON.stringify({
      model: this.model,
      messages,
      tools: this.tools.getDefinitions(),
      tool_choice: "auto",
    });

    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<ChatResponse>;
  }

  private async executeToolCall(call: ToolCall): Promise<ToolResult> {
    let args: Record<string, unknown> = {};
    if (call.function.arguments && call.function.arguments.trim().length > 0) {
      try {
        args = JSON.parse(call.function.arguments) as Record<string, unknown>;
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
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
