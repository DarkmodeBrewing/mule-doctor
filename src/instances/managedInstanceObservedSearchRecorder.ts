import type {
  RustMuleKeywordSearchInfo,
  RustMuleReadiness,
  RustMuleSearchDetailResponse,
} from "../api/rustMuleClient.js";
import { createSearchHealthRecordFromManagedObservation } from "../searchHealth/records.js";
import type { SearchHealthLog } from "../searchHealth/searchHealthLog.js";

export class ManagedInstanceObservedSearchRecorder {
  private readonly searchHealthLog: SearchHealthLog | undefined;
  private readonly lastObservedSearchSignatures = new Map<string, string>();
  private readonly lastObservedSearchStates = new Map<string, string>();

  constructor(searchHealthLog: SearchHealthLog | undefined) {
    this.searchHealthLog = searchHealthLog;
  }

  async record(input: {
    instanceId: string;
    readiness: RustMuleReadiness;
    peerCount: number;
    client: {
      getSearchDetail(searchId: string): Promise<RustMuleSearchDetailResponse>;
    };
    searches: RustMuleKeywordSearchInfo[];
  }): Promise<void> {
    const { instanceId, readiness, peerCount, client, searches } = input;
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
        hits > 0 || !isSearchActive(state) || this.lastObservedSearchStates.get(key) !== state;
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isSearchActive(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized !== "completed" && normalized !== "complete" && normalized !== "done" && normalized !== "timed_out";
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
