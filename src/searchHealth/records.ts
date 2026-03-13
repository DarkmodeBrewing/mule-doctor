import type {
  ManagedDiscoverabilityCheckResult,
  ManagedDiscoverabilityFixtureSummary,
  SearchHealthReadinessSnapshot,
  SearchHealthRecord,
  SearchHealthTransportSnapshot,
} from "../types/contracts.js";

export function createSearchHealthRecordFromDiscoverability(
  result: ManagedDiscoverabilityCheckResult,
): SearchHealthRecord {
  return {
    recordedAt: new Date().toISOString(),
    source: "controlled_discoverability",
    query: result.query,
    searchId: result.searchId,
    dispatchedAt: result.dispatchedAt,
    readinessAtDispatch: {
      publisher: {
        statusReady: result.readinessAtDispatch.publisherStatusReady === true,
        searchesReady: result.readinessAtDispatch.publisherSearchesReady === true,
        ready: result.readinessAtDispatch.publisherReady === true,
      },
      searcher: {
        statusReady: result.readinessAtDispatch.searcherStatusReady === true,
        searchesReady: result.readinessAtDispatch.searcherSearchesReady === true,
        ready: result.readinessAtDispatch.searcherReady === true,
      },
    },
    transportAtDispatch: {
      publisher: buildTransportSnapshot(
        result.peerCountAtDispatch.publisher,
        result.readinessAtDispatch.publisherReady,
        result.readinessAtDispatch.publisherStatusReady,
        result.readinessAtDispatch.publisherSearchesReady,
      ),
      searcher: buildTransportSnapshot(
        result.peerCountAtDispatch.searcher,
        result.readinessAtDispatch.searcherReady,
        result.readinessAtDispatch.searcherStatusReady,
        result.readinessAtDispatch.searcherSearchesReady,
      ),
    },
    states: Array.isArray(result.states) ? result.states.map((sample) => ({ ...sample })) : [],
    resultCount: typeof result.resultCount === "number" ? result.resultCount : 0,
    outcome: result.outcome,
    finalState: result.finalState,
    controlledContext: {
      publisherInstanceId: result.publisherInstanceId,
      searcherInstanceId: result.searcherInstanceId,
      fixture: summarizeFixture(result.fixture),
    },
  };
}

export function sanitizeSearchHealthRecord(record: SearchHealthRecord): SearchHealthRecord {
  return {
    recordedAt: record.recordedAt,
    source: record.source,
    query: record.query,
    searchId: record.searchId,
    dispatchedAt: record.dispatchedAt,
    readinessAtDispatch: {
      publisher: sanitizeReadiness(record.readinessAtDispatch?.publisher),
      searcher: sanitizeReadiness(record.readinessAtDispatch?.searcher),
    },
    transportAtDispatch: {
      publisher: sanitizeTransport(record.transportAtDispatch?.publisher),
      searcher: sanitizeTransport(record.transportAtDispatch?.searcher),
    },
    states: Array.isArray(record.states)
      ? record.states.map((sample) => ({
          observedAt: sample.observedAt,
          state: sample.state,
          hits: typeof sample.hits === "number" ? sample.hits : 0,
        }))
      : [],
    resultCount: typeof record.resultCount === "number" ? record.resultCount : 0,
    outcome: record.outcome,
    finalState: record.finalState,
    controlledContext: record.controlledContext
      ? {
          publisherInstanceId: record.controlledContext.publisherInstanceId,
          searcherInstanceId: record.controlledContext.searcherInstanceId,
          fixture: summarizeFixture(record.controlledContext.fixture),
        }
      : undefined,
  };
}

function sanitizeReadiness(
  value: Partial<SearchHealthReadinessSnapshot> | undefined,
): SearchHealthReadinessSnapshot {
  return {
    statusReady: value?.statusReady === true,
    searchesReady: value?.searchesReady === true,
    ready: value?.ready === true,
  };
}

function sanitizeTransport(
  value: Partial<SearchHealthTransportSnapshot> | undefined,
): SearchHealthTransportSnapshot {
  return {
    peerCount: typeof value?.peerCount === "number" ? value.peerCount : 0,
    degradedIndicators: Array.isArray(value?.degradedIndicators)
      ? value.degradedIndicators.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function summarizeFixture(
  fixture: Partial<ManagedDiscoverabilityFixtureSummary> | undefined,
): ManagedDiscoverabilityFixtureSummary {
  return {
    fixtureId: fixture?.fixtureId ?? "unknown",
    fileName: fixture?.fileName ?? "unknown",
    relativePath: fixture?.relativePath ?? "unknown",
    sizeBytes: typeof fixture?.sizeBytes === "number" ? fixture.sizeBytes : 0,
  };
}

function buildTransportSnapshot(
  peerCount: number,
  ready: boolean,
  statusReady: boolean,
  searchesReady: boolean,
): SearchHealthTransportSnapshot {
  const degradedIndicators: string[] = [];
  if (typeof peerCount === "number" && peerCount <= 0) {
    degradedIndicators.push("no_live_peers");
  }
  if (!statusReady) {
    degradedIndicators.push("status_not_ready");
  }
  if (!searchesReady) {
    degradedIndicators.push("searches_not_ready");
  }
  if (!ready) {
    degradedIndicators.push("search_pipeline_not_ready");
  }
  return {
    peerCount: typeof peerCount === "number" ? peerCount : 0,
    degradedIndicators,
  };
}
