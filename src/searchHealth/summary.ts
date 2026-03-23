import type {
  SearchHealthOutcome,
  SearchHealthRecord,
  SearchHealthSummary,
} from "../types/contracts.js";
import { sanitizeSearchHealthRecord } from "./records.js";

export function summarizeSearchHealthRecords(records: SearchHealthRecord[]): SearchHealthSummary {
  const sanitizedRecords = records.map(sanitizeSearchHealthRecord);
  const latest = sanitizedRecords.at(-1);
  const latestRecords = latestSearchRecords(sanitizedRecords);
  const lastSuccess = [...latestRecords]
    .reverse()
    .find((record) => record.outcome === "found");

  const counts: Record<SearchHealthOutcome, number> = {
    active: 0,
    found: 0,
    completed_empty: 0,
    timed_out: 0,
  };
  let dispatchReadyCount = 0;
  let degradedTransportCount = 0;
  let terminalCount = 0;

  for (const record of latestRecords) {
    if (record.outcome in counts) {
      counts[record.outcome] += 1;
    }
    if (record.outcome !== "active") {
      terminalCount += 1;
    }
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

  const totalSearches = latestRecords.length;
  return {
    windowSize: totalSearches,
    totalSearches,
    activeCount: counts.active,
    foundCount: counts.found,
    completedEmptyCount: counts.completed_empty,
    timedOutCount: counts.timed_out,
    dispatchReadyCount,
    dispatchNotReadyCount: totalSearches - dispatchReadyCount,
    degradedTransportCount,
    successRatePct: terminalCount > 0 ? (counts.found / terminalCount) * 100 : undefined,
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
    latestInstanceId: latest?.observedContext?.instanceId,
    latestTargetLabel: latest?.observerContext?.label,
    lastSuccessAt: lastSuccess?.recordedAt,
  };
}

function latestSearchRecords(records: SearchHealthRecord[]): SearchHealthRecord[] {
  const latestByKey = new Map<string, SearchHealthRecord>();
  for (const record of records) {
    const key = buildLogicalSearchKey(record);
    latestByKey.delete(key);
    latestByKey.set(key, record);
  }
  return [...latestByKey.values()];
}

function buildLogicalSearchKey(record: SearchHealthRecord): string {
  const controlledKey = record.controlledContext
    ? `${record.controlledContext.publisherInstanceId}:${record.controlledContext.searcherInstanceId}`
    : "";
  const observedKey = record.observedContext?.instanceId ?? "";
  const observerKey = record.observerContext?.target.kind === "managed_instance"
    ? `managed:${record.observerContext.target.instanceId ?? ""}`
    : record.observerContext
      ? "external"
      : "";
  return [
    record.source,
    record.searchId,
    controlledKey,
    observedKey,
    observerKey,
  ].join("|");
}
