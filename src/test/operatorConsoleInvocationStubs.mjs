class CapturingInvocationAudit {
  constructor() {
    this.records = [];
  }

  async append(record) {
    this.records.push(record);
  }
}

class StubLlmInvocationResults {
  async listRecent(limit = 10) {
    return Array.from({ length: Math.min(limit, 2) }, (_, i) => ({
      recordedAt: `2026-03-17T15:0${i}:00.000Z`,
      surface: i === 0 ? "mattermost_command" : "observer_cycle",
      trigger: i === 0 ? "human" : "scheduled",
      model: "gpt-5-mini",
      startedAt: `2026-03-17T15:0${i}:00.000Z`,
      completedAt: `2026-03-17T15:0${i}:01.000Z`,
      durationMs: 1000,
      toolCalls: i + 1,
      toolRounds: 1,
      finishReason: i === 0 ? "completed" : "rate_limited",
      command: i === 0 ? "analyze" : undefined,
      retryAfterSec: i === 1 ? 30 : undefined,
    }));
  }

  async summarizeRecent(limit = 10) {
    return {
      windowSize: limit,
      totalInvocations: 2,
      finishReasonCounts: {
        completed: 1,
        tool_round_limit: 0,
        tool_call_limit: 0,
        duration_limit: 0,
        failed: 0,
        rate_limited: 1,
      },
      surfaceCounts: {
        mattermost_command: 1,
        observer_cycle: 1,
      },
      humanTriggeredCount: 1,
      scheduledCount: 1,
      rateLimitedCount: 1,
      latestRecordedAt: "2026-03-17T15:01:00.000Z",
      latestSurface: "observer_cycle",
      latestFinishReason: "rate_limited",
    };
  }
}

class FastResetObserverControl {
  constructor() {
    this.status = {
      started: true,
      cycleInFlight: false,
      intervalMs: 300000,
      currentCycleStartedAt: undefined,
      currentCycleTarget: undefined,
    };
  }

  getStatus() {
    return this.status;
  }

  triggerRunNow() {
    return { accepted: true };
  }
}

export {
  CapturingInvocationAudit,
  FastResetObserverControl,
  StubLlmInvocationResults,
};
