import type { LlmInvocationRecord, LlmInvocationSummary } from "../types/contracts.js";

export function summarizeLlmInvocationRecords(
  records: LlmInvocationRecord[],
  windowSize: number,
): LlmInvocationSummary {
  const finishReasonCounts: LlmInvocationSummary["finishReasonCounts"] = {
    completed: 0,
    tool_round_limit: 0,
    tool_call_limit: 0,
    duration_limit: 0,
    failed: 0,
    rate_limited: 0,
  };
  const surfaceCounts: LlmInvocationSummary["surfaceCounts"] = {};

  let humanTriggeredCount = 0;
  let scheduledCount = 0;

  for (const record of records) {
    if (!record || typeof record !== "object") {
      continue;
    }
    if (record.finishReason in finishReasonCounts) {
      finishReasonCounts[record.finishReason] += 1;
    }
    if (record.surface) {
      surfaceCounts[record.surface] = (surfaceCounts[record.surface] ?? 0) + 1;
    }
    if (record.trigger === "human") {
      humanTriggeredCount += 1;
    } else if (record.trigger === "scheduled") {
      scheduledCount += 1;
    }
  }

  const latest = records.length > 0 ? records[records.length - 1] : undefined;

  return {
    windowSize,
    totalInvocations: records.length,
    finishReasonCounts,
    surfaceCounts,
    humanTriggeredCount,
    scheduledCount,
    rateLimitedCount: finishReasonCounts.rate_limited,
    latestRecordedAt: latest?.recordedAt,
    latestSurface: latest?.surface,
    latestFinishReason: latest?.finishReason,
    latestTarget: latest?.target,
  };
}
