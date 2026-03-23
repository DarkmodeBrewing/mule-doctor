import test from "node:test";
import assert from "node:assert/strict";

import { ManagedInstanceSurfaceDiagnosticsService } from "../../dist/instances/managedInstanceSurfaceDiagnostics.js";

test("ManagedInstanceSurfaceDiagnosticsService persists deduplicated observed search health records", async () => {
  const detailCalls = [];
  const appendedRecords = [];
  const searchInfo = {
    search_id_hex: "search-1",
    keyword_label: "fixture-token",
    state: "running",
    created_secs_ago: 30,
    hits: 0,
  };
  const diagnostics = {
    async getInstanceRecord(id) {
      return { id };
    },
    getClientForInstance() {
      return {
        async loadToken() {},
        async getStatus() {
          return { ready: true };
        },
        async getSearches() {
          return { ready: true, searches: [searchInfo] };
        },
        async getSharedFiles() {
          return { files: [] };
        },
        async getSharedActions() {
          return { actions: [] };
        },
        async getDownloads() {
          return { downloads: [] };
        },
        async getPeers() {
          return [{ id: "peer-1" }, { id: "peer-2" }];
        },
        async getSearchDetail(searchId) {
          detailCalls.push(searchId);
          return {
            search: { ...searchInfo, search_id_hex: searchId },
            hits: searchInfo.hits > 0 ? [{ filename: "fixture.txt" }] : [],
          };
        },
      };
    },
  };

  const service = new ManagedInstanceSurfaceDiagnosticsService(diagnostics, {
    searchHealthLog: {
      async append(record) {
        appendedRecords.push(record);
      },
    },
  });

  const first = await service.getSummary("managed-a");
  const second = await service.getSummary("managed-a");
  searchInfo.state = "completed";
  searchInfo.hits = 1;
  const third = await service.getSummary("managed-a");

  assert.equal(first.summary.searches.totalSearches, 1);
  assert.equal(second.summary.searches.totalSearches, 1);
  assert.equal(third.summary.searches.totalSearches, 1);
  assert.deepEqual(detailCalls, ["search-1", "search-1"]);
  assert.equal(appendedRecords.length, 2);
  assert.equal(appendedRecords[0].source, "managed_instance_observation");
  assert.equal(appendedRecords[0].observedContext.instanceId, "managed-a");
  assert.equal(appendedRecords[0].outcome, "active");
  assert.equal(appendedRecords[0].readinessAtDispatch.searcher.ready, true);
  assert.equal(appendedRecords[0].transportAtDispatch.searcher.peerCount, 2);
  assert.equal(appendedRecords[1].outcome, "found");
  assert.equal(appendedRecords[1].finalState, "completed");
  assert.equal(appendedRecords[1].resultCount, 1);
});

test("ManagedInstanceSurfaceDiagnosticsService prunes observed-search cache when searches disappear", async () => {
  const appendedRecords = [];
  const searchList = [
    {
      search_id_hex: "search-1",
      keyword_label: "fixture-token",
      state: "running",
      created_secs_ago: 15,
      hits: 0,
    },
  ];
  const diagnostics = {
    async getInstanceRecord(id) {
      return { id };
    },
    getClientForInstance() {
      return {
        async loadToken() {},
        async getStatus() {
          return { ready: true };
        },
        async getSearches() {
          return { ready: true, searches: [...searchList] };
        },
        async getSharedFiles() {
          return { files: [] };
        },
        async getSharedActions() {
          return { actions: [] };
        },
        async getDownloads() {
          return { downloads: [] };
        },
        async getPeers() {
          return [{ id: "peer-1" }];
        },
        async getSearchDetail(searchId) {
          return {
            search: { ...searchList[0], search_id_hex: searchId },
            hits: [],
          };
        },
      };
    },
  };

  const service = new ManagedInstanceSurfaceDiagnosticsService(diagnostics, {
    searchHealthLog: {
      async append(record) {
        appendedRecords.push(record);
      },
    },
  });

  await service.getSummary("managed-a");
  searchList.length = 0;
  await service.getSummary("managed-a");
  searchList.push({
    search_id_hex: "search-1",
    keyword_label: "fixture-token",
    state: "running",
    created_secs_ago: 5,
    hits: 0,
  });
  await service.getSummary("managed-a");

  assert.equal(appendedRecords.length, 1);
});
