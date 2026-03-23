import type {
  ManagedDiscoverabilityCheckResult,
  ManagedDiscoverabilityFixtureSummary,
  DiagnosticTargetRef,
  SearchHealthReadinessSnapshot,
  SearchHealthRecord,
  SearchHealthTransportSnapshot,
} from "../types/contracts.js";
import type {
  RustMuleSearchDetailResponse,
  RustMuleKeywordSearchInfo,
  RustMuleReadiness,
} from "../api/rustMuleClient.js";

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
    observedContext: record.observedContext
      ? {
          instanceId: record.observedContext.instanceId,
        }
      : undefined,
    observerContext: record.observerContext
      ? {
          target: sanitizeDiagnosticTarget(record.observerContext.target),
          label: record.observerContext.label,
        }
      : undefined,
  };
}

export function createSearchHealthRecordFromManagedObservation(input: {
  instanceId: string;
  readiness: RustMuleReadiness;
  peerCount: number;
  search: RustMuleKeywordSearchInfo;
  detail?: RustMuleSearchDetailResponse;
  recordedAt?: string;
}): SearchHealthRecord {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const state = readString(input.detail?.search?.state) ?? readString(input.search.state) ?? "unknown";
  const resultCount = Array.isArray(input.detail?.hits)
    ? input.detail.hits.length
    : typeof input.search.hits === "number"
      ? input.search.hits
      : 0;
  const readiness = {
    statusReady: input.readiness.statusReady === true,
    searchesReady: input.readiness.searchesReady === true,
    ready: input.readiness.ready === true,
  };
  const transport = buildTransportSnapshot(
    input.peerCount,
    input.readiness.ready,
    input.readiness.statusReady,
    input.readiness.searchesReady,
  );
  const query =
    readString(input.search.keyword_label) ??
    readString(input.detail?.search?.keyword_label) ??
    readString(input.search.search_id_hex) ??
    readString(input.search.keyword_id_hex) ??
    "search";
  const searchId =
    readString(input.search.search_id_hex) ??
    readString(input.detail?.search?.search_id_hex) ??
    readString(input.search.keyword_id_hex) ??
    query;

  return {
    recordedAt,
    source: "managed_instance_observation",
    query,
    searchId,
    dispatchedAt: deriveDispatchedAt(recordedAt, input.search.created_secs_ago),
    readinessAtDispatch: {
      publisher: { ...readiness },
      searcher: { ...readiness },
    },
    transportAtDispatch: {
      publisher: { ...transport },
      searcher: { ...transport },
    },
    states: [
      {
        observedAt: recordedAt,
        state,
        hits: resultCount,
      },
    ],
    resultCount,
    outcome: classifyObservedOutcome(state, resultCount),
    finalState: state,
    observedContext: {
      instanceId: input.instanceId,
    },
  };
}

export function createSearchHealthRecordFromObserverTargetObservation(input: {
  target: DiagnosticTargetRef;
  label: string;
  readiness: RustMuleReadiness;
  peerCount: number;
  search: RustMuleKeywordSearchInfo;
  detail?: RustMuleSearchDetailResponse;
  recordedAt?: string;
}): SearchHealthRecord {
  const base = createSearchHealthRecordFromManagedObservation({
    instanceId:
      input.target.kind === "managed_instance" && input.target.instanceId
        ? input.target.instanceId
        : "observer-target",
    readiness: input.readiness,
    peerCount: input.peerCount,
    search: input.search,
    detail: input.detail,
    recordedAt: input.recordedAt,
  });
  return {
    ...base,
    source: "observer_target_observation",
    observedContext: undefined,
    observerContext: {
      target: sanitizeDiagnosticTarget(input.target),
      label: input.label,
    },
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

function sanitizeDiagnosticTarget(target: DiagnosticTargetRef | undefined): DiagnosticTargetRef {
  return target?.kind === "managed_instance" && typeof target.instanceId === "string"
    ? { kind: "managed_instance", instanceId: target.instanceId }
    : { kind: "external" };
}

function classifyObservedOutcome(
  state: string,
  resultCount: number,
): SearchHealthRecord["outcome"] {
  const normalized = state.toLowerCase();
  if (resultCount > 0) {
    return "found";
  }
  if (normalized === "timed_out" || normalized === "timeout") {
    return "timed_out";
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "done") {
    return "completed_empty";
  }
  return "active";
}

function deriveDispatchedAt(recordedAt: string, createdSecsAgo: unknown): string {
  if (typeof createdSecsAgo !== "number" || !Number.isFinite(createdSecsAgo) || createdSecsAgo < 0) {
    return recordedAt;
  }
  const recordedAtMs = Date.parse(recordedAt);
  if (Number.isNaN(recordedAtMs)) {
    return recordedAt;
  }
  return new Date(recordedAtMs - createdSecsAgo * 1000).toISOString();
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
