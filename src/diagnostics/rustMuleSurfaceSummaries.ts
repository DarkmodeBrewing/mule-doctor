import type {
  RustMuleDownloadsResponse,
  RustMuleKeywordSearchInfo,
  RustMuleSearchesResponse,
  RustMuleSharedActionsResponse,
  RustMuleSharedFileEntry,
  RustMuleSharedFilesResponse,
} from "../api/rustMuleClient.js";

export interface KeywordSearchSummary {
  ready: boolean;
  totalSearches: number;
  activeSearches: number;
  stateCounts: Record<string, number>;
  publishEnabledCount: number;
  publishAckedCount: number;
  wantedSearchCount: number;
  zeroHitTerminalCount: number;
}

export interface SharedLibrarySummary {
  totalFiles: number;
  localSourceCachedCount: number;
  keywordPublishQueuedCount: number;
  keywordPublishFailedCount: number;
  keywordPublishAckedCount: number;
  sourcePublishResponseCount: number;
  activeTransferFileCount: number;
  sharedActionCounts: Record<string, number>;
  sharedActionStateCounts: Record<string, number>;
  publishJobSurface: "shared_file_status_only";
}

export interface DownloadSummary {
  queueLen: number;
  totalDownloads: number;
  activeDownloads: number;
  stateCounts: Record<string, number>;
  downloadsWithErrors: number;
  downloadsWithSources: number;
  avgProgressPct?: number;
}

export interface SearchPublishDiagnosticsSummary {
  searches: KeywordSearchSummary;
  sharedLibrary: SharedLibrarySummary;
  downloads: DownloadSummary;
}

export function summarizeKeywordSearches(
  payload: RustMuleSearchesResponse,
): KeywordSearchSummary {
  const searches = Array.isArray(payload.searches) ? payload.searches : [];
  const stateCounts: Record<string, number> = {};
  let activeSearches = 0;
  let publishEnabledCount = 0;
  let publishAckedCount = 0;
  let wantedSearchCount = 0;
  let zeroHitTerminalCount = 0;

  for (const search of searches) {
    const state = readState(search);
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    if (!isTerminalSearchState(state)) {
      activeSearches += 1;
    }
    if (search.publish_enabled === true) {
      publishEnabledCount += 1;
    }
    if (search.got_publish_ack === true) {
      publishAckedCount += 1;
    }
    if (search.want_search === true) {
      wantedSearchCount += 1;
    }
    if (isTerminalSearchState(state) && readNumber(search.hits) === 0) {
      zeroHitTerminalCount += 1;
    }
  }

  return {
    ready: payload.ready === true,
    totalSearches: searches.length,
    activeSearches,
    stateCounts,
    publishEnabledCount,
    publishAckedCount,
    wantedSearchCount,
    zeroHitTerminalCount,
  };
}

export function summarizeSharedLibrary(
  shared: RustMuleSharedFilesResponse,
  actions: RustMuleSharedActionsResponse,
): SharedLibrarySummary {
  const files = Array.isArray(shared.files) ? shared.files : [];
  const actionEntries = Array.isArray(actions.actions) ? actions.actions : [];
  let localSourceCachedCount = 0;
  let keywordPublishQueuedCount = 0;
  let keywordPublishFailedCount = 0;
  let keywordPublishAckedCount = 0;
  let sourcePublishResponseCount = 0;
  let activeTransferFileCount = 0;

  for (const file of files) {
    if (file.local_source_cached === true) {
      localSourceCachedCount += 1;
    }
    if (file.keyword_publish_queued === true) {
      keywordPublishQueuedCount += 1;
    }
    if (file.keyword_publish_failed === true) {
      keywordPublishFailedCount += 1;
    }
    if ((readNumber(file.keyword_publish_acked) ?? 0) > 0) {
      keywordPublishAckedCount += 1;
    }
    if (file.source_publish_response_received === true) {
      sourcePublishResponseCount += 1;
    }
    if (hasActiveTransfer(file)) {
      activeTransferFileCount += 1;
    }
  }

  const sharedActionCounts: Record<string, number> = {};
  const sharedActionStateCounts: Record<string, number> = {};
  for (const action of actionEntries) {
    const kind = readString(action.kind) ?? "unknown";
    sharedActionCounts[kind] = (sharedActionCounts[kind] ?? 0) + 1;
    const state = readString(action.state) ?? "unknown";
    sharedActionStateCounts[state] = (sharedActionStateCounts[state] ?? 0) + 1;
  }

  return {
    totalFiles: files.length,
    localSourceCachedCount,
    keywordPublishQueuedCount,
    keywordPublishFailedCount,
    keywordPublishAckedCount,
    sourcePublishResponseCount,
    activeTransferFileCount,
    sharedActionCounts,
    sharedActionStateCounts,
    publishJobSurface: "shared_file_status_only",
  };
}

export function summarizeDownloads(payload: RustMuleDownloadsResponse): DownloadSummary {
  const downloads = Array.isArray(payload.downloads) ? payload.downloads : [];
  const stateCounts: Record<string, number> = {};
  let activeDownloads = 0;
  let downloadsWithErrors = 0;
  let downloadsWithSources = 0;
  let progressSum = 0;
  let progressCount = 0;

  for (const entry of downloads) {
    const state = readString(entry.state) ?? "unknown";
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    if (!isTerminalDownloadState(state)) {
      activeDownloads += 1;
    }
    if (readString(entry.last_error)) {
      downloadsWithErrors += 1;
    }
    if ((readNumber(entry.source_count) ?? 0) > 0) {
      downloadsWithSources += 1;
    }
    const progress = readNumber(entry.progress_pct);
    if (progress !== undefined) {
      progressSum += progress;
      progressCount += 1;
    }
  }

  return {
    queueLen: readNumber(payload.queue_len) ?? downloads.length,
    totalDownloads: downloads.length,
    activeDownloads,
    stateCounts,
    downloadsWithErrors,
    downloadsWithSources,
    avgProgressPct: progressCount > 0 ? progressSum / progressCount : undefined,
  };
}

export function summarizeSearchPublishDiagnostics(input: {
  searches: RustMuleSearchesResponse;
  shared: RustMuleSharedFilesResponse;
  actions: RustMuleSharedActionsResponse;
  downloads: RustMuleDownloadsResponse;
}): SearchPublishDiagnosticsSummary {
  return {
    searches: summarizeKeywordSearches(input.searches),
    sharedLibrary: summarizeSharedLibrary(input.shared, input.actions),
    downloads: summarizeDownloads(input.downloads),
  };
}

function readState(search: RustMuleKeywordSearchInfo): string {
  return readString(search.state)?.toLowerCase() ?? "unknown";
}

function isTerminalSearchState(state: string): boolean {
  return state === "completed" || state === "complete" || state === "done" || state === "timed_out";
}

function isTerminalDownloadState(state: string): boolean {
  return state === "completed" || state === "complete" || state === "done" || state === "failed";
}

function hasActiveTransfer(file: RustMuleSharedFileEntry): boolean {
  return (
    (readNumber(file.queued_downloads) ?? 0) > 0 ||
    (readNumber(file.inflight_downloads) ?? 0) > 0 ||
    (readNumber(file.queued_uploads) ?? 0) > 0 ||
    (readNumber(file.inflight_uploads) ?? 0) > 0 ||
    (readNumber(file.queued_upload_ranges) ?? 0) > 0 ||
    (readNumber(file.inflight_upload_ranges) ?? 0) > 0
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
