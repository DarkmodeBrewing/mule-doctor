import type { RustMuleReadiness, RustMuleSearchDetailResponse } from "./api/rustMuleClient.js";
import { createSearchHealthRecordFromObserverTargetObservation } from "./searchHealth/records.js";
import type { SearchHealthLog } from "./searchHealth/searchHealthLog.js";
import type { DiagnosticTargetRef } from "./types/contracts.js";
import type { ObserverTargetRuntime } from "./observerTargetResolver.js";

export async function appendObservedSearchHealth(input: {
  target: ObserverTargetRuntime;
  readiness: RustMuleReadiness;
  peerCount: number;
  recordedAt: string;
  searchHealthLog: SearchHealthLog | undefined;
  lastObservedSearchSignatures: Map<string, string>;
  lastObservedSearchStates: Map<string, string>;
}): Promise<void> {
  const {
    target,
    readiness,
    peerCount,
    recordedAt,
    searchHealthLog,
    lastObservedSearchSignatures,
    lastObservedSearchStates,
  } = input;

  if (!searchHealthLog || readiness.searches.searches.length === 0) {
    return;
  }

  const activeKeys = new Set<string>();
  const detailPromises = readiness.searches.searches.map(async (search) => {
    const key = buildObservedSearchCacheKey(target.target, search);
    activeKeys.add(key);
    const state = readString(search.state) ?? "unknown";
    const hits = typeof search.hits === "number" ? search.hits : 0;
    const shouldFetchDetail =
      hits > 0 || !isSearchActive(state) || lastObservedSearchStates.get(key) !== state;
    if (!shouldFetchDetail) {
      return undefined;
    }
    const searchId = readString(search.search_id_hex);
    if (!searchId) {
      return undefined;
    }
    try {
      return await target.client.getSearchDetail(searchId);
    } catch {
      return undefined;
    }
  });
  const details = await Promise.all(detailPromises);

  pruneObservedSearchCaches(
    target.target,
    activeKeys,
    lastObservedSearchSignatures,
    lastObservedSearchStates,
  );

  for (let index = 0; index < readiness.searches.searches.length; index += 1) {
    const search = readiness.searches.searches[index];
    const record = createSearchHealthRecordFromObserverTargetObservation({
      target: target.target,
      label: target.label,
      readiness,
      peerCount,
      search,
      detail: details[index],
      recordedAt,
    });
    const key = buildObservedSearchCacheKey(target.target, search, details[index]);
    lastObservedSearchStates.set(key, record.finalState);
    const signature = buildObservedSearchSignature(record);
    if (lastObservedSearchSignatures.get(key) === signature) {
      continue;
    }
    lastObservedSearchSignatures.set(key, signature);
    await searchHealthLog.append(record);
  }
}

function pruneObservedSearchCaches(
  target: DiagnosticTargetRef,
  activeKeys: Set<string>,
  lastObservedSearchSignatures: Map<string, string>,
  lastObservedSearchStates: Map<string, string>,
): void {
  const prefix = `${observerSearchTargetKey(target)}:`;
  for (const key of lastObservedSearchSignatures.keys()) {
    if (key.startsWith(prefix) && !activeKeys.has(key)) {
      lastObservedSearchSignatures.delete(key);
      lastObservedSearchStates.delete(key);
    }
  }
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

function observerSearchTargetKey(target: DiagnosticTargetRef): string {
  return target.kind === "managed_instance" && target.instanceId
    ? `managed:${target.instanceId}`
    : "external";
}

function buildObservedSearchCacheKey(
  target: DiagnosticTargetRef,
  search: {
    search_id_hex?: unknown;
    keyword_id_hex?: unknown;
    keyword_label?: unknown;
  },
  detail?: RustMuleSearchDetailResponse,
): string {
  const query =
    readString(search.keyword_label) ??
    readString(detail?.search?.keyword_label) ??
    readString(search.search_id_hex) ??
    readString(detail?.search?.search_id_hex) ??
    readString(search.keyword_id_hex) ??
    "search";
  const searchId =
    readString(search.search_id_hex) ??
    readString(detail?.search?.search_id_hex) ??
    readString(search.keyword_id_hex) ??
    query;
  return `${observerSearchTargetKey(target)}:${searchId}`;
}

function isSearchActive(state: string): boolean {
  const normalized = state.toLowerCase();
  return (
    normalized !== "completed" &&
    normalized !== "complete" &&
    normalized !== "done" &&
    normalized !== "timed_out"
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
