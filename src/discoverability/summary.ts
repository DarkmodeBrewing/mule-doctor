import type {
  ManagedDiscoverabilityOutcome,
  ManagedDiscoverabilityRecord,
  ManagedDiscoverabilitySummary,
} from "../types/contracts.js";

export function summarizeDiscoverabilityResults(
  records: ManagedDiscoverabilityRecord[],
): ManagedDiscoverabilitySummary {
  const latest = records.at(-1);
  const lastSuccess = [...records]
    .reverse()
    .find((record) => record.result.outcome === "found");

  const counts: Record<ManagedDiscoverabilityOutcome, number> = {
    found: 0,
    completed_empty: 0,
    timed_out: 0,
  };
  for (const record of records) {
    counts[record.result.outcome] += 1;
  }

  const totalChecks = records.length;
  return {
    windowSize: totalChecks,
    totalChecks,
    foundCount: counts.found,
    completedEmptyCount: counts.completed_empty,
    timedOutCount: counts.timed_out,
    successRatePct: totalChecks > 0 ? (counts.found / totalChecks) * 100 : undefined,
    latestRecordedAt: latest?.recordedAt,
    latestOutcome: latest?.result.outcome,
    latestQuery: latest?.result.query,
    latestPair: latest
      ? {
          publisherInstanceId: latest.result.publisherInstanceId,
          searcherInstanceId: latest.result.searcherInstanceId,
        }
      : undefined,
    lastSuccessAt: lastSuccess?.recordedAt,
  };
}
