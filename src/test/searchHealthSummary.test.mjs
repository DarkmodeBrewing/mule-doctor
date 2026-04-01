import test from "node:test";
import assert from "node:assert/strict";

import { SearchHealthLog } from "../../dist/searchHealth/searchHealthLog.js";
import { summarizeSearchHealthRecords } from "../../dist/searchHealth/summary.js";

test("summarizeSearchHealthRecords derives readiness and transport counts", () => {
  const summary = summarizeSearchHealthRecords([
    {
      recordedAt: "2026-03-12T10:00:00.000Z",
      source: "controlled_discoverability",
      query: "alpha",
      searchId: "search-1",
      dispatchedAt: "2026-03-12T09:59:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 1, degradedIndicators: [] },
        searcher: { peerCount: 2, degradedIndicators: [] },
      },
      states: [],
      resultCount: 1,
      outcome: "found",
      finalState: "completed",
      controlledContext: {
        publisherInstanceId: "a",
        searcherInstanceId: "b",
        fixture: {
          fixtureId: "f-1",
          fileName: "f-1.txt",
          relativePath: "f-1.txt",
          sizeBytes: 16,
        },
      },
    },
    {
      recordedAt: "2026-03-12T11:00:00.000Z",
      source: "controlled_discoverability",
      query: "beta",
      searchId: "search-2",
      dispatchedAt: "2026-03-12T10:59:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: false, searchesReady: false, ready: false },
      },
      transportAtDispatch: {
        publisher: { peerCount: 1, degradedIndicators: [] },
        searcher: { peerCount: 0, degradedIndicators: ["no_live_peers", "search_pipeline_not_ready"] },
      },
      states: [],
      resultCount: 0,
      outcome: "timed_out",
      finalState: "timed_out",
      controlledContext: {
        publisherInstanceId: "a",
        searcherInstanceId: "c",
        fixture: {
          fixtureId: "f-2",
          fileName: "f-2.txt",
          relativePath: "f-2.txt",
          sizeBytes: 16,
        },
      },
    },
  ]);

  assert.equal(summary.totalSearches, 2);
  assert.equal(summary.activeCount, 0);
  assert.equal(summary.foundCount, 1);
  assert.equal(summary.timedOutCount, 1);
  assert.equal(summary.dispatchReadyCount, 1);
  assert.equal(summary.dispatchNotReadyCount, 1);
  assert.equal(summary.degradedTransportCount, 1);
  assert.equal(summary.latestOutcome, "timed_out");
  assert.equal(summary.latestPair.searcherInstanceId, "c");
});

test("summarizeSearchHealthRecords tolerates malformed persisted records", () => {
  const summary = summarizeSearchHealthRecords([
    {
      recordedAt: "2026-03-12T10:00:00.000Z",
      source: "controlled_discoverability",
      query: "alpha",
      searchId: "search-1",
      dispatchedAt: "2026-03-12T09:59:00.000Z",
      outcome: "found",
    },
    {
      recordedAt: "2026-03-12T11:00:00.000Z",
      source: "controlled_discoverability",
      query: "beta",
      searchId: "search-2",
      dispatchedAt: "2026-03-12T10:59:00.000Z",
      outcome: "not-a-real-outcome",
      readinessAtDispatch: null,
      transportAtDispatch: null,
    },
  ]);

  assert.equal(summary.totalSearches, 2);
  assert.equal(summary.activeCount, 0);
  assert.equal(summary.foundCount, 1);
  assert.equal(summary.completedEmptyCount, 0);
  assert.equal(summary.timedOutCount, 0);
  assert.equal(summary.dispatchReadyCount, 0);
  assert.equal(summary.dispatchNotReadyCount, 2);
  assert.equal(summary.degradedTransportCount, 0);
});

test("summarizeSearchHealthRecords includes managed-instance observations", () => {
  const summary = summarizeSearchHealthRecords([
    {
      recordedAt: "2026-03-23T12:00:00.000Z",
      source: "managed_instance_observation",
      query: "fixture-token",
      searchId: "search-3",
      dispatchedAt: "2026-03-23T11:59:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 4, degradedIndicators: [] },
        searcher: { peerCount: 4, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:00:00.000Z", state: "running", hits: 0 }],
      resultCount: 0,
      outcome: "active",
      finalState: "running",
      observedContext: {
        instanceId: "searcher-a",
      },
    },
  ]);

  assert.equal(summary.totalSearches, 1);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.dispatchReadyCount, 1);
  assert.equal(summary.degradedTransportCount, 0);
  assert.equal(summary.successRatePct, undefined);
  assert.equal(summary.latestSource, "managed_instance_observation");
  assert.equal(summary.latestInstanceId, "searcher-a");
});

