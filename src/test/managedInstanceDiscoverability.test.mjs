import test from "node:test";
import assert from "node:assert/strict";

import { ManagedInstanceDiscoverabilityService } from "../../dist/instances/managedInstanceDiscoverability.js";

function makeClient(sequence) {
  let detailIndex = 0;
  return {
    async loadToken() {},
    async getReadiness() {
      return { ready: true, statusReady: true, searchesReady: true };
    },
    async getPeers() {
      return sequence.peers ?? [];
    },
    async startKeywordSearch({ query }) {
      return {
        keyword_id_hex: sequence.searchId,
        search_id_hex: sequence.searchId,
        query,
      };
    },
    async getSearchDetail(searchId) {
      assert.equal(searchId, sequence.searchId);
      const current = sequence.details[Math.min(detailIndex, sequence.details.length - 1)];
      detailIndex += 1;
      return current;
    },
  };
}

test("ManagedInstanceDiscoverabilityService completes with found outcome", async () => {
  const publisherRecord = { id: "publisher" };
  const searcherRecord = { id: "searcher" };
  const searcherClient = makeClient({
    searchId: "feedfacefeedfacefeedfacefeedface",
    peers: [{ id: "p1" }, { id: "p2" }],
    details: [
      { search: { state: "running" }, hits: [] },
      { search: { state: "running" }, hits: [{ filename: "fixture.txt" }] },
    ],
  });
  const publisherClient = {
    async loadToken() {},
    async getReadiness() {
      return { ready: true, statusReady: true, searchesReady: true };
    },
    async getPeers() {
      return [{ id: "p0" }];
    },
  };
  const diagnostics = {
    async getInstanceRecord(id) {
      return id === "publisher" ? publisherRecord : searcherRecord;
    },
    getClientForInstance(record) {
      return record.id === "publisher" ? publisherClient : searcherClient;
    },
  };
  const sharingCalls = [];
  const sharing = {
    async getOverview() {
      return {
        files: [
          {
            identity: {
              file_name: "mule-doctor-publisher-discoverability.txt",
            },
            keyword_publish_queued: false,
            keyword_publish_acked: 1,
          },
        ],
        actions: [{ kind: "republish_keywords", state: "idle" }],
        downloads: [],
      };
    },
    async ensureFixture(id, input = {}) {
      sharingCalls.push(["ensureFixture", id, input.fixtureId]);
      return {
        fixtureId: input.fixtureId ?? "discoverability",
        token: "mule-doctor-publisher-discoverability",
        fileName: "mule-doctor-publisher-discoverability.txt",
        relativePath: "mule-doctor-publisher-discoverability.txt",
        absolutePath: "/tmp/mule-doctor-publisher-discoverability.txt",
        sizeBytes: 64,
      };
    },
    async reindex(id) {
      sharingCalls.push(["reindex", id]);
      return {};
    },
    async republishSources(id) {
      sharingCalls.push(["republishSources", id]);
      return {};
    },
    async republishKeywords(id) {
      sharingCalls.push(["republishKeywords", id]);
      return {};
    },
  };

  const service = new ManagedInstanceDiscoverabilityService(diagnostics, sharing);
  const result = await service.runControlledCheck({
    publisherInstanceId: "publisher",
    searcherInstanceId: "searcher",
    pollIntervalMs: 1,
    timeoutMs: 1_000,
  });

  assert.equal(result.outcome, "found");
  assert.equal(result.resultCount, 1);
  assert.equal(result.searchId, "feedfacefeedfacefeedfacefeedface");
  assert.equal(result.publisherSharedBefore.file.identity.file_name, "mule-doctor-publisher-discoverability.txt");
  assert.equal(result.publisherSharedAfter.file.identity.file_name, "mule-doctor-publisher-discoverability.txt");
  assert.deepEqual(sharingCalls, [
    ["ensureFixture", "publisher", undefined],
    ["reindex", "publisher"],
    ["republishSources", "publisher"],
    ["republishKeywords", "publisher"],
  ]);
  assert.deepEqual(
    result.states.map((entry) => [entry.state, entry.hits]),
    [
      ["running", 0],
      ["running", 1],
    ],
  );
});

test("ManagedInstanceDiscoverabilityService returns completed_empty for terminal empty search", async () => {
  const diagnostics = {
    async getInstanceRecord(id) {
      return { id };
    },
    getClientForInstance(record) {
      if (record.id === "publisher") {
        return {
          async loadToken() {},
          async getReadiness() {
            return { ready: true, statusReady: true, searchesReady: true };
          },
          async getPeers() {
            return [];
          },
        };
      }
      return makeClient({
        searchId: "deadbeefdeadbeefdeadbeefdeadbeef",
        peers: [],
        details: [{ search: { state: "completed" }, hits: [] }],
      });
    },
  };
  const sharing = {
    async getOverview() {
      return {
        files: [],
        actions: [],
        downloads: [],
      };
    },
    async ensureFixture() {
      return {
        fixtureId: "discoverability",
        token: "mule-doctor-publisher-discoverability",
        fileName: "mule-doctor-publisher-discoverability.txt",
        relativePath: "mule-doctor-publisher-discoverability.txt",
        absolutePath: "/tmp/mule-doctor-publisher-discoverability.txt",
        sizeBytes: 64,
      };
    },
    async reindex() {},
    async republishSources() {},
    async republishKeywords() {},
  };

  const service = new ManagedInstanceDiscoverabilityService(diagnostics, sharing);
  const result = await service.runControlledCheck({
    publisherInstanceId: "publisher",
    searcherInstanceId: "searcher",
    pollIntervalMs: 1,
    timeoutMs: 1_000,
  });

  assert.equal(result.outcome, "completed_empty");
  assert.equal(result.finalState, "completed");
  assert.equal(result.resultCount, 0);
  assert.equal(result.publisherSharedBefore.file, undefined);
  assert.equal(result.publisherSharedAfter.file, undefined);
});
