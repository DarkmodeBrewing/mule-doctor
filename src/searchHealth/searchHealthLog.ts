import type { RuntimeStore } from "../storage/runtimeStore.js";
import type {
  ManagedDiscoverabilityCheckResult,
  DiagnosticTargetRef,
  ManagedDiscoverabilityFixtureSummary,
  SearchHealthRecord,
  SearchHealthRecordFilters,
  SearchHealthSummary,
} from "../types/contracts.js";
import {
  createSearchHealthRecordFromControlledDispatch,
  createSearchHealthRecordFromDiscoverability,
  createSearchHealthRecordFromOperatorDispatch,
  sanitizeSearchHealthRecord,
} from "./records.js";
import type {
  RustMuleKeywordSearchResponse,
  RustMuleReadiness,
} from "../api/rustMuleClient.js";
import { summarizeSearchHealthRecords } from "./summary.js";

export class SearchHealthLog {
  private readonly runtimeStore: RuntimeStore | undefined;

  constructor(runtimeStore?: RuntimeStore) {
    this.runtimeStore = runtimeStore;
  }

  async append(record: SearchHealthRecord): Promise<void> {
    if (!this.runtimeStore) {
      return;
    }
    await this.runtimeStore.appendSearchHealthResult(sanitizeSearchHealthRecord(record));
  }

  async appendControlledDiscoverability(
    result: ManagedDiscoverabilityCheckResult,
  ): Promise<void> {
    await this.append(createSearchHealthRecordFromDiscoverability(result));
  }

  async appendControlledDiscoverabilityDispatch(input: {
    publisherInstanceId: string;
    searcherInstanceId: string;
    fixture: ManagedDiscoverabilityFixtureSummary;
    query: string;
    dispatch: RustMuleKeywordSearchResponse;
    publisherReadiness: RustMuleReadiness;
    searcherReadiness: RustMuleReadiness;
    publisherPeerCount: number;
    searcherPeerCount: number;
    dispatchedAt?: string;
  }): Promise<void> {
    await this.append(createSearchHealthRecordFromControlledDispatch(input));
  }

  async appendOperatorTriggeredDispatch(input: {
    query?: string;
    keywordIdHex?: string;
    readiness: RustMuleReadiness;
    peerCount: number;
    dispatch: RustMuleKeywordSearchResponse;
    dispatchedAt?: string;
    instanceId?: string;
    target?: DiagnosticTargetRef;
    targetLabel?: string;
  }): Promise<void> {
    await this.append(createSearchHealthRecordFromOperatorDispatch(input));
  }

  async listRecent(limit = 20, filters?: SearchHealthRecordFilters): Promise<SearchHealthRecord[]> {
    if (!this.runtimeStore) {
      return [];
    }
    const sanitizedFilters = sanitizeFilters(filters);
    const scanLimit = determineScanLimit(limit, sanitizedFilters);
    const records = (await this.runtimeStore.getRecentSearchHealthResults(scanLimit)).map(
      sanitizeSearchHealthRecord,
    );
    return records.filter((record) => matchesFilters(record, sanitizedFilters)).slice(-limit);
  }

  async summarizeRecent(limit = 20, filters?: SearchHealthRecordFilters): Promise<SearchHealthSummary> {
    return summarizeSearchHealthRecords(await this.listRecent(limit, filters));
  }
}

function sanitizeFilters(filters: SearchHealthRecordFilters | undefined): SearchHealthRecordFilters {
  return {
    source: filters?.source,
    outcome: filters?.outcome,
    dispatchReady: typeof filters?.dispatchReady === "boolean" ? filters.dispatchReady : undefined,
    target: typeof filters?.target === "string" ? filters.target.trim().toLowerCase() : undefined,
  };
}

function determineScanLimit(limit: number, filters: SearchHealthRecordFilters): number {
  if (!hasActiveFilters(filters)) {
    return limit;
  }
  return Math.max(Math.min(limit * 5, 500), 50);
}

function hasActiveFilters(filters: SearchHealthRecordFilters): boolean {
  return Boolean(
    filters.source ||
      filters.outcome ||
      typeof filters.dispatchReady === "boolean" ||
      filters.target,
  );
}

function matchesFilters(record: SearchHealthRecord, filters: SearchHealthRecordFilters): boolean {
  if (filters.source && record.source !== filters.source) {
    return false;
  }
  if (filters.outcome && record.outcome !== filters.outcome) {
    return false;
  }
  if (typeof filters.dispatchReady === "boolean") {
    const readyAtDispatch =
      record.readinessAtDispatch.publisher.ready === true &&
      record.readinessAtDispatch.searcher.ready === true;
    if (readyAtDispatch !== filters.dispatchReady) {
      return false;
    }
  }
  if (filters.target) {
    const haystack = buildTargetHaystack(record).toLowerCase();
    if (!haystack.includes(filters.target)) {
      return false;
    }
  }
  return true;
}

function buildTargetHaystack(record: SearchHealthRecord): string {
  const parts = [
    record.controlledContext?.publisherInstanceId,
    record.controlledContext?.searcherInstanceId,
    record.observedContext?.instanceId,
    record.observerContext?.label,
    record.observerContext?.target.kind,
    record.observerContext?.target.instanceId,
  ];
  return parts.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}
