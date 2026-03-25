import test from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry } from "../../dist/tools/toolRegistry.js";
import { StubClient, StubLogWatcher, StubRuntimeStore } from "./toolRegistryTestHelpers.mjs";

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

test("ToolRegistry getLlmInvocationResults returns recent audit metadata", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore());

  const result = await registry.invoke("getLlmInvocationResults", { n: 10 });

  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].surface, "mattermost_command");
  assert.equal(result.data[1].finishReason, "rate_limited");
});

test("ToolRegistry getLlmInvocationSummary returns aggregated audit totals", async () => {
  const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), new StubRuntimeStore());

  const result = await registry.invoke("getLlmInvocationSummary", { n: 10 });

  assert.equal(result.success, true);
  assert.equal(result.data.totalInvocations, 2);
  assert.equal(result.data.finishReasonCounts.completed, 1);
  assert.equal(result.data.finishReasonCounts.rate_limited, 1);
  assert.equal(result.data.humanTriggeredCount, 1);
  assert.equal(result.data.scheduledCount, 1);
});
