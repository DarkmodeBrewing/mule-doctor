import type { RuntimeStore } from "../storage/runtimeStore.js";
import type {
  ManagedDiscoverabilityCheckResult,
  DiagnosticTargetRef,
  ManagedDiscoverabilityFixtureSummary,
  SearchHealthRecord,
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

  async listRecent(limit = 20): Promise<SearchHealthRecord[]> {
    if (!this.runtimeStore) {
      return [];
    }
    const records = await this.runtimeStore.getRecentSearchHealthResults(limit);
    return records.map(sanitizeSearchHealthRecord);
  }

  async summarizeRecent(limit = 20): Promise<SearchHealthSummary> {
    return summarizeSearchHealthRecords(await this.listRecent(limit));
  }
}
