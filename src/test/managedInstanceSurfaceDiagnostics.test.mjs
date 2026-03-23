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

test("ManagedInstanceSurfaceDiagnosticsService exposes structured runtime surface detail", async () => {
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
          return {
            ready: true,
            searches: [
              {
                search_id_hex: "search-1",
                keyword_id_hex: "keyword-1",
                keyword_label: "fixture-token",
                state: "running",
                created_secs_ago: 42,
                hits: 2,
                want_search: true,
                publish_enabled: true,
                got_publish_ack: false,
              },
            ],
          };
        },
        async getSharedFiles() {
          return {
            files: [
              {
                identity: {
                  file_name: "fixture.txt",
                  file_id_hex: "file-1",
                  file_size: 128,
                },
                local_source_cached: true,
                keyword_publish_queued: true,
                keyword_publish_failed: false,
                keyword_publish_acked: 2,
                source_publish_response_received: true,
                queued_downloads: 1,
                inflight_downloads: 0,
                queued_uploads: 0,
                inflight_uploads: 1,
              },
            ],
          };
        },
        async getSharedActions() {
          return {
            actions: [
              {
                kind: "republish_keywords",
                state: "running",
                file_name: "fixture.txt",
                file_id_hex: "file-1",
              },
            ],
          };
        },
        async getDownloads() {
          return {
            downloads: [
              {
                file_name: "fixture.bin",
                file_hash_md4_hex: "hash-1",
                state: "queued",
                progress_pct: 50,
                source_count: 2,
              },
            ],
          };
        },
        async getPeers() {
          return [{ id: "peer-1" }];
        },
        async getSearchDetail() {
          return {
            search: { search_id_hex: "search-1" },
            hits: [{ filename: "fixture.txt" }],
          };
        },
      };
    },
  };

  const service = new ManagedInstanceSurfaceDiagnosticsService(diagnostics);
  const snapshot = await service.getSnapshot("managed-a");

  assert.equal(snapshot.detail.searches[0].label, "fixture-token");
  assert.equal(snapshot.detail.searches[0].hits, 2);
  assert.equal(snapshot.detail.sharedFiles[0].fileName, "fixture.txt");
  assert.equal(snapshot.detail.sharedFiles[0].keywordPublishAckedCount, 2);
  assert.equal(snapshot.detail.sharedActions[0].kind, "republish_keywords");
  assert.equal(snapshot.detail.downloads[0].fileName, "fixture.bin");
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
