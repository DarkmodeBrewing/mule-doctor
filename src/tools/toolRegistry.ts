/**
 * toolRegistry.ts
 * Registers callable tools that the LLM can invoke via the OpenAI
 * function-calling / tool-use interface.
 */

import type { RustMuleClient } from "../api/rustMuleClient.js";
import type { LogWatcher } from "../logs/logWatcher.js";

/** Shape expected by the OpenAI tools array. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** A callable implementation keyed by tool name. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();
  private readonly definitions: ToolDefinition[] = [];

  constructor(client: RustMuleClient, logWatcher: LogWatcher) {
    this.register(
      {
        type: "function",
        function: {
          name: "getNodeInfo",
          description: "Returns basic information about the rust-mule node.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      () => client.getNodeInfo()
    );

    this.register(
      {
        type: "function",
        function: {
          name: "getPeers",
          description: "Returns the list of peers currently connected to the node.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      () => client.getPeers()
    );

    this.register(
      {
        type: "function",
        function: {
          name: "getRoutingBuckets",
          description: "Returns the current state of the routing table buckets.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      () => client.getRoutingBuckets()
    );

    this.register(
      {
        type: "function",
        function: {
          name: "getLookupStats",
          description: "Returns aggregate statistics for node lookups.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      () => client.getLookupStats()
    );

    this.register(
      {
        type: "function",
        function: {
          name: "getRecentLogs",
          description: "Returns the most recent log lines from the rust-mule node.",
          parameters: {
            type: "object",
            properties: {
              n: {
                type: "number",
                description: "Number of recent lines to return (default 50).",
              },
            },
            required: [],
          },
        },
      },
      (args) => {
        const n = typeof args["n"] === "number" ? args["n"] : 50;
        return Promise.resolve(logWatcher.getRecentLines(n));
      }
    );
  }

  private register(def: ToolDefinition, handler: ToolHandler): void {
    this.definitions.push(def);
    this.handlers.set(def.function.name, handler);
  }

  /** All tool definitions to send to the OpenAI API. */
  getDefinitions(): ToolDefinition[] {
    return this.definitions;
  }

  /** Invoke a tool by name with parsed arguments. Throws if the tool is unknown. */
  async invoke(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return handler(args);
  }
}
