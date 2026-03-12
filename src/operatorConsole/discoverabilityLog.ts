import type { RuntimeStore } from "../storage/runtimeStore.js";
import type {
  ManagedDiscoverabilityCheckResult,
  ManagedDiscoverabilityRecord,
  ManagedDiscoverabilitySummaryResult,
} from "../types/contracts.js";

export class DiscoverabilityLog {
  private readonly runtimeStore: RuntimeStore | undefined;

  constructor(runtimeStore?: RuntimeStore) {
    this.runtimeStore = runtimeStore;
  }

  async append(result: ManagedDiscoverabilityCheckResult): Promise<void> {
    if (!this.runtimeStore) {
      return;
    }
    await this.runtimeStore.appendDiscoverabilityResult({
      recordedAt: new Date().toISOString(),
      result: sanitizeResult(result),
    });
  }

  async listRecent(limit = 20): Promise<ManagedDiscoverabilityRecord[]> {
    if (!this.runtimeStore) {
      return [];
    }
    return this.runtimeStore.getRecentDiscoverabilityResults(limit);
  }
}

function sanitizeResult(result: ManagedDiscoverabilityCheckResult): ManagedDiscoverabilitySummaryResult {
  return {
    publisherInstanceId: result.publisherInstanceId,
    searcherInstanceId: result.searcherInstanceId,
    fixture: {
      fixtureId: result.fixture.fixtureId,
      fileName: result.fixture.fileName,
      relativePath: result.fixture.relativePath,
      sizeBytes: result.fixture.sizeBytes,
    },
    query: result.query,
    dispatchedAt: result.dispatchedAt,
    searchId: result.searchId,
    readinessAtDispatch: result.readinessAtDispatch,
    peerCountAtDispatch: result.peerCountAtDispatch,
    states: result.states,
    resultCount: result.resultCount,
    outcome: result.outcome,
    finalState: result.finalState,
  };
}
