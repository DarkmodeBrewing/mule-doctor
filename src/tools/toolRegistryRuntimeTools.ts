import type { RuntimeStore } from "../storage/runtimeStore.js";
import type {
  HistoryEntry,
  LlmInvocationRecord,
  LlmInvocationSummary,
  ManagedDiscoverabilityRecord,
  ManagedDiscoverabilitySummary,
  SearchHealthRecord,
  SearchHealthSummary,
} from "../types/contracts.js";
import { summarizeDiscoverabilityResults } from "../discoverability/summary.js";
import { summarizeLlmInvocationRecords } from "../llm/invocationAuditSummary.js";
import { sanitizeSearchHealthRecord } from "../searchHealth/records.js";
import { summarizeSearchHealthRecords } from "../searchHealth/summary.js";
import {
  clampInt,
  type RegisteredTool,
  sanitizeDiscoverabilityRecord,
} from "./toolRegistryShared.js";

export function buildRuntimeTools(runtimeStore?: RuntimeStore): RegisteredTool[] {
  if (!runtimeStore) {
    return [];
  }

  return [
    {
      definition: {
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
      handler: async (args): Promise<HistoryEntry[]> => {
        const n = clampInt(args["n"], 50, 1, 1000);
        return runtimeStore.getRecentHistory(n);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getLlmInvocationResults",
          description:
            "Returns recent bounded LLM invocation audit records recorded by mule-doctor.",
          parameters: {
            type: "object",
            properties: {
              n: {
                type: "number",
                description: "Number of recent invocation records to return (default 10).",
              },
            },
            required: [],
          },
        },
      },
      handler: async (args): Promise<LlmInvocationRecord[]> => {
        const n = clampInt(args["n"], 10, 1, 100);
        return runtimeStore.getRecentLlmInvocationRecords(n);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getLlmInvocationSummary",
          description:
            "Returns a compact summary over recent mule-doctor LLM invocation audit records.",
          parameters: {
            type: "object",
            properties: {
              n: {
                type: "number",
                description: "Number of recent invocation records to summarize (default 20).",
              },
            },
            required: [],
          },
        },
      },
      handler: async (args): Promise<LlmInvocationSummary> => {
        const n = clampInt(args["n"], 20, 1, 100);
        const records = await runtimeStore.getRecentLlmInvocationRecords(n);
        return summarizeLlmInvocationRecords(records, n);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getDiscoverabilityResults",
          description:
            "Returns recent persisted controlled discoverability checks recorded by mule-doctor.",
          parameters: {
            type: "object",
            properties: {
              n: {
                type: "number",
                description: "Number of recent discoverability records to return (default 10).",
              },
            },
            required: [],
          },
        },
      },
      handler: async (args): Promise<ManagedDiscoverabilityRecord[]> => {
        const n = clampInt(args["n"], 10, 1, 100);
        const records = await runtimeStore.getRecentDiscoverabilityResults(n);
        return records.map(sanitizeDiscoverabilityRecord);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getDiscoverabilitySummary",
          description:
            "Returns a compact summary of recent controlled discoverability outcomes recorded by mule-doctor.",
          parameters: {
            type: "object",
            properties: {
              n: {
                type: "number",
                description: "Number of recent discoverability records to summarize (default 10).",
              },
            },
            required: [],
          },
        },
      },
      handler: async (args): Promise<ManagedDiscoverabilitySummary> => {
        const n = clampInt(args["n"], 10, 1, 100);
        const records = await runtimeStore.getRecentDiscoverabilityResults(n);
        return summarizeDiscoverabilityResults(records.map(sanitizeDiscoverabilityRecord));
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getSearchHealthResults",
          description: "Returns recent persisted search lifecycle records recorded by mule-doctor.",
          parameters: {
            type: "object",
            properties: {
              n: {
                type: "number",
                description: "Number of recent search health records to return (default 10).",
              },
            },
            required: [],
          },
        },
      },
      handler: async (args): Promise<SearchHealthRecord[]> => {
        const n = clampInt(args["n"], 10, 1, 100);
        const records = await runtimeStore.getRecentSearchHealthResults(n);
        return records.map(sanitizeSearchHealthRecord);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getSearchHealthSummary",
          description:
            "Returns a compact summary of recent persisted search lifecycle records recorded by mule-doctor.",
          parameters: {
            type: "object",
            properties: {
              n: {
                type: "number",
                description: "Number of recent search health records to summarize (default 10).",
              },
            },
            required: [],
          },
        },
      },
      handler: async (args): Promise<SearchHealthSummary> => {
        const n = clampInt(args["n"], 10, 1, 100);
        const records = await runtimeStore.getRecentSearchHealthResults(n);
        return summarizeSearchHealthRecords(records.map(sanitizeSearchHealthRecord));
      },
    },
  ];
}
