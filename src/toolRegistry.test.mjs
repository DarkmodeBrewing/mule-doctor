import test from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry } from "../dist/tools/toolRegistry.js";

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
  const registry = new ToolRegistry(
    new StubClient(),
    new StubLogWatcher(),
    new StubRuntimeStore()
  );

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
