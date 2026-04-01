class StubManagedInstanceSharing {
  constructor() {
    this.calls = [];
  }

  async getOverview(id) {
    this.calls.push(["getOverview", id]);
    return {
      instanceId: id,
      sharedDir: `/data/instances/${id}/shared`,
      files: [{ identity: { file_name: "fixture.txt" }, keyword_publish_queued: true }],
      actions: [{ kind: "reindex", state: "idle" }],
      downloads: [{ file_name: "fixture.txt", state: "queued" }],
    };
  }

  async ensureFixture(id, input = {}) {
    this.calls.push(["ensureFixture", id, input.fixtureId]);
    return {
      fixtureId: input.fixtureId ?? "discoverability",
      token: `mule-doctor-${id}-${input.fixtureId ?? "discoverability"}`,
      fileName: `mule-doctor-${id}-${input.fixtureId ?? "discoverability"}.txt`,
      relativePath: `mule-doctor-${id}-${input.fixtureId ?? "discoverability"}.txt`,
      absolutePath: `/data/instances/${id}/shared/mule-doctor-${id}-${input.fixtureId ?? "discoverability"}.txt`,
      sizeBytes: 64,
    };
  }

  async reindex(id) {
    this.calls.push(["reindex", id]);
    return this.getOverview(id);
  }

  async republishSources(id) {
    this.calls.push(["republishSources", id]);
    return this.getOverview(id);
  }

  async republishKeywords(id) {
    this.calls.push(["republishKeywords", id]);
    return this.getOverview(id);
  }
}

class StubManagedInstanceDiscoverability {
  constructor() {
    this.calls = [];
  }

  async runControlledCheck(input) {
    this.calls.push(input);
    return {
      publisherInstanceId: input.publisherInstanceId,
      searcherInstanceId: input.searcherInstanceId,
      fixture: {
        fixtureId: input.fixtureId ?? "discoverability",
        token: "mule-doctor-a-discoverability",
        fileName: "mule-doctor-a-discoverability.txt",
        relativePath: "mule-doctor-a-discoverability.txt",
        absolutePath: "/data/instances/a/shared/mule-doctor-a-discoverability.txt",
        sizeBytes: 64,
      },
      query: "mule-doctor-a-discoverability",
      dispatchedAt: "2026-03-12T10:00:00.000Z",
      searchId: "feedfacefeedfacefeedfacefeedface",
      readinessAtDispatch: {
        publisherStatusReady: true,
        publisherSearchesReady: true,
        publisherReady: true,
        searcherStatusReady: true,
        searcherSearchesReady: true,
        searcherReady: true,
      },
      peerCountAtDispatch: {
        publisher: 1,
        searcher: 2,
      },
      publisherSharedBefore: {
        file: {
          identity: {
            file_name: "mule-doctor-a-discoverability.txt",
          },
        },
        actions: [],
        downloads: [],
      },
      publisherSharedAfter: {
        file: {
          identity: {
            file_name: "mule-doctor-a-discoverability.txt",
          },
        },
        actions: [],
        downloads: [],
      },
      states: [
        {
          observedAt: "2026-03-12T10:00:01.000Z",
          state: "running",
          hits: 0,
        },
        {
          observedAt: "2026-03-12T10:00:03.000Z",
          state: "running",
          hits: 1,
        },
      ],
      resultCount: 1,
      outcome: "found",
      finalState: "running",
    };
  }
}

class StubOperatorSearches {
  constructor() {
    this.calls = [];
  }

  async startSearch(input) {
    this.calls.push(input);
    return {
      source: "operator_triggered_search",
      target:
        input.mode === "active_target"
          ? { kind: "external" }
          : { kind: "managed_instance", instanceId: input.instanceId },
      targetLabel:
        input.mode === "active_target"
          ? "external configured rust-mule client"
          : `managed instance ${input.instanceId}`,
      query: input.query ?? input.keywordIdHex ?? "keyword search",
      keywordIdHex: input.keywordIdHex,
      searchId: "manual-search-1",
      dispatchedAt: "2026-03-23T15:00:00.000Z",
    };
  }
}

export {
  StubManagedInstanceDiscoverability,
  StubManagedInstanceSharing,
  StubOperatorSearches,
};
