class StubManagedInstances {
  constructor() {
    this.instances = [
      {
        id: "a",
        status: "planned",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19000,
        preset: {
          presetId: "pair",
          prefix: "lab",
        },
        runtime: {
          rootDir: "/data/instances/a",
          configPath: "/data/instances/a/config.toml",
          tokenPath: "/data/instances/a/state/api.token",
          debugTokenPath: "/data/instances/a/state/debug.token",
          logDir: "/data/instances/a/state/logs",
          logPath: "/data/instances/a/state/logs/rust-mule.log",
          stateDir: "/data/instances/a/state",
          sharedDir: "/data/instances/a/shared",
          metadataPath: "/data/instances/a/instance.json",
        },
      },
      {
        id: "b",
        status: "running",
        createdAt: "2026-03-08T00:10:00.000Z",
        updatedAt: "2026-03-08T00:10:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19001,
        preset: {
          presetId: "pair",
          prefix: "lab",
        },
        currentProcess: {
          pid: 2222,
          command: ["rust-mule"],
          cwd: "/data/instances/b",
          startedAt: "2026-03-08T00:12:00.000Z",
        },
        runtime: {
          rootDir: "/data/instances/b",
          configPath: "/data/instances/b/config.toml",
          tokenPath: "/data/instances/b/state/api.token",
          debugTokenPath: "/data/instances/b/state/debug.token",
          logDir: "/data/instances/b/state/logs",
          logPath: "/data/instances/b/state/logs/rust-mule.log",
          stateDir: "/data/instances/b/state",
          sharedDir: "/data/instances/b/shared",
          metadataPath: "/data/instances/b/instance.json",
        },
      },
    ];
  }

  async listInstances() {
    return this.instances;
  }

  async createPlannedInstance(input) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.id)) {
      throw new Error(`Invalid managed instance id: ${input.id}`);
    }
    if (this.instances.some((instance) => instance.id === input.id)) {
      throw new Error(`Managed instance already exists: ${input.id}`);
    }
    const instance = {
      ...this.instances[0],
      id: input.id,
      runtime: {
        ...this.instances[0].runtime,
        rootDir: `/data/instances/${input.id}`,
        configPath: `/data/instances/${input.id}/config.toml`,
        tokenPath: `/data/instances/${input.id}/state/api.token`,
        debugTokenPath: `/data/instances/${input.id}/state/debug.token`,
        logDir: `/data/instances/${input.id}/state/logs`,
        logPath: `/data/instances/${input.id}/state/logs/rust-mule.log`,
        stateDir: `/data/instances/${input.id}/state`,
        sharedDir: `/data/instances/${input.id}/shared`,
        metadataPath: `/data/instances/${input.id}/instance.json`,
      },
      apiPort: input.apiPort ?? 19001,
      status: "planned",
      updatedAt: "2026-03-08T01:00:00.000Z",
    };
    this.instances.push(instance);
    return instance;
  }

  async startInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "running";
    instance.updatedAt = "2026-03-08T01:10:00.000Z";
    return instance;
  }

  async stopInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "stopped";
    instance.updatedAt = "2026-03-08T01:20:00.000Z";
    return instance;
  }

  async restartInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "running";
    instance.updatedAt = "2026-03-08T01:30:00.000Z";
    return instance;
  }
}

class StubManagedInstanceDiagnostics {
  async getSnapshot(id) {
    if (id !== "a" && id !== "b") {
      throw new Error(`Managed instance not found: ${id}`);
    }
    if (id === "b") {
      return {
        instanceId: "b",
        observedAt: "2026-03-08T02:03:00.000Z",
        available: false,
        reason: "instance is stopped",
      };
    }
    return {
      instanceId: "a",
      observedAt: "2026-03-08T02:00:00.000Z",
      available: true,
      peerCount: 3,
      routingBucketCount: 2,
      lookupStats: { matchPerSent: 0.5, timeoutsPerSent: 0.1 },
      networkHealth: {
        score: 62,
        components: {
          peer_count: 10,
          bucket_balance: 20,
          lookup_success: 50,
          lookup_efficiency: 80,
          error_rate: 70,
        },
      },
    };
  }
}

