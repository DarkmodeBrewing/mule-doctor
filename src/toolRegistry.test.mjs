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
}

class StubLogWatcher {
  getRecentLines(n) {
    return [`last-${n}`];
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
