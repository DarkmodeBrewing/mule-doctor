import type { RuntimeStore } from "../storage/runtimeStore.js";
import type {
  ManagedDiscoverabilityCheckResult,
  SearchHealthRecord,
  SearchHealthSummary,
} from "../types/contracts.js";
import {
  createSearchHealthRecordFromDiscoverability,
  sanitizeSearchHealthRecord,
} from "./records.js";
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

  async listRecent(limit = 20): Promise<SearchHealthRecord[]> {
    if (!this.runtimeStore) {
      return [];
    }
    return this.runtimeStore.getRecentSearchHealthResults(limit);
  }

  async summarizeRecent(limit = 20): Promise<SearchHealthSummary> {
    return summarizeSearchHealthRecords(await this.listRecent(limit));
  }
}
