import { summarizeSearchPublishDiagnostics } from "../diagnostics/rustMuleSurfaceSummaries.js";
import type {
  RustMuleDownloadsResponse,
  RustMuleSearchesResponse,
  RustMuleSharedActionsResponse,
  RustMuleSharedFilesResponse,
} from "../api/rustMuleClient.js";
import type {
  ManagedDownloadDetail,
  ManagedInstanceSurfaceDiagnosticsSnapshot,
  ManagedKeywordSearchThreadDetail,
  ManagedSharedActionDetail,
  ManagedSharedFileDetail,
} from "./managedInstanceSurfaceDiagnosticsTypes.js";

export function buildManagedInstanceSurfaceSnapshot(input: {
  instanceId: string;
  observedAt: string;
  searches: RustMuleSearchesResponse;
  shared: RustMuleSharedFilesResponse;
  actions: RustMuleSharedActionsResponse;
  downloads: RustMuleDownloadsResponse;
}): ManagedInstanceSurfaceDiagnosticsSnapshot {
  return {
    instanceId: input.instanceId,
    observedAt: input.observedAt,
    summary: summarizeSearchPublishDiagnostics({
      searches: input.searches,
      shared: input.shared,
      actions: input.actions,
      downloads: input.downloads,
    }),
    highlights: {
      searches: summarizeSearchHighlights(input.searches.searches),
      sharedActions: summarizeSharedActionHighlights(input.actions.actions),
      downloads: summarizeDownloadHighlights(input.downloads.downloads),
    },
    detail: {
      searches: normalizeSearchThreads(input.searches.searches),
      sharedFiles: normalizeSharedFiles(input.shared.files),
      sharedActions: normalizeSharedActions(input.actions.actions),
      downloads: normalizeDownloads(input.downloads.downloads),
    },
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
