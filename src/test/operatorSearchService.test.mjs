import test from "node:test";
import assert from "node:assert/strict";

import { OperatorSearchService } from "../../dist/operatorConsole/operatorSearchService.js";

function makeClient(overrides = {}) {
  return {
    async loadToken() {},
    async getReadiness() {
      return {
        ready: true,
        statusReady: true,
        searchesReady: true,
        status: { ready: true },
        searches: { ready: true, searches: [] },
      };
    },
    async getPeers() {
      return [{ id: "p1" }, { id: "p2" }];
    },
    async startKeywordSearch({ query, keywordIdHex }) {
      return {
        search_id_hex: "manual-search-1",
        keyword_id_hex: keywordIdHex,
        query,
      };
    },
    ...overrides,
  };
}

test("OperatorSearchService records manual managed-instance dispatch", async () => {
  const records = [];
  const service = new OperatorSearchService({
    managedDiagnostics: {
      async getInstanceRecord(id) {
        return { id, status: "running" };
      },
      getClientForInstance() {
        return makeClient();
      },
    },
    observerTargetResolver: {
      async resolve() {
        throw new Error("not used");
      },
    },
    searchHealthLog: {
      async appendOperatorTriggeredDispatch(record) {
        records.push(record);
      },
    },
  });

  const result = await service.startSearch({
    mode: "managed_instance",
    instanceId: "a",
    query: "alpha",
  });

  assert.equal(result.source, "operator_triggered_search");
  assert.equal(result.searchId, "manual-search-1");
  assert.deepEqual(result.target, { kind: "managed_instance", instanceId: "a" });
  assert.equal(records.length, 1);
  assert.equal(records[0].instanceId, "a");
  assert.equal(records[0].query, "alpha");
  assert.equal(records[0].peerCount, 2);
});

test("OperatorSearchService records manual active-target dispatch", async () => {
  const records = [];
  const service = new OperatorSearchService({
    observerTargetResolver: {
      async resolve() {
        return {
          target: { kind: "external" },
          label: "external configured rust-mule client",
          client: makeClient({
            async startKeywordSearch({ query }) {
              return {
                search_id_hex: "manual-search-2",
                query,
              };
            },
          }),
        };
      },
    },
    searchHealthLog: {
      async appendOperatorTriggeredDispatch(record) {
        records.push(record);
      },
    },
  });

  const result = await service.startSearch({
    mode: "active_target",
    keywordIdHex: "feedface",
  });

  assert.equal(result.searchId, "manual-search-2");
  assert.deepEqual(result.target, { kind: "external" });
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].target, { kind: "external" });
  assert.equal(records[0].targetLabel, "external configured rust-mule client");
});

test("OperatorSearchService rejects ambiguous manual search input", async () => {
  const service = new OperatorSearchService({
    observerTargetResolver: {
      async resolve() {
        throw new Error("not used");
      },
    },
  });

  await assert.rejects(
    () =>
      service.startSearch({
        mode: "active_target",
        query: "alpha",
        keywordIdHex: "feedface",
      }),
    /either query or keywordIdHex, not both/,
  );
});
