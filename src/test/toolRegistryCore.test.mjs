import test from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry } from "../../dist/tools/toolRegistry.js";
import { StubClient, StubLogWatcher, StubRuntimeStore } from "./toolRegistryTestHelpers.mjs";

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

test("ToolRegistry does not expose getHistory when runtime store is unavailable", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher());

  const defs = registry.getDefinitions();
  const hasGetHistory = defs.some((def) => def.function.name === "getHistory");
  const hasDiscoverability = defs.some((def) => def.function.name === "getDiscoverabilityResults");
  const hasDiscoverabilitySummary = defs.some(
    (def) => def.function.name === "getDiscoverabilitySummary",
  );
  const hasSearchHealth = defs.some((def) => def.function.name === "getSearchHealthResults");
  const hasSearchHealthSummary = defs.some((def) => def.function.name === "getSearchHealthSummary");
  const hasLlmInvocationResults = defs.some((def) => def.function.name === "getLlmInvocationResults");
  const hasLlmInvocationSummary = defs.some((def) => def.function.name === "getLlmInvocationSummary");
  assert.equal(hasGetHistory, false);
  assert.equal(hasDiscoverability, false);
  assert.equal(hasDiscoverabilitySummary, false);
  assert.equal(hasSearchHealth, false);
  assert.equal(hasSearchHealthSummary, false);
  assert.equal(hasLlmInvocationResults, false);
  assert.equal(hasLlmInvocationSummary, false);

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

  const llmInvocationResults = await registry.invoke("getLlmInvocationResults", { n: 5 });
  assert.deepEqual(llmInvocationResults, {
    tool: "getLlmInvocationResults",
    success: false,
    error: "Unknown tool: getLlmInvocationResults",
  });

  const llmInvocationSummary = await registry.invoke("getLlmInvocationSummary", { n: 5 });
  assert.deepEqual(llmInvocationSummary, {
    tool: "getLlmInvocationSummary",
    success: false,
    error: "Unknown tool: getLlmInvocationSummary",
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
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
    toolProfile: "full",
  });

  const bootstrap = await registry.invoke("triggerBootstrap", {});
  const trace = await registry.invoke("traceLookup", { target_id: "abcd" });

  assert.equal(bootstrap.success, true);
  assert.equal(bootstrap.data.jobId, "job-1");
  assert.equal(trace.success, true);
  assert.equal(trace.data.traceId, "trace-1");
  assert.equal(trace.data.hops[0].peerQueried, "abcd");
});

test("ToolRegistry mattermost profile excludes debug and source-oriented tools", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore(), {
    toolProfile: "mattermost_command",
  });
  const names = registry.getDefinitions().map((definition) => definition.function.name);

  assert.equal(names.includes("getNodeInfo"), true);
  assert.equal(names.includes("searchLogs"), true);
  assert.equal(names.includes("summarizeSearchPublishDiagnostics"), true);
  assert.equal(names.includes("triggerBootstrap"), false);
  assert.equal(names.includes("traceLookup"), false);
  assert.equal(names.includes("search_code"), false);
  assert.equal(names.includes("read_file"), false);
  assert.equal(names.includes("show_function"), false);
  assert.equal(names.includes("propose_patch"), false);
  assert.equal(names.includes("git_blame"), false);
});

test("ToolRegistry observer profile is read-only and excludes source/patch tools", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore(), {
    sourcePath: process.cwd(),
    toolProfile: "observer_cycle",
  });
  const names = registry.getDefinitions().map((definition) => definition.function.name);

  assert.equal(names.includes("getNodeInfo"), true);
  assert.equal(names.includes("getHistory"), true);
  assert.equal(names.includes("getLlmInvocationSummary"), true);
  assert.equal(names.includes("summarizeSearchPublishDiagnostics"), true);
  assert.equal(names.includes("triggerBootstrap"), false);
  assert.equal(names.includes("traceLookup"), false);
  assert.equal(names.includes("search_code"), false);
  assert.equal(names.includes("read_file"), false);
  assert.equal(names.includes("show_function"), false);
  assert.equal(names.includes("propose_patch"), false);
  assert.equal(names.includes("git_blame"), false);
});

test("ToolRegistry managed analysis profile allows source reads but not side effects or patch proposals", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore(), {
    sourcePath: process.cwd(),
    toolProfile: "managed_instance_analysis",
  });
  const names = registry.getDefinitions().map((definition) => definition.function.name);

  assert.equal(names.includes("getNodeInfo"), true);
  assert.equal(names.includes("summarizeSearchPublishDiagnostics"), true);
  assert.equal(names.includes("search_code"), true);
  assert.equal(names.includes("read_file"), true);
  assert.equal(names.includes("show_function"), true);
  assert.equal(names.includes("git_blame"), true);
  assert.equal(names.includes("triggerBootstrap"), false);
  assert.equal(names.includes("traceLookup"), false);
  assert.equal(names.includes("propose_patch"), false);
});

test("ToolRegistry mattermost profile rejects forbidden tools at invoke time", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore(), {
    toolProfile: "mattermost_command",
  });

  const bootstrap = await registry.invoke("triggerBootstrap", {});
  const trace = await registry.invoke("traceLookup", {});

  assert.deepEqual(bootstrap, {
    tool: "triggerBootstrap",
    success: false,
    error: "Unknown tool: triggerBootstrap",
  });
  assert.deepEqual(trace, {
    tool: "traceLookup",
    success: false,
    error: "Unknown tool: traceLookup",
  });
});

test("ToolRegistry redacts secrets from log tool output", async () => {
  class SecretLogWatcher {
    getRecentLines() {
      return ["token=super-secret", "Authorization: Bearer abc123"];
    }
  }

  const registry = new ToolRegistry(new StubClient(), new SecretLogWatcher());

  const recent = await registry.invoke("getRecentLogs", {});
  const searched = await registry.invoke("searchLogs", { query: "secret" });

  assert.equal(recent.success, true);
  assert.deepEqual(recent.data, ["token=[redacted]", "Authorization: Bearer [redacted]"]);
  assert.equal(searched.success, true);
  assert.deepEqual(searched.data.matches, ["token=[redacted]"]);
});
