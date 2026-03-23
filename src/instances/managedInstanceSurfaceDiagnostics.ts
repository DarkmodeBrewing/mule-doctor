import type { SearchPublishDiagnosticsSummary } from "../diagnostics/rustMuleSurfaceSummaries.js";
import { summarizeSearchPublishDiagnostics } from "../diagnostics/rustMuleSurfaceSummaries.js";
import type { SearchHealthLog } from "../searchHealth/searchHealthLog.js";
import { createSearchHealthRecordFromManagedObservation } from "../searchHealth/records.js";
import type {
  RustMuleSearchDetailResponse,
  RustMuleKeywordSearchInfo,
  RustMuleReadiness,
} from "../api/rustMuleClient.js";
import { ManagedInstanceDiagnosticsService } from "./managedInstanceDiagnostics.js";

export interface ManagedInstanceSurfaceDiagnosticsSummary {
  instanceId: string;
  observedAt: string;
  summary: SearchPublishDiagnosticsSummary;
  highlights: {
    searches: string[];
    sharedActions: string[];
    downloads: string[];
  };
}

export interface ManagedKeywordSearchThreadDetail {
  searchId: string;
  keywordIdHex?: string;
  label: string;
  state: string;
  ageSecs?: number;
  hits: number;
  wantSearch: boolean;
  publishEnabled: boolean;
  publishAcked: boolean;
}

export interface ManagedSharedFileDetail {
  fileName: string;
  fileIdHex?: string;
  sizeBytes?: number;
  localSourceCached: boolean;
  keywordPublishQueued: boolean;
  keywordPublishFailed: boolean;
  keywordPublishAckedCount: number;
  sourcePublishResponseReceived: boolean;
  queuedDownloads: number;
  inflightDownloads: number;
  queuedUploads: number;
  inflightUploads: number;
}

export interface ManagedSharedActionDetail {
  kind: string;
  state: string;
  fileName?: string;
  fileIdHex?: string;
  error?: string;
}

export interface ManagedDownloadDetail {
  fileName: string;
  fileHashMd4Hex?: string;
  state: string;
  progressPct?: number;
  sourceCount: number;
  lastError?: string;
}

export interface ManagedInstanceSurfaceDiagnosticsSnapshot
  extends ManagedInstanceSurfaceDiagnosticsSummary {
  detail: {
    searches: ManagedKeywordSearchThreadDetail[];
    sharedFiles: ManagedSharedFileDetail[];
    sharedActions: ManagedSharedActionDetail[];
    downloads: ManagedDownloadDetail[];
  };
}

export class ManagedInstanceSurfaceDiagnosticsService {
  private readonly diagnostics: ManagedInstanceDiagnosticsService;
  private readonly searchHealthLog: SearchHealthLog | undefined;
  private readonly lastObservedSearchSignatures = new Map<string, string>();
  private readonly lastObservedSearchStates = new Map<string, string>();

  constructor(
    diagnostics: ManagedInstanceDiagnosticsService,
    config: {
      searchHealthLog?: SearchHealthLog;
    } = {},
  ) {
    this.diagnostics = diagnostics;
    this.searchHealthLog = config.searchHealthLog;
  }

  async getSummary(instanceId: string): Promise<ManagedInstanceSurfaceDiagnosticsSummary> {
    const snapshot = await this.getSnapshot(instanceId);
    return {
      instanceId: snapshot.instanceId,
      observedAt: snapshot.observedAt,
      summary: snapshot.summary,
      highlights: snapshot.highlights,
    };
  }

