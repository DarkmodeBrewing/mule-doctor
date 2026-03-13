import type {
  SearchHealthOutcome,
  SearchHealthRecord,
  SearchHealthSummary,
} from "../types/contracts.js";

export function summarizeSearchHealthRecords(records: SearchHealthRecord[]): SearchHealthSummary {
  const latest = records.at(-1);
  const lastSuccess = [...records].reverse().find((record) => record.outcome === "found");

  const counts: Record<SearchHealthOutcome, number> = {
    found: 0,
    completed_empty: 0,
    timed_out: 0,
  };
  let dispatchReadyCount = 0;
  let degradedTransportCount = 0;

  for (const record of records) {
    counts[record.outcome] += 1;
    if (
      record.readinessAtDispatch.publisher.ready === true &&
      record.readinessAtDispatch.searcher.ready === true
    ) {
      dispatchReadyCount += 1;
    }
    if (
      record.transportAtDispatch.publisher.degradedIndicators.length > 0 ||
      record.transportAtDispatch.searcher.degradedIndicators.length > 0
    ) {
      degradedTransportCount += 1;
    }
  }

  const totalSearches = records.length;
  return {
    windowSize: totalSearches,
    totalSearches,
    foundCount: counts.found,
    completedEmptyCount: counts.completed_empty,
    timedOutCount: counts.timed_out,
    dispatchReadyCount,
    dispatchNotReadyCount: totalSearches - dispatchReadyCount,
    degradedTransportCount,
    successRatePct: totalSearches > 0 ? (counts.found / totalSearches) * 100 : undefined,
    latestRecordedAt: latest?.recordedAt,
    latestOutcome: latest?.outcome,
    latestQuery: latest?.query,
    latestSource: latest?.source,
    latestPair: latest?.controlledContext
      ? {
          publisherInstanceId: latest.controlledContext.publisherInstanceId,
          searcherInstanceId: latest.controlledContext.searcherInstanceId,
        }
      : undefined,
    lastSuccessAt: lastSuccess?.recordedAt,
  };
}
