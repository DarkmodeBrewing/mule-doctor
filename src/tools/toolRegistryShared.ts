import type {
  ManagedDiscoverabilityRecord,
  ManagedDiscoverabilitySummaryResult,
} from "../types/contracts.js";

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
export type PatchProposalNotifier = (proposal: PatchProposalEvent) => Promise<void>;

export interface RecentLogSource {
  getRecentLines(n?: number): string[];
}

export interface PatchProposalEvent {
  artifactPath: string;
  diff: string;
  bytes: number;
  lines: number;
}

export interface ToolRegistryOptions {
  sourcePath?: string;
  proposalDir?: string;
  patchProposalNotifier?: PatchProposalNotifier;
  toolProfile?: ToolProfile;
}

export type ToolProfile = "full" | "mattermost_command";

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function getAllowedToolNames(profile: ToolProfile): Set<string> | undefined {
  switch (profile) {
    case "full":
      return undefined;
    case "mattermost_command":
      return new Set([
        "getNodeInfo",
        "getPeers",
        "getRoutingBuckets",
        "getLookupStats",
        "getRecentLogs",
        "getHistory",
        "getDiscoverabilityResults",
        "getDiscoverabilitySummary",
        "getSearchHealthResults",
        "getSearchHealthSummary",
        "searchLogs",
        "listKeywordSearches",
        "summarizeKeywordSearches",
        "getKeywordSearch",
        "listSharedFiles",
        "summarizeSharedLibrary",
        "listSharedActions",
        "getDownloads",
        "summarizeDownloads",
        "summarizeSearchPublishDiagnostics",
      ]);
    default:
      return undefined;
  }
}

export function sanitizeDiscoverabilityRecord(
  record: ManagedDiscoverabilityRecord,
): ManagedDiscoverabilityRecord {
  return {
    recordedAt: record.recordedAt,
    result: sanitizeDiscoverabilityResult(record.result),
  };
}

export function sanitizeDiscoverabilityResult(
  result: ManagedDiscoverabilityRecord["result"],
): ManagedDiscoverabilitySummaryResult {
  return {
    publisherInstanceId: result.publisherInstanceId,
    searcherInstanceId: result.searcherInstanceId,
    fixture: {
      fixtureId: result.fixture?.fixtureId ?? "unknown",
      fileName: result.fixture?.fileName ?? "unknown",
      relativePath: result.fixture?.relativePath ?? "unknown",
      sizeBytes: typeof result.fixture?.sizeBytes === "number" ? result.fixture.sizeBytes : 0,
    },
    query: result.query,
    dispatchedAt: result.dispatchedAt,
    searchId: result.searchId,
    readinessAtDispatch: {
      publisherStatusReady: result.readinessAtDispatch?.publisherStatusReady === true,
      publisherSearchesReady: result.readinessAtDispatch?.publisherSearchesReady === true,
      publisherReady: result.readinessAtDispatch?.publisherReady === true,
      searcherStatusReady: result.readinessAtDispatch?.searcherStatusReady === true,
      searcherSearchesReady: result.readinessAtDispatch?.searcherSearchesReady === true,
      searcherReady: result.readinessAtDispatch?.searcherReady === true,
    },
    peerCountAtDispatch: {
      publisher:
        typeof result.peerCountAtDispatch?.publisher === "number"
          ? result.peerCountAtDispatch.publisher
          : 0,
      searcher:
        typeof result.peerCountAtDispatch?.searcher === "number"
          ? result.peerCountAtDispatch.searcher
          : 0,
    },
    states: Array.isArray(result.states)
      ? result.states.map((sample) => ({
          observedAt: sample.observedAt,
          state: sample.state,
          hits: typeof sample.hits === "number" ? sample.hits : 0,
        }))
      : [],
    resultCount: typeof result.resultCount === "number" ? result.resultCount : 0,
    outcome: result.outcome,
    finalState: result.finalState,
  };
}

export function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}