  async getSnapshot(instanceId: string): Promise<ManagedInstanceSurfaceDiagnosticsSnapshot> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    const [status, searches, shared, actions, downloads, peers] = await Promise.all([
      client.getStatus(),
      client.getSearches(),
      client.getSharedFiles(),
      client.getSharedActions(),
      client.getDownloads(),
      client.getPeers(),
    ]);
    const readiness: RustMuleReadiness = {
      statusReady: status.ready === true,
      searchesReady: searches.ready === true,
      ready: status.ready === true && searches.ready === true,
      status,
      searches,
    };
    await this.recordObservedSearchHealth(record.id, readiness, peers.length, client, searches.searches);
    const observedAt = new Date().toISOString();
    return {
      instanceId: record.id,
      observedAt,
      summary: summarizeSearchPublishDiagnostics({
        searches,
        shared,
        actions,
        downloads,
      }),
      highlights: {
        searches: summarizeSearchHighlights(searches.searches),
        sharedActions: summarizeSharedActionHighlights(actions.actions),
        downloads: summarizeDownloadHighlights(downloads.downloads),
      },
      detail: {
        searches: normalizeSearchThreads(searches.searches),
        sharedFiles: normalizeSharedFiles(shared.files),
        sharedActions: normalizeSharedActions(actions.actions),
        downloads: normalizeDownloads(downloads.downloads),
      },
    };
  }

  private async recordObservedSearchHealth(
    instanceId: string,
    readiness: RustMuleReadiness,
    peerCount: number,
    client: {
      getSearchDetail(searchId: string): Promise<RustMuleSearchDetailResponse>;
    },
    searches: RustMuleKeywordSearchInfo[],
  ): Promise<void> {
    if (!this.searchHealthLog || searches.length === 0) {
      return;
    }

    const recordedAt = new Date().toISOString();
    const activeKeys = new Set<string>();
    const details: Array<RustMuleSearchDetailResponse | undefined> = [];

    for (const search of searches) {
      const searchId = readString(search.search_id_hex);
      if (!searchId) {
        details.push(undefined);
        continue;
      }

      const key = `${instanceId}:${searchId}`;
      activeKeys.add(key);
      const state = readString(search.state) ?? "unknown";
      const hits = typeof search.hits === "number" ? search.hits : 0;
      const shouldFetchDetail =
        hits > 0 ||
        !isSearchActive(state) ||
        this.lastObservedSearchStates.get(key) !== state;
      if (!shouldFetchDetail) {
        details.push(undefined);
        continue;
      }

      try {
        details.push(await client.getSearchDetail(searchId));
      } catch {
        details.push(undefined);
      }
    }

    this.pruneObservedSearchCaches(instanceId, activeKeys);

    for (let index = 0; index < searches.length; index += 1) {
      const search = searches[index];
      const record = createSearchHealthRecordFromManagedObservation({
        instanceId,
        readiness,
        peerCount,
        search,
        detail: details[index],
        recordedAt,
      });
      const signature = buildObservedSearchSignature(record);
      const key = `${instanceId}:${record.searchId}`;
      this.lastObservedSearchStates.set(key, record.finalState);
      if (this.lastObservedSearchSignatures.get(key) === signature) {
        continue;
      }
      this.lastObservedSearchSignatures.set(key, signature);
      await this.searchHealthLog.append(record);
    }
  }

  private pruneObservedSearchCaches(instanceId: string, activeKeys: Set<string>): void {
    for (const key of this.lastObservedSearchSignatures.keys()) {
      if (key.startsWith(`${instanceId}:`) && !activeKeys.has(key)) {
        this.lastObservedSearchSignatures.delete(key);
        this.lastObservedSearchStates.delete(key);
      }
    }
  }
}

function summarizeSearchHighlights(searches: unknown[]): string[] {
  return searches
    .map((entry) => {
      const search = isRecord(entry) ? entry : {};
      const label = readString(search.keyword_label) ?? readString(search.search_id_hex) ?? "search";
      const state = readString(search.state) ?? "unknown";
      const hits = readNumber(search.hits);
      const tags = [
        typeof hits === "number" ? pluralize(hits, "hit") : undefined,
        search.publish_enabled === true ? "publish enabled" : undefined,
        search.got_publish_ack === true ? "publish acked" : undefined,
      ].filter((value): value is string => Boolean(value));
      return {
        active: isSearchActive(state) ? 0 : 1,
        text: `${label}: ${state}${tags.length ? ` (${tags.join(", ")})` : ""}`,
      };
    })
    .sort((left, right) => left.active - right.active || left.text.localeCompare(right.text))
    .slice(0, 3)
    .map((entry) => entry.text);
}

function summarizeSharedActionHighlights(actions: unknown[]): string[] {
  return actions
    .map((entry) => {
      const action = isRecord(entry) ? entry : {};
      const kind = readString(action.kind) ?? "unknown action";
      const state = readString(action.state) ?? "unknown";
      return {
        active: state === "running" ? 0 : 1,
        text: `${kind}: ${state}`,
      };
    })
    .sort((left, right) => left.active - right.active || left.text.localeCompare(right.text))
    .slice(0, 3)
    .map((entry) => entry.text);
}

