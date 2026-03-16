import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ToolRegistry } from "../../dist/tools/toolRegistry.js";

class StubClient {
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

class StubLogWatcher {
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

class StubRuntimeStore {
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
}

async function makeTempSourceDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-source-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("ToolRegistry wraps successful tool calls in a structured envelope", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const result = await registry.invoke("getNodeInfo", {});

  assert.equal(result.tool, "getNodeInfo");
  assert.equal(result.success, true);
  assert.deepEqual(result.data, { nodeId: "n1", version: "v1", uptime: 10 });
});

test("ToolRegistry returns structured errors for unknown tools", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const result = await registry.invoke("doesNotExist", {});

  assert.deepEqual(result, {
    tool: "doesNotExist",
    success: false,
    error: "Unknown tool: doesNotExist",
  });
});

test("ToolRegistry getHistory reads from runtime store", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore());

  const result = await registry.invoke("getHistory", { n: 10 });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, [{ timestamp: "t-1" }, { timestamp: "t-2" }]);
});

test("ToolRegistry getDiscoverabilityResults reads sanitized records from runtime store", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore());

  const result = await registry.invoke("getDiscoverabilityResults", { n: 10 });

  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].result.searchId, "search-1");
  assert.equal("token" in result.data[0].result.fixture, false);
  assert.equal("absolutePath" in result.data[0].result.fixture, false);
  assert.equal("publisherSharedBefore" in result.data[0].result, false);
  assert.equal("publisherSharedAfter" in result.data[0].result, false);
});

test("ToolRegistry getDiscoverabilitySummary returns derived outcome totals", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore());

  const result = await registry.invoke("getDiscoverabilitySummary", { n: 10 });

  assert.equal(result.success, true);
  assert.equal(result.data.totalChecks, 2);
  assert.equal(result.data.foundCount, 2);
  assert.equal(result.data.completedEmptyCount, 0);
  assert.equal(result.data.timedOutCount, 0);
  assert.equal(result.data.latestPair.publisherInstanceId, "publisher");
});

test("ToolRegistry getSearchHealthResults reads sanitized lifecycle records from runtime store", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore());

  const result = await registry.invoke("getSearchHealthResults", { n: 10 });

  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].source, "controlled_discoverability");
  assert.equal(result.data[0].transportAtDispatch.searcher.peerCount, 2);
  assert.deepEqual(result.data[0].transportAtDispatch.searcher.degradedIndicators, []);
  assert.equal(result.data[0].controlledContext.fixture.fileName, "fixture-1.txt");
});

test("ToolRegistry getSearchHealthSummary returns derived lifecycle totals", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore());

  const result = await registry.invoke("getSearchHealthSummary", { n: 10 });

  assert.equal(result.success, true);
  assert.equal(result.data.totalSearches, 2);
  assert.equal(result.data.foundCount, 2);
  assert.equal(result.data.dispatchReadyCount, 2);
  assert.equal(result.data.degradedTransportCount, 0);
  assert.equal(result.data.latestPair.publisherInstanceId, "publisher");
});

test("ToolRegistry does not expose getHistory when runtime store is unavailable", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const defs = registry.getDefinitions();
  const hasGetHistory = defs.some((def) => def.function.name === "getHistory");
  const hasDiscoverability = defs.some(
    (def) => def.function.name === "getDiscoverabilityResults",
  );
  const hasDiscoverabilitySummary = defs.some(
    (def) => def.function.name === "getDiscoverabilitySummary",
  );
  const hasSearchHealth = defs.some((def) => def.function.name === "getSearchHealthResults");
  const hasSearchHealthSummary = defs.some((def) => def.function.name === "getSearchHealthSummary");
  assert.equal(hasGetHistory, false);
  assert.equal(hasDiscoverability, false);
  assert.equal(hasDiscoverabilitySummary, false);
  assert.equal(hasSearchHealth, false);
  assert.equal(hasSearchHealthSummary, false);

  const result = await registry.invoke("getHistory", { n: 5 });
  assert.deepEqual(result, {
    tool: "getHistory",
    success: false,
    error: "Unknown tool: getHistory",
  });

  const discoverability = await registry.invoke("getDiscoverabilityResults", { n: 5 });
  assert.deepEqual(discoverability, {
    tool: "getDiscoverabilityResults",
    success: false,
    error: "Unknown tool: getDiscoverabilityResults",
  });

  const discoverabilitySummary = await registry.invoke("getDiscoverabilitySummary", { n: 5 });
  assert.deepEqual(discoverabilitySummary, {
    tool: "getDiscoverabilitySummary",
    success: false,
    error: "Unknown tool: getDiscoverabilitySummary",
  });

  const searchHealth = await registry.invoke("getSearchHealthResults", { n: 5 });
  assert.deepEqual(searchHealth, {
    tool: "getSearchHealthResults",
    success: false,
    error: "Unknown tool: getSearchHealthResults",
  });

  const searchHealthSummary = await registry.invoke("getSearchHealthSummary", { n: 5 });
  assert.deepEqual(searchHealthSummary, {
    tool: "getSearchHealthSummary",
    success: false,
    error: "Unknown tool: getSearchHealthSummary",
  });
});

