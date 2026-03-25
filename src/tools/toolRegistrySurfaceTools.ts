import type {
  RustMuleClient,
  RustMuleDownloadsResponse,
  RustMuleSearchDetailResponse,
  RustMuleSearchesResponse,
  RustMuleSharedActionsResponse,
  RustMuleSharedFilesResponse,
} from "../api/rustMuleClient.js";
import {
  summarizeDownloads,
  summarizeKeywordSearches,
  summarizeSearchPublishDiagnostics,
  summarizeSharedLibrary,
} from "../diagnostics/rustMuleSurfaceSummaries.js";
import type { RegisteredTool } from "./toolRegistryShared.js";

export function buildSurfaceTools(client: RustMuleClient): RegisteredTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "listKeywordSearches",
          description: "Returns current keyword search readiness and active search threads.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: (): Promise<RustMuleSearchesResponse> => client.getSearches(),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "summarizeKeywordSearches",
          description:
            "Returns a mule-doctor summary of active keyword search threads and readiness state.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: async () => summarizeKeywordSearches(await client.getSearches()),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getKeywordSearch",
          description: "Returns one keyword search thread and its current hits.",
          parameters: {
            type: "object",
            properties: {
              search_id: {
                type: "string",
                description: "search_id_hex from /api/v1/searches or search dispatch.",
              },
            },
            required: ["search_id"],
          },
        },
      },
      handler: async (args): Promise<RustMuleSearchDetailResponse> => {
        const searchId = typeof args["search_id"] === "string" ? args["search_id"].trim() : "";
        if (!searchId) {
          throw new Error("getKeywordSearch requires search_id");
        }
        return client.getSearchDetail(searchId);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "listSharedFiles",
          description: "Returns shared-library files with source and keyword publish status.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: (): Promise<RustMuleSharedFilesResponse> => client.getSharedFiles(),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "summarizeSharedLibrary",
          description:
            "Returns a mule-doctor summary of shared-file publish state and shared-library background actions.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: async () => {
        const [shared, actions] = await Promise.all([
          client.getSharedFiles(),
          client.getSharedActions(),
        ]);
        return summarizeSharedLibrary(shared, actions);
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "listSharedActions",
          description: "Returns shared-library operator action status like reindex or republish jobs.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: (): Promise<RustMuleSharedActionsResponse> => client.getSharedActions(),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "getDownloads",
          description: "Returns current download queue state and per-download progress.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: (): Promise<RustMuleDownloadsResponse> => client.getDownloads(),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "summarizeDownloads",
          description:
            "Returns a mule-doctor summary of download queue state, progress, sources, and errors.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: async () => summarizeDownloads(await client.getDownloads()),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "summarizeSearchPublishDiagnostics",
          description:
            "Returns a combined mule-doctor summary that keeps search threads, shared-file publish state, shared actions, and downloads distinct.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      handler: async () => {
        const [searches, shared, actions, downloads] = await Promise.all([
          client.getSearches(),
          client.getSharedFiles(),
          client.getSharedActions(),
          client.getDownloads(),
        ]);
        return summarizeSearchPublishDiagnostics({
          searches,
          shared,
          actions,
          downloads,
        });
      },
    },
  ];
}