function summarizeDownloadHighlights(downloads: unknown[]): string[] {
  return downloads
    .map((entry) => {
      const download = isRecord(entry) ? entry : {};
      const fileName = readString(download.file_name) ?? readString(download.file_hash_md4_hex) ?? "download";
      const state = readString(download.state) ?? "unknown";
      const progress = readNumber(download.progress_pct);
      const sources = readNumber(download.source_count);
      const lastError = readString(download.last_error);
      const tags = [
        typeof progress === "number" ? `${progress}%` : undefined,
        typeof sources === "number" ? pluralize(sources, "source") : undefined,
        lastError ? `error: ${lastError}` : undefined,
      ].filter((value): value is string => Boolean(value));
      return {
        priority: lastError ? 0 : isTerminalState(state) ? 2 : 1,
        text: `${fileName}: ${state}${tags.length ? ` (${tags.join(", ")})` : ""}`,
      };
    })
    .sort((left, right) => left.priority - right.priority || left.text.localeCompare(right.text))
    .slice(0, 3)
    .map((entry) => entry.text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeSearchThreads(searches: unknown[]): ManagedKeywordSearchThreadDetail[] {
  return searches
    .map((entry) => {
      const search = isRecord(entry) ? entry : {};
      const searchId =
        readString(search.search_id_hex) ?? readString(search.keyword_id_hex) ?? "unknown-search";
      return {
        searchId,
        keywordIdHex: readString(search.keyword_id_hex),
        label: readString(search.keyword_label) ?? searchId,
        state: readString(search.state) ?? "unknown",
        ageSecs: readNumber(search.created_secs_ago),
        hits: readNumber(search.hits) ?? 0,
        wantSearch: search.want_search === true,
        publishEnabled: search.publish_enabled === true,
        publishAcked: search.got_publish_ack === true,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function normalizeSharedFiles(files: unknown[]): ManagedSharedFileDetail[] {
  return files
    .map((entry) => {
      const file = isRecord(entry) ? entry : {};
      const identity = isRecord(file.identity) ? file.identity : {};
      return {
        fileName:
          readString(identity.file_name) ??
          readString(identity.file_id_hex) ??
          readString(file.file_name) ??
          "shared-file",
        fileIdHex: readString(identity.file_id_hex) ?? readString(file.file_id_hex),
        sizeBytes: readNumber(identity.file_size) ?? readNumber(file.file_size),
        localSourceCached: file.local_source_cached === true,
        keywordPublishQueued: file.keyword_publish_queued === true,
        keywordPublishFailed: file.keyword_publish_failed === true,
        keywordPublishAckedCount: readNumber(file.keyword_publish_acked) ?? 0,
        sourcePublishResponseReceived: file.source_publish_response_received === true,
        queuedDownloads: readNumber(file.queued_downloads) ?? 0,
        inflightDownloads: readNumber(file.inflight_downloads) ?? 0,
        queuedUploads: readNumber(file.queued_uploads) ?? 0,
        inflightUploads: readNumber(file.inflight_uploads) ?? 0,
      };
    })
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function normalizeSharedActions(actions: unknown[]): ManagedSharedActionDetail[] {
  return actions
    .map((entry) => {
      const action = isRecord(entry) ? entry : {};
      return {
        kind: readString(action.kind) ?? "unknown",
        state: readString(action.state) ?? "unknown",
        fileName: readString(action.file_name),
        fileIdHex: readString(action.file_id_hex),
        error: readString(action.last_error) ?? readString(action.error),
      };
    })
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.state.localeCompare(right.state));
}

function normalizeDownloads(downloads: unknown[]): ManagedDownloadDetail[] {
  return downloads
    .map((entry) => {
      const download = isRecord(entry) ? entry : {};
      return {
        fileName:
          readString(download.file_name) ??
          readString(download.file_hash_md4_hex) ??
          "download",
        fileHashMd4Hex: readString(download.file_hash_md4_hex),
        state: readString(download.state) ?? "unknown",
        progressPct: readNumber(download.progress_pct),
        sourceCount: readNumber(download.source_count) ?? 0,
        lastError: readString(download.last_error),
      };
    })
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function isSearchActive(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized !== "completed" && normalized !== "complete" && normalized !== "done" && normalized !== "timed_out";
}

function isTerminalState(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized === "completed" || normalized === "complete" || normalized === "done" || normalized === "failed";
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function buildObservedSearchSignature(record: {
  finalState: string;
  resultCount: number;
  outcome: string;
  readinessAtDispatch: {
    searcher: {
      ready: boolean;
    };
  };
  transportAtDispatch: {
    searcher: {
      peerCount: number;
    };
  };
}): string {
  return JSON.stringify({
    finalState: record.finalState,
    resultCount: record.resultCount,
    outcome: record.outcome,
    ready: record.readinessAtDispatch.searcher.ready,
    peerCount: record.transportAtDispatch.searcher.peerCount,
  });
}
