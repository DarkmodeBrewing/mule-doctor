import type { RuntimeStore } from "../storage/runtimeStore.js";
import type {
  ManagedDiscoverabilityCheckResult,
  ManagedDiscoverabilityRecord,
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
      result,
    });
  }

  async listRecent(limit = 20): Promise<ManagedDiscoverabilityRecord[]> {
    if (!this.runtimeStore) {
      return [];
    }
    return this.runtimeStore.getRecentDiscoverabilityResults(limit);
  }
}