test("ToolRegistry searchLogs returns bounded matches", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const result = await registry.invoke("searchLogs", {
    query: "timeout",
    n: 5,
    limit: 1,
  });

  assert.equal(result.success, true);
  assert.equal(result.data.totalMatches, 2);
  assert.deepEqual(result.data.matches, ["WARN timeout on peer-1"]);
});

test("ToolRegistry triggerBootstrap and traceLookup delegate to client", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const bootstrap = await registry.invoke("triggerBootstrap", {});
  const trace = await registry.invoke("traceLookup", { target_id: "abcd" });

  assert.equal(bootstrap.success, true);
  assert.equal(bootstrap.data.jobId, "job-1");
  assert.equal(trace.success, true);
  assert.equal(trace.data.traceId, "trace-1");
  assert.equal(trace.data.hops[0].peerQueried, "abcd");
});

test("ToolRegistry exposes keyword search, shared, and download investigation tools", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const searches = await registry.invoke("listKeywordSearches", {});
  const search = await registry.invoke("getKeywordSearch", { search_id: "search-1" });
  const sharedFiles = await registry.invoke("listSharedFiles", {});
  const sharedActions = await registry.invoke("listSharedActions", {});
  const downloads = await registry.invoke("getDownloads", {});

  assert.equal(searches.success, true);
  assert.equal(searches.data.ready, true);
  assert.equal(searches.data.searches[0].search_id_hex, "search-1");
  assert.equal(search.success, true);
  assert.equal(search.data.search.search_id_hex, "search-1");
  assert.equal(sharedFiles.success, true);
  assert.equal(sharedFiles.data.files[0].identity.file_name, "fixture.txt");
  assert.equal(sharedActions.success, true);
  assert.equal(sharedActions.data.actions[0].kind, "republish_keywords");
  assert.equal(downloads.success, true);
  assert.equal(downloads.data.downloads[0].state, "queued");
});

test("ToolRegistry exposes summarized search, shared, and download diagnostics", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const searchSummary = await registry.invoke("summarizeKeywordSearches", {});
  const sharedSummary = await registry.invoke("summarizeSharedLibrary", {});
  const downloadSummary = await registry.invoke("summarizeDownloads", {});
  const combinedSummary = await registry.invoke("summarizeSearchPublishDiagnostics", {});

  assert.equal(searchSummary.success, true);
  assert.equal(searchSummary.data.totalSearches, 2);
  assert.equal(searchSummary.data.activeSearches, 1);
  assert.equal(searchSummary.data.publishEnabledCount, 1);
  assert.equal(searchSummary.data.publishAckedCount, 1);
  assert.equal(searchSummary.data.zeroHitTerminalCount, 1);

  assert.equal(sharedSummary.success, true);
  assert.equal(sharedSummary.data.totalFiles, 2);
  assert.equal(sharedSummary.data.keywordPublishQueuedCount, 1);
  assert.equal(sharedSummary.data.keywordPublishFailedCount, 1);
  assert.equal(sharedSummary.data.keywordPublishAckedCount, 1);
  assert.equal(sharedSummary.data.activeTransferFileCount, 2);
  assert.equal(sharedSummary.data.sharedActionCounts.republish_keywords, 1);
  assert.equal(sharedSummary.data.publishJobSurface, "shared_file_status_only");

  assert.equal(downloadSummary.success, true);
  assert.equal(downloadSummary.data.queueLen, 2);
  assert.equal(downloadSummary.data.totalDownloads, 2);
  assert.equal(downloadSummary.data.activeDownloads, 2);
  assert.equal(downloadSummary.data.downloadsWithErrors, 1);
  assert.equal(downloadSummary.data.downloadsWithSources, 1);
  assert.equal(downloadSummary.data.avgProgressPct, 22.5);

  assert.equal(combinedSummary.success, true);
  assert.equal(combinedSummary.data.searches.totalSearches, 2);
  assert.equal(combinedSummary.data.sharedLibrary.totalFiles, 2);
  assert.equal(combinedSummary.data.downloads.totalDownloads, 2);
});