class StubManagedInstanceSurfaceDiagnostics {
  buildDiagnostics(id) {
    if (id !== "a" && id !== "b") {
      throw new Error(`Managed instance not found: ${id}`);
    }
    return {
      instanceId: id,
      observedAt: "2026-03-08T02:04:00.000Z",
      summary: {
        searches: {
          ready: true,
          totalSearches: 2,
          activeSearches: 1,
          stateCounts: { running: 1, completed: 1 },
          publishEnabledCount: 1,
          publishAckedCount: 1,
          wantedSearchCount: 1,
          zeroHitTerminalCount: 1,
        },
        sharedLibrary: {
          totalFiles: 1,
          localSourceCachedCount: 1,
          keywordPublishQueuedCount: 1,
          keywordPublishFailedCount: 0,
          keywordPublishAckedCount: 0,
          sourcePublishResponseCount: 1,
          activeTransferFileCount: 1,
          sharedActionCounts: { reindex: 1 },
          sharedActionStateCounts: { idle: 1 },
          publishJobSurface: "shared_file_status_only",
        },
        downloads: {
          queueLen: 1,
          totalDownloads: 1,
          activeDownloads: 1,
          stateCounts: { queued: 1 },
          downloadsWithErrors: 0,
          downloadsWithSources: 1,
          avgProgressPct: 50,
        },
      },
      highlights: {
        searches: ["fixture-search: running (2 hits, publish enabled)"],
        sharedActions: ["reindex: idle"],
        downloads: ["fixture.bin: queued (50%, 1 source)"],
      },
      detail: {
        searches: [
          {
            searchId: "search-1",
            keywordIdHex: "keyword-1",
            label: "fixture-search",
            state: "running",
            ageSecs: 42,
            hits: 2,
            wantSearch: true,
            publishEnabled: true,
            publishAcked: false,
          },
        ],
        sharedFiles: [
          {
            fileName: "fixture.txt",
            fileIdHex: "file-1",
            sizeBytes: 128,
            localSourceCached: true,
            keywordPublishQueued: true,
            keywordPublishFailed: false,
            keywordPublishAckedCount: 0,
            sourcePublishResponseReceived: true,
            queuedDownloads: 1,
            inflightDownloads: 0,
            queuedUploads: 0,
            inflightUploads: 1,
          },
        ],
        sharedActions: [
          {
            kind: "reindex",
            state: "idle",
            fileName: "fixture.txt",
            fileIdHex: "file-1",
          },
        ],
        downloads: [
          {
            fileName: "fixture.bin",
            fileHashMd4Hex: "hash-1",
            state: "queued",
            progressPct: 50,
            sourceCount: 1,
          },
        ],
      },
    };
  }

  async getSummary(id) {
    const diagnostics = this.buildDiagnostics(id);
    return {
      instanceId: diagnostics.instanceId,
      observedAt: diagnostics.observedAt,
      summary: diagnostics.summary,
      highlights: diagnostics.highlights,
    };
  }

  async getSnapshot(id) {
    return this.buildDiagnostics(id);
  }
}

class StubManagedInstanceAnalysis {
  async analyze(id) {
    if (id !== "a") {
      throw new Error(`Managed instance not found: ${id}`);
    }
    return {
      instanceId: "a",
      analyzedAt: "2026-03-08T02:05:00.000Z",
      available: true,
      summary: "Managed instance is healthy with mild timeout pressure.",
    };
  }
}

class StubManagedInstanceAnalysisUnavailable {
  async analyze(id) {
    return {
      instanceId: id,
      analyzedAt: "2026-03-08T02:05:00.000Z",
      available: false,
      reason: "instance is stopped",
      summary: "instance is stopped",
    };
  }
}

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
  CapturingInvocationAudit,
  FastResetObserverControl,
  StubLlmInvocationResults,
  StubManagedInstanceAnalysis,
  StubManagedInstanceAnalysisUnavailable,
  StubManagedInstanceDiagnostics,
  StubManagedInstanceDiscoverability,
  StubManagedInstances,
  StubManagedInstanceSharing,
  StubManagedInstanceSurfaceDiagnostics,
  StubOperatorSearches,
};
