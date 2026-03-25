import type {
  BootstrapJobResult,
  RustMuleClient,
  TraceLookupResult,
} from "../api/rustMuleClient.js";
import type { RegisteredTool, RecentLogSource } from "./toolRegistryShared.js";
import { clampInt } from "./toolRegistryShared.js";

interface SearchLogsResult {
  query: string;
  scannedLines: number;
  totalMatches: number;
  matches: string[];
}

export function buildCoreTools(
  client: RustMuleClient,
  logWatcher: RecentLogSource,
): RegisteredTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "getNodeInfo",
          description: "Returns basic information about the rust-mule node.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: () => client.getNodeInfo(),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getPeers",
          description: "Returns the list of peers currently connected to the node.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: () => client.getPeers(),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getRoutingBuckets",
          description: "Returns the current state of the routing table buckets.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: () => client.getRoutingBuckets(),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getLookupStats",
          description: "Returns aggregate statistics for node lookups.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: () => client.getLookupStats(),
    },
    {
      definition: {
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
      handler: async (args) => {
        const n = clampInt(args["n"], 50, 1, 1000);
        return logWatcher.getRecentLines(n);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "searchLogs",
          description: "Searches recent rust-mule logs using safe bounded substring matching.",
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
      handler: async (args): Promise<SearchLogsResult> => {
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
      },
    },
    {
      definition: {
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
      handler: async (args): Promise<BootstrapJobResult> =>
        client.triggerBootstrap({
          pollIntervalMs: clampInt(args["pollIntervalMs"], 500, 10, 30_000),
          maxWaitMs: clampInt(args["maxWaitMs"], 15_000, 100, 300_000),
        }),
    },
    {
      definition: {
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
      handler: async (args): Promise<TraceLookupResult> => {
        const targetId = typeof args["target_id"] === "string" ? args["target_id"] : undefined;
        return client.traceLookup(targetId, {
          pollIntervalMs: clampInt(args["pollIntervalMs"], 500, 10, 30_000),
          maxWaitMs: clampInt(args["maxWaitMs"], 15_000, 100, 300_000),
        });
      },
    },
  ];
}
