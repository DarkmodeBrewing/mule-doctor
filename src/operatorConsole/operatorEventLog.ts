import type { RuntimeStore } from "../storage/runtimeStore.js";
import type { DiagnosticTargetRef, ObserverCycleOutcome, OperatorEventEntry } from "../types/contracts.js";

export interface AppendOperatorEventInput {
  type: OperatorEventEntry["type"];
  message: string;
  target?: DiagnosticTargetRef;
  outcome?: ObserverCycleOutcome;
  actor?: string;
}

export class OperatorEventLog {
  private readonly runtimeStore: RuntimeStore | undefined;

  constructor(runtimeStore?: RuntimeStore) {
    this.runtimeStore = runtimeStore;
  }

  async append(input: AppendOperatorEventInput): Promise<void> {
    if (!this.runtimeStore) {
      return;
    }
    await this.runtimeStore.appendEvent({
      timestamp: new Date().toISOString(),
      type: input.type,
      message: input.message,
      target: input.target,
      outcome: input.outcome,
      actor: input.actor,
    });
  }

  async listRecent(limit = 20): Promise<OperatorEventEntry[]> {
    if (!this.runtimeStore) {
      return [];
    }
    return this.runtimeStore.getRecentEvents(limit);
  }
}