test("ToolRegistry enables source tools only when sourcePath is configured", async () => {
  const withoutSource = new ToolRegistry(new StubClient(), new StubLogWatcher());
  const withoutSourceNames = withoutSource
    .getDefinitions()
    .map((definition) => definition.function.name);
  assert.equal(withoutSourceNames.includes("search_code"), false);
  assert.equal(withoutSourceNames.includes("read_file"), false);

  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    await writeFile(join(tmp.dir, "src", "lib.rs"), "pub fn handshake() {}\n", "utf8");

    const withSource = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
    });
    const withSourceNames = withSource
      .getDefinitions()
      .map((definition) => definition.function.name);

    assert.equal(withSourceNames.includes("search_code"), true);
    assert.equal(withSourceNames.includes("read_file"), true);
    assert.equal(withSourceNames.includes("show_function"), true);
    assert.equal(withSourceNames.includes("propose_patch"), true);
    assert.equal(withSourceNames.includes("git_blame"), true);
  } finally {
    await tmp.cleanup();
  }
});

test("ToolRegistry source tools search, read, and show function return structured data", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    await writeFile(
      join(tmp.dir, "src", "lib.rs"),
      "pub fn handshake() {}\nfn internal_task() {}\n",
      "utf8",
    );

    const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
    });

    const search = await registry.invoke("search_code", { query: "handshake" });
    assert.equal(search.success, true);
    assert.equal(search.data.totalMatches >= 1, true);

    const read = await registry.invoke("read_file", { path: "src/lib.rs" });
    assert.equal(read.success, true);
    assert.equal(read.data.path, "src/lib.rs");
    assert.equal(read.data.content.includes("internal_task"), true);

    const showFn = await registry.invoke("show_function", { name: "handshake" });
    assert.equal(showFn.success, true);
    assert.equal(showFn.data.totalMatches >= 1, true);
  } finally {
    await tmp.cleanup();
  }
});

test("ToolRegistry source tools block path traversal", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    await writeFile(join(tmp.dir, "src", "lib.rs"), "pub fn ok() {}\n", "utf8");

    const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
    });
    const result = await registry.invoke("read_file", { path: "../etc/passwd" });

    assert.deepEqual(result, {
      tool: "read_file",
      success: false,
      error: "Error: Path escapes source root: ../etc/passwd",
    });
  } finally {
    await tmp.cleanup();
  }
});

test("ToolRegistry propose_patch triggers patch proposal notifier with diff content", async () => {
  const tmp = await makeTempSourceDir();
  try {
    const notices = [];
    const proposalDir = join(tmp.dir, "proposals");
    const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
      proposalDir,
      patchProposalNotifier: async (notice) => {
        notices.push(notice);
      },
    });
    const diff = "diff --git a/src/lib.rs b/src/lib.rs\n@@\n-pub fn old() {}\n+pub fn new() {}\n";

    const result = await registry.invoke("propose_patch", { diff });

    assert.equal(result.success, true);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].artifactPath.startsWith(`${proposalDir}/`), true);
    assert.equal(notices[0].diff, diff.trim());
    assert.equal(notices[0].bytes, result.data.bytes);
    assert.equal(notices[0].lines, result.data.lines);
  } finally {
    await tmp.cleanup();
  }
});

test("ToolRegistry propose_patch succeeds even when notifier fails", async () => {
  const tmp = await makeTempSourceDir();
  try {
    const proposalDir = join(tmp.dir, "proposals");
    const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
      proposalDir,
      patchProposalNotifier: async () => {
        throw new Error("webhook down");
      },
    });

    const result = await registry.invoke("propose_patch", {
      diff: "diff --git a/src/lib.rs b/src/lib.rs\n@@\n-pub fn old() {}\n+pub fn new() {}\n",
    });

    assert.equal(result.success, true);
    assert.equal(result.data.applied, false);
    assert.equal(result.data.artifactPath.startsWith(`${proposalDir}/`), true);
  } finally {
    await tmp.cleanup();
  }
});
