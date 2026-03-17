import type { LlmInvocationRecord, LlmInvocationSummary } from "../types/contracts.js";
import type { RuntimeStore } from "../storage/runtimeStore.js";
import { summarizeLlmInvocationRecords } from "./invocationAuditSummary.js";

const DEFAULT_LLM_INVOCATION_LIMIT = 50;

export interface LlmInvocationAuditSink {
  append(record: LlmInvocationRecord): Promise<void>;
}

export class LlmInvocationAuditLog implements LlmInvocationAuditSink {
  private readonly runtimeStore: RuntimeStore | undefined;

  constructor(runtimeStore: RuntimeStore | undefined) {
    this.runtimeStore = runtimeStore;
  }

  async append(record: LlmInvocationRecord): Promise<void> {
    if (!this.runtimeStore) {
      return;
    }
    await this.runtimeStore.appendLlmInvocationRecord(record);
  }

  async listRecent(limit = DEFAULT_LLM_INVOCATION_LIMIT): Promise<LlmInvocationRecord[]> {
    if (!this.runtimeStore) {
      return [];
    }
    return this.runtimeStore.getRecentLlmInvocationRecords(limit);
  }

  async summarizeRecent(limit = DEFAULT_LLM_INVOCATION_LIMIT): Promise<LlmInvocationSummary> {
    const records = await this.listRecent(limit);
    return summarizeLlmInvocationRecords(records, limit);
  }
}
