class StubDiscoverabilityResultsStore {
  constructor() {
    this.records = [];
  }

  async listRecent(limit = 20) {
    return this.records.slice(-limit);
  }

  async summarizeRecent(limit = 20) {
    const records = this.records.slice(-limit);
    const latest = records.at(-1);
    const foundCount = records.filter((record) => record.result.outcome === "found").length;
    const completedEmptyCount = records.filter(
      (record) => record.result.outcome === "completed_empty",
    ).length;
    const timedOutCount = records.filter((record) => record.result.outcome === "timed_out").length;
    return {
      windowSize: records.length,
      totalChecks: records.length,
      foundCount,
      completedEmptyCount,
      timedOutCount,
      successRatePct: records.length > 0 ? (foundCount / records.length) * 100 : undefined,
      latestRecordedAt: latest?.recordedAt,
      latestOutcome: latest?.result.outcome,
      latestQuery: latest?.result.query,
      latestPair: latest
        ? {
            publisherInstanceId: latest.result.publisherInstanceId,
            searcherInstanceId: latest.result.searcherInstanceId,
          }
        : undefined,
      lastSuccessAt: [...records].reverse().find((record) => record.result.outcome === "found")
        ?.recordedAt,
    };
  }

  async append(result) {
    this.records.push({
      recordedAt: "2026-03-12T10:05:00.000Z",
      result: {
        publisherInstanceId: result.publisherInstanceId,
        searcherInstanceId: result.searcherInstanceId,
        fixture: {
          fixtureId: result.fixture.fixtureId,
          fileName: result.fixture.fileName,
          relativePath: result.fixture.relativePath,
          sizeBytes: result.fixture.sizeBytes,
        },
        query: result.query,
        dispatchedAt: result.dispatchedAt,
        searchId: result.searchId,
        readinessAtDispatch: result.readinessAtDispatch,
        peerCountAtDispatch: result.peerCountAtDispatch,
        states: result.states,
        resultCount: result.resultCount,
        outcome: result.outcome,
        finalState: result.finalState,
      },
    });
  }
}

class StubSearchHealthResultsStore {
  constructor() {
    this.records = [];
  }

  async listRecent(limit = 20, filters = {}) {
    return this.records.filter((record) => matchesSearchHealthFilters(record, filters)).slice(-limit);
  }

  async summarizeRecent(limit = 20, filters = {}) {
    const records = this.records.filter((record) => matchesSearchHealthFilters(record, filters)).slice(-limit);
    const latest = records.at(-1);
    const activeCount = records.filter((record) => record.outcome === "active").length;
    const foundCount = records.filter((record) => record.outcome === "found").length;
    const completedEmptyCount = records.filter(
      (record) => record.outcome === "completed_empty",
    ).length;
    const timedOutCount = records.filter((record) => record.outcome === "timed_out").length;
    const dispatchReadyCount = records.filter(
      (record) =>
        record.readinessAtDispatch.publisher.ready === true &&
        record.readinessAtDispatch.searcher.ready === true,
    ).length;
    const degradedTransportCount = records.filter(
      (record) =>
        record.transportAtDispatch.publisher.degradedIndicators.length > 0 ||
        record.transportAtDispatch.searcher.degradedIndicators.length > 0,
    ).length;
    return {
      windowSize: records.length,
      totalSearches: records.length,
      activeCount,
      foundCount,
      completedEmptyCount,
      timedOutCount,
      dispatchReadyCount,
      dispatchNotReadyCount: records.length - dispatchReadyCount,
      degradedTransportCount,
      successRatePct: records.length > 0 ? (foundCount / records.length) * 100 : undefined,
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
      lastSuccessAt: [...records].reverse().find((record) => record.outcome === "found")
        ?.recordedAt,
    };
  }

  async appendControlledDiscoverability(result) {
    this.records.push({
      recordedAt: "2026-03-12T10:05:00.000Z",
      source: "controlled_discoverability",
      query: result.query,
      searchId: result.searchId,
      dispatchedAt: result.dispatchedAt,
      readinessAtDispatch: {
        publisher: {
          statusReady: result.readinessAtDispatch.publisherStatusReady,
          searchesReady: result.readinessAtDispatch.publisherSearchesReady,
          ready: result.readinessAtDispatch.publisherReady,
        },
        searcher: {
          statusReady: result.readinessAtDispatch.searcherStatusReady,
          searchesReady: result.readinessAtDispatch.searcherSearchesReady,
          ready: result.readinessAtDispatch.searcherReady,
        },
      },
      transportAtDispatch: {
        publisher: { peerCount: result.peerCountAtDispatch.publisher, degradedIndicators: [] },
        searcher: { peerCount: result.peerCountAtDispatch.searcher, degradedIndicators: [] },
      },
      states: result.states,
      resultCount: result.resultCount,
      outcome: result.outcome,
      finalState: result.finalState,
      controlledContext: {
        publisherInstanceId: result.publisherInstanceId,
        searcherInstanceId: result.searcherInstanceId,
        fixture: {
          fixtureId: result.fixture.fixtureId,
          fileName: result.fixture.fileName,
          relativePath: result.fixture.relativePath,
          sizeBytes: result.fixture.sizeBytes,
        },
      },
    });
  }
}

function matchesSearchHealthFilters(record, filters) {
  if (filters.source && record.source !== filters.source) {
    return false;
  }
  if (filters.outcome && record.outcome !== filters.outcome) {
    return false;
  }
  if (typeof filters.dispatchReady === "boolean") {
    const readyAtDispatch =
      record.readinessAtDispatch.publisher.ready === true &&
      record.readinessAtDispatch.searcher.ready === true;
    if (readyAtDispatch !== filters.dispatchReady) {
      return false;
    }
  }
  if (filters.target) {
    const target = String(filters.target).trim().toLowerCase();
    const haystack = [
      record.controlledContext?.publisherInstanceId,
      record.controlledContext?.searcherInstanceId,
      record.observedContext?.instanceId,
      record.observerContext?.label,
      record.observerContext?.target?.kind,
      record.observerContext?.target?.instanceId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(target)) {
      return false;
    }
  }
  return true;
}

export {
  StubDiscoverabilityResultsStore,
  StubSearchHealthResultsStore,
};
