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

test("ToolRegistry does not expose getHistory when runtime store is unavailable", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const defs = registry.getDefinitions();
  const hasGetHistory = defs.some((def) => def.function.name === "getHistory");
  assert.equal(hasGetHistory, false);

  const result = await registry.invoke("getHistory", { n: 5 });
  assert.deepEqual(result, {
    tool: "getHistory",
    success: false,
    error: "Unknown tool: getHistory",
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
