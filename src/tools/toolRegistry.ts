/**
 * toolRegistry.ts
 * Registers callable tools that the LLM can invoke via the OpenAI
 * function-calling / tool-use interface.
 */

import type {
  BootstrapJobResult,
  RustMuleClient,
  TraceLookupResult,
} from "../api/rustMuleClient.js";
import type { LogWatcher } from "../logs/logWatcher.js";
import type { RuntimeStore } from "../storage/runtimeStore.js";
import type { HistoryEntry, ToolResult } from "../types/contracts.js";

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

interface SearchLogsResult {
  query: string;
  scannedLines: number;
  totalMatches: number;
  matches: string[];
}

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();
  private readonly definitions: ToolDefinition[] = [];

  constructor(client: RustMuleClient, logWatcher: LogWatcher, runtimeStore?: RuntimeStore) {
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
        const n = clampInt(args["n"], 50, 1, 1000);
        return Promise.resolve(logWatcher.getRecentLines(n));
      }
    );

    if (runtimeStore) {
      this.register(
        {
          type: "function",
          function: {
            name: "getHistory",
            description: "Returns recent persisted history snapshots from mule-doctor.",
            parameters: {
              type: "object",
              properties: {
                n: {
                  type: "number",
                  description: "Number of recent history entries to return (default 50).",
                },
              },
              required: [],
            },
          },
        },
        async (args): Promise<HistoryEntry[]> => {
          const n = clampInt(args["n"], 50, 1, 1000);
          return runtimeStore.getRecentHistory(n);
        }
      );
    }

    this.register(
      {
        type: "function",
        function: {
          name: "searchLogs",
          description:
            "Searches recent rust-mule logs using safe bounded substring matching.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Literal text to find in logs.",
              },
              n: {
                type: "number",
                description: "Number of recent lines to scan (default 500).",
              },
              limit: {
                type: "number",
                description: "Maximum number of matches to return (default 50).",
              },
              caseSensitive: {
                type: "boolean",
                description: "Whether matching should be case-sensitive (default false).",
              },
            },
            required: ["query"],
          },
        },
      },
      async (args): Promise<SearchLogsResult> => {
        const query = typeof args["query"] === "string" ? args["query"].trim() : "";
        if (!query) {
          throw new Error("searchLogs requires non-empty query");
        }

        const n = clampInt(args["n"], 500, 1, 5000);
        const limit = clampInt(args["limit"], 50, 1, 200);
        const caseSensitive = args["caseSensitive"] === true;

        const lines = logWatcher.getRecentLines(n);
        const needle = caseSensitive ? query : query.toLowerCase();

        let totalMatches = 0;
        const matches: string[] = [];
        for (const line of lines) {
          const haystack = caseSensitive ? line : line.toLowerCase();
          if (!haystack.includes(needle)) continue;
          totalMatches += 1;
          if (matches.length < limit) {
            matches.push(line);
          }
        }

        return {
          query,
          scannedLines: lines.length,
          totalMatches,
          matches,
        };
      }
    );

    this.register(
      {
        type: "function",
        function: {
          name: "triggerBootstrap",
          description:
            "Triggers debug bootstrap restart and polls until the job reaches a terminal state.",
          parameters: {
            type: "object",
            properties: {
              pollIntervalMs: {
                type: "number",
                description: "Polling interval in milliseconds (default 500).",
              },
              maxWaitMs: {
                type: "number",
                description: "Maximum polling duration in milliseconds (default 15000).",
              },
            },
            required: [],
          },
        },
      },
      async (args): Promise<BootstrapJobResult> => {
        return client.triggerBootstrap({
          pollIntervalMs: clampInt(args["pollIntervalMs"], 500, 10, 30_000),
          maxWaitMs: clampInt(args["maxWaitMs"], 15_000, 100, 300_000),
        });
      }
    );

    this.register(
      {
        type: "function",
        function: {
          name: "traceLookup",
          description:
            "Runs debug trace lookup for an optional target key and returns per-hop results.",
          parameters: {
            type: "object",
            properties: {
              target_id: {
                type: "string",
                description: "Optional target key (hex/base64 per rust-mule format).",
              },
              pollIntervalMs: {
                type: "number",
                description: "Polling interval in milliseconds (default 500).",
              },
              maxWaitMs: {
                type: "number",
                description: "Maximum polling duration in milliseconds (default 15000).",
              },
            },
            required: [],
          },
        },
      },
      async (args): Promise<TraceLookupResult> => {
        const targetId = typeof args["target_id"] === "string" ? args["target_id"] : undefined;
        return client.traceLookup(targetId, {
          pollIntervalMs: clampInt(args["pollIntervalMs"], 500, 10, 30_000),
          maxWaitMs: clampInt(args["maxWaitMs"], 15_000, 100, 300_000),
        });
      }
    );
  }

  private register(def: ToolDefinition, handler: ToolHandler): void {
    this.definitions.push(def);
    this.handlers.set(def.function.name, handler);
  }

  /** All tool definitions to send to the OpenAI API. */
  getDefinitions(): ToolDefinition[] {
    return [...this.definitions];
  }

  /** Invoke a tool by name with parsed arguments and return a structured result envelope. */
  async invoke(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        tool: name,
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }
    try {
      const data = await handler(args);
      return {
        tool: name,
        success: true,
        data,
      };
    } catch (err) {
      return {
        tool: name,
        success: false,
        error: String(err),
      };
    }
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
