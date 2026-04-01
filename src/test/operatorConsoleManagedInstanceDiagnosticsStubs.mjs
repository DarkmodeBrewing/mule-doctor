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

export {
  StubManagedInstanceAnalysis,
  StubManagedInstanceAnalysisUnavailable,
  StubManagedInstanceDiagnostics,
  StubManagedInstanceSurfaceDiagnostics,
};
