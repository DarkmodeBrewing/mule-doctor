import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class StubClient {
  async getNodeInfo() {
    return { nodeId: "n1", version: "v1", uptime: 10 };
  }

  async getPeers() {
    return [{ id: "p1", address: "peer-a" }];
  }

  async getRoutingBuckets() {
    return [{ index: 0, count: 1, size: 1 }];
  }

  async getLookupStats() {
    return { total: 1, successful: 1, failed: 0, avgDurationMs: 0 };
  }

  async triggerBootstrap() {
    return { jobId: "job-1", status: "completed" };
  }

  async traceLookup(targetId) {
    return {
      traceId: "trace-1",
      status: "completed",
      hops: [{ peerQueried: targetId ?? "p1" }],
    };
  }

  async getSearches() {
    return {
      ready: true,
      searches: [
        {
          search_id_hex: "search-1",
          keyword_label: "fixture",
          state: "running",
          want_search: true,
          publish_enabled: true,
        },
        {
          search_id_hex: "search-2",
          keyword_label: "fixture-2",
          state: "completed",
          hits: 0,
          got_publish_ack: true,
        },
      ],
    };
  }

  async getSearchDetail(searchId) {
    return {
      search: { search_id_hex: searchId, keyword_label: "fixture", state: "running" },
      hits: [{ filename: "fixture.txt" }],
    };
  }

  async getSharedFiles() {
    return {
      files: [
        {
          identity: { file_name: "fixture.txt" },
          local_source_cached: true,
          keyword_publish_queued: true,
          queued_downloads: 1,
        },
        {
          identity: { file_name: "fixture-2.txt" },
          keyword_publish_failed: true,
          keyword_publish_acked: 2,
          source_publish_response_received: true,
          inflight_uploads: 1,
        },
      ],
    };
  }

  async getSharedActions() {
    return {
      actions: [
        { kind: "republish_keywords", state: "running" },
        { kind: "reindex", state: "idle" },
      ],
    };
  }

  async getDownloads() {
    return {
      queue_len: 2,
      downloads: [
        {
          file_name: "fixture.txt",
          state: "queued",
          source_count: 0,
          progress_pct: 0,
        },
        {
          file_name: "fixture-2.txt",
          state: "running",
          source_count: 3,
          progress_pct: 45,
          last_error: "timeout",
        },
      ],
    };
  }
}

export class StubLogWatcher {
  getRecentLines(n) {
    if (n === 5) {
      return [
        "INFO boot complete",
        "WARN timeout on peer-1",
        "INFO peers stable",
        "WARN timeout on peer-2",
      ];
    }
    return [`last-${n}`];
  }
}

export class StubRuntimeStore {
  async getRecentHistory(n) {
    return Array.from({ length: Math.min(2, n) }, (_, i) => ({ timestamp: `t-${i + 1}` }));
  }

  async getRecentDiscoverabilityResults(n) {
    return Array.from({ length: Math.min(2, n) }, (_, i) => ({
      recordedAt: `2026-03-12T10:0${i}:00.000Z`,
      result: {
        publisherInstanceId: "publisher",
        searcherInstanceId: "searcher",
        fixture: {
          fixtureId: `fixture-${i + 1}`,
          token: `fixture-token-${i + 1}`,
          fileName: `fixture-${i + 1}.txt`,
          relativePath: `fixture-${i + 1}.txt`,
          absolutePath: `/tmp/fixture-${i + 1}.txt`,
          sizeBytes: 16,
        },
        query: `fixture-${i + 1}`,
        dispatchedAt: `2026-03-12T10:0${i}:00.000Z`,
        searchId: `search-${i + 1}`,
        readinessAtDispatch: {
          publisherStatusReady: true,
          publisherSearchesReady: true,
          publisherReady: true,
          searcherStatusReady: true,
          searcherSearchesReady: true,
          searcherReady: true,
        },
        peerCountAtDispatch: { publisher: 1, searcher: 2 },
        states: [],
        resultCount: i + 1,
        outcome: "found",
        finalState: "completed",
        publisherSharedBefore: { file: { secret: true }, actions: [], downloads: [] },
        publisherSharedAfter: { file: { secret: true }, actions: [], downloads: [] },
      },
    }));
  }

  async getRecentSearchHealthResults(n) {
    return Array.from({ length: Math.min(2, n) }, (_, i) => ({
      recordedAt: `2026-03-12T11:0${i}:00.000Z`,
      source: "controlled_discoverability",
      query: `fixture-${i + 1}`,
      searchId: `search-${i + 1}`,
      dispatchedAt: `2026-03-12T10:0${i}:00.000Z`,
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 1, degradedIndicators: [] },
        searcher: { peerCount: 2, degradedIndicators: [] },
      },
      states: [],
      resultCount: i + 1,
      outcome: "found",
      finalState: "completed",
      controlledContext: {
        publisherInstanceId: "publisher",
        searcherInstanceId: "searcher",
        fixture: {
          fixtureId: `fixture-${i + 1}`,
          fileName: `fixture-${i + 1}.txt`,
          relativePath: `fixture-${i + 1}.txt`,
          sizeBytes: 16,
        },
      },
    }));
  }

  async getRecentLlmInvocationRecords(n) {
    return Array.from({ length: Math.min(2, n) }, (_, i) => ({
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
}

export async function makeTempSourceDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-source-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
