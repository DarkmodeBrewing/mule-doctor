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
  assert.equal(summary.foundCount, 1);
  assert.equal(summary.completedEmptyCount, 0);
  assert.equal(summary.timedOutCount, 0);
  assert.equal(summary.dispatchReadyCount, 0);
  assert.equal(summary.dispatchNotReadyCount, 2);
  assert.equal(summary.degradedTransportCount, 0);
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