test("summarizeSearchHealthRecords includes observer-target observations", () => {
  const summary = summarizeSearchHealthRecords([
    {
      recordedAt: "2026-03-23T12:05:00.000Z",
      source: "observer_target_observation",
      query: "external-search",
      searchId: "search-4",
      dispatchedAt: "2026-03-23T12:04:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 3, degradedIndicators: [] },
        searcher: { peerCount: 3, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:05:00.000Z", state: "running", hits: 0 }],
      resultCount: 0,
      outcome: "active",
      finalState: "running",
      observerContext: {
        target: { kind: "external" },
        label: "external configured rust-mule client",
      },
    },
  ]);

  assert.equal(summary.latestSource, "observer_target_observation");
  assert.equal(summary.latestTargetLabel, "external configured rust-mule client");
});

test("summarizeSearchHealthRecords collapses multiple records for the same logical search", () => {
  const summary = summarizeSearchHealthRecords([
    {
      recordedAt: "2026-03-23T12:00:00.000Z",
      source: "controlled_discoverability",
      query: "fixture-token",
      searchId: "search-5",
      dispatchedAt: "2026-03-23T12:00:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 1, degradedIndicators: [] },
        searcher: { peerCount: 1, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:00:00.000Z", state: "dispatched", hits: 0 }],
      resultCount: 0,
      outcome: "active",
      finalState: "dispatched",
      controlledContext: {
        publisherInstanceId: "a",
        searcherInstanceId: "b",
        fixture: {
          fixtureId: "f-5",
          fileName: "f-5.txt",
          relativePath: "f-5.txt",
          sizeBytes: 16,
        },
      },
    },
    {
      recordedAt: "2026-03-23T12:00:05.000Z",
      source: "controlled_discoverability",
      query: "fixture-token",
      searchId: "search-5",
      dispatchedAt: "2026-03-23T12:00:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 1, degradedIndicators: [] },
        searcher: { peerCount: 1, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:00:05.000Z", state: "completed", hits: 1 }],
      resultCount: 1,
      outcome: "found",
      finalState: "completed",
      controlledContext: {
        publisherInstanceId: "a",
        searcherInstanceId: "b",
        fixture: {
          fixtureId: "f-5",
          fileName: "f-5.txt",
          relativePath: "f-5.txt",
          sizeBytes: 16,
        },
      },
    },
  ]);

  assert.equal(summary.totalSearches, 1);
  assert.equal(summary.activeCount, 0);
  assert.equal(summary.foundCount, 1);
  assert.equal(summary.successRatePct, 100);
  assert.equal(summary.latestOutcome, "found");
});

test("summarizeSearchHealthRecords keeps recency ordering after collapsing logical searches", () => {
  const summary = summarizeSearchHealthRecords([
    {
      recordedAt: "2026-03-23T12:00:00.000Z",
      source: "controlled_discoverability",
      query: "older-search",
      searchId: "search-old",
      dispatchedAt: "2026-03-23T12:00:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 1, degradedIndicators: [] },
        searcher: { peerCount: 1, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:00:00.000Z", state: "dispatched", hits: 0 }],
      resultCount: 0,
      outcome: "active",
      finalState: "dispatched",
      controlledContext: {
        publisherInstanceId: "a",
        searcherInstanceId: "b",
        fixture: {
          fixtureId: "f-old",
          fileName: "f-old.txt",
          relativePath: "f-old.txt",
          sizeBytes: 16,
        },
      },
    },
    {
      recordedAt: "2026-03-23T12:01:00.000Z",
      source: "controlled_discoverability",
      query: "newer-search",
      searchId: "search-new",
      dispatchedAt: "2026-03-23T12:01:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 1, degradedIndicators: [] },
        searcher: { peerCount: 1, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:01:00.000Z", state: "completed", hits: 1 }],
      resultCount: 1,
      outcome: "found",
      finalState: "completed",
      controlledContext: {
        publisherInstanceId: "c",
        searcherInstanceId: "d",
        fixture: {
          fixtureId: "f-new",
          fileName: "f-new.txt",
          relativePath: "f-new.txt",
          sizeBytes: 16,
        },
      },
    },
    {
      recordedAt: "2026-03-23T12:02:00.000Z",
      source: "controlled_discoverability",
      query: "older-search",
      searchId: "search-old",
      dispatchedAt: "2026-03-23T12:00:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 1, degradedIndicators: [] },
        searcher: { peerCount: 1, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:02:00.000Z", state: "completed", hits: 1 }],
      resultCount: 1,
      outcome: "found",
      finalState: "completed",
      controlledContext: {
        publisherInstanceId: "a",
        searcherInstanceId: "b",
        fixture: {
          fixtureId: "f-old",
          fileName: "f-old.txt",
          relativePath: "f-old.txt",
          sizeBytes: 16,
        },
      },
    },
  ]);

  assert.equal(summary.totalSearches, 2);
  assert.equal(summary.lastSuccessAt, "2026-03-23T12:02:00.000Z");
  assert.equal(summary.latestQuery, "older-search");
});

test("summarizeSearchHealthRecords collapses manual dispatch with later managed observation", () => {
  const summary = summarizeSearchHealthRecords([
    {
      recordedAt: "2026-03-23T12:00:00.000Z",
      source: "operator_triggered_search",
      query: "alpha",
      searchId: "search-6",
      dispatchedAt: "2026-03-23T12:00:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 2, degradedIndicators: [] },
        searcher: { peerCount: 2, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:00:00.000Z", state: "dispatched", hits: 0 }],
      resultCount: 0,
      outcome: "active",
      finalState: "dispatched",
      observedContext: {
        instanceId: "a",
      },
    },
    {
      recordedAt: "2026-03-23T12:00:05.000Z",
      source: "managed_instance_observation",
      query: "alpha",
      searchId: "search-6",
      dispatchedAt: "2026-03-23T12:00:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 2, degradedIndicators: [] },
        searcher: { peerCount: 2, degradedIndicators: [] },
      },
      states: [{ observedAt: "2026-03-23T12:00:05.000Z", state: "completed", hits: 1 }],
      resultCount: 1,
      outcome: "found",
      finalState: "completed",
      observedContext: {
        instanceId: "a",
      },
    },
  ]);

  assert.equal(summary.totalSearches, 1);
  assert.equal(summary.activeCount, 0);
  assert.equal(summary.foundCount, 1);
  assert.equal(summary.latestSource, "managed_instance_observation");
});

test("SearchHealthLog sanitizes records when reading from runtime store", async () => {
  const log = new SearchHealthLog({
    async getRecentSearchHealthResults() {
      return [
        {
          recordedAt: "2026-03-12T10:00:00.000Z",
          source: "controlled_discoverability",
          query: "alpha",
          searchId: "search-1",
          dispatchedAt: "2026-03-12T09:59:00.000Z",
          outcome: "found",
          transportAtDispatch: {
            publisher: { peerCount: 1, degradedIndicators: ["ok", 7] },
          },
        },
      ];
    },
  });

  const records = await log.listRecent(10);

  assert.equal(records.length, 1);
  assert.deepEqual(records[0].readinessAtDispatch.publisher, {
    statusReady: false,
    searchesReady: false,
    ready: false,
  });
  assert.deepEqual(records[0].transportAtDispatch.publisher.degradedIndicators, ["ok"]);
  assert.deepEqual(records[0].transportAtDispatch.searcher.degradedIndicators, []);
});

test("SearchHealthLog filters recent records by source, outcome, dispatch readiness, and target", async () => {
  const records = [
    {
      recordedAt: "2026-03-24T10:00:00.000Z",
      source: "operator_triggered_search",
      query: "manual-a",
      searchId: "search-1",
      dispatchedAt: "2026-03-24T10:00:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 3, degradedIndicators: [] },
        searcher: { peerCount: 3, degradedIndicators: [] },
      },
      states: [],
      resultCount: 0,
      outcome: "active",
      finalState: "running",
      observedContext: {
        instanceId: "searcher-a",
      },
    },
    {
      recordedAt: "2026-03-24T10:05:00.000Z",
      source: "observer_target_observation",
      query: "observer-b",
      searchId: "search-2",
      dispatchedAt: "2026-03-24T10:04:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: false, searchesReady: false, ready: false },
        searcher: { statusReady: false, searchesReady: false, ready: false },
      },
      transportAtDispatch: {
        publisher: { peerCount: 0, degradedIndicators: ["no_live_peers"] },
        searcher: { peerCount: 0, degradedIndicators: ["no_live_peers"] },
      },
      states: [],
      resultCount: 0,
      outcome: "timed_out",
      finalState: "timed_out",
      observerContext: {
        target: { kind: "external" },
        label: "external configured rust-mule client",
      },
    },
    {
      recordedAt: "2026-03-24T10:06:00.000Z",
      source: "controlled_discoverability",
      query: "fixture",
      searchId: "search-3",
      dispatchedAt: "2026-03-24T10:05:00.000Z",
      readinessAtDispatch: {
        publisher: { statusReady: true, searchesReady: true, ready: true },
        searcher: { statusReady: true, searchesReady: true, ready: true },
      },
      transportAtDispatch: {
        publisher: { peerCount: 2, degradedIndicators: [] },
        searcher: { peerCount: 2, degradedIndicators: [] },
      },
      states: [],
      resultCount: 1,
      outcome: "found",
      finalState: "completed",
      controlledContext: {
        publisherInstanceId: "lab-a",
        searcherInstanceId: "lab-b",
        fixture: {
          fixtureId: "fixture",
          fileName: "fixture.txt",
          relativePath: "fixture.txt",
          sizeBytes: 16,
        },
      },
    },
  ];

  const log = new SearchHealthLog({
    async getRecentSearchHealthResults() {
      return records;
    },
  });

  assert.equal(
    (await log.listRecent(10, { source: "operator_triggered_search" })).length,
    1,
  );
  assert.equal(
    (await log.listRecent(10, { outcome: "timed_out" }))[0].observerContext.label,
    "external configured rust-mule client",
  );
  assert.equal(
    (await log.listRecent(10, { dispatchReady: false }))[0].searchId,
    "search-2",
  );
  assert.equal(
    (await log.listRecent(10, { target: "lab-b" }))[0].controlledContext.searcherInstanceId,
    "lab-b",
  );
  assert.equal(
    (await log.listRecent(10, { target: "external" }))[0].observerContext.target.kind,
    "external",
  );
});

test("SearchHealthLog filters within a bounded recent scan window and returns the most recent matches", async () => {
  const records = Array.from({ length: 120 }, (_, index) => ({
    recordedAt: `2026-03-24T10:${String(index).padStart(2, "0")}:00.000Z`,
    source: "managed_instance_observation",
    query: `search-${index}`,
    searchId: `search-${index}`,
    dispatchedAt: `2026-03-24T09:${String(index).padStart(2, "0")}:00.000Z`,
    readinessAtDispatch: {
      publisher: { statusReady: true, searchesReady: true, ready: true },
      searcher: { statusReady: true, searchesReady: true, ready: true },
    },
    transportAtDispatch: {
      publisher: { peerCount: 2, degradedIndicators: [] },
      searcher: { peerCount: 2, degradedIndicators: [] },
    },
    states: [],
    resultCount: 0,
    outcome: index >= 70 && index < 80 ? "timed_out" : "active",
    finalState: index >= 70 && index < 80 ? "timed_out" : "running",
    observedContext: {
      instanceId: index >= 70 && index < 80 ? "needle-instance" : "other-instance",
    },
  }));

  let requestedLimit = 0;
  const log = new SearchHealthLog({
    async getRecentSearchHealthResults(limit) {
      requestedLimit = limit;
      return records.slice(-limit);
    },
  });

  const filtered = await log.listRecent(3, {
    source: "managed_instance_observation",
    outcome: "timed_out",
    target: "needle-instance",
  });

  assert.equal(requestedLimit, 50);
  assert.deepEqual(
    filtered.map((record) => record.searchId),
    ["search-77", "search-78", "search-79"],
  );
});

test("SearchHealthLog summarizes filtered records", async () => {
  const log = new SearchHealthLog({
    async getRecentSearchHealthResults() {
      return [
        {
          recordedAt: "2026-03-24T10:00:00.000Z",
          source: "operator_triggered_search",
          query: "manual-a",
          searchId: "search-1",
          dispatchedAt: "2026-03-24T10:00:00.000Z",
          readinessAtDispatch: {
            publisher: { statusReady: true, searchesReady: true, ready: true },
            searcher: { statusReady: true, searchesReady: true, ready: true },
          },
          transportAtDispatch: {
            publisher: { peerCount: 3, degradedIndicators: [] },
            searcher: { peerCount: 3, degradedIndicators: [] },
          },
          states: [],
          resultCount: 0,
          outcome: "active",
          finalState: "running",
          observedContext: {
            instanceId: "searcher-a",
          },
        },
        {
          recordedAt: "2026-03-24T10:05:00.000Z",
          source: "operator_triggered_search",
          query: "manual-b",
          searchId: "search-2",
          dispatchedAt: "2026-03-24T10:04:00.000Z",
          readinessAtDispatch: {
            publisher: { statusReady: false, searchesReady: false, ready: false },
            searcher: { statusReady: false, searchesReady: false, ready: false },
          },
          transportAtDispatch: {
            publisher: { peerCount: 0, degradedIndicators: ["no_live_peers"] },
            searcher: { peerCount: 0, degradedIndicators: ["no_live_peers"] },
          },
          states: [],
          resultCount: 0,
          outcome: "timed_out",
          finalState: "timed_out",
          observedContext: {
            instanceId: "searcher-b",
          },
        },
      ];
    },
  });

  const summary = await log.summarizeRecent(10, {
    source: "operator_triggered_search",
    dispatchReady: false,
  });

  assert.equal(summary.totalSearches, 1);
  assert.equal(summary.timedOutCount, 1);
  assert.equal(summary.dispatchNotReadyCount, 1);
  assert.equal(summary.latestInstanceId, "searcher-b");
});
