import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OperatorConsoleServer } from "../../dist/operatorConsole/server.js";

import {
  StubDiscoverabilityResultsStore,
  StubManagedInstanceAnalysis,
  StubManagedInstanceDiagnostics,
  StubManagedInstanceDiscoverability,
  StubManagedInstanceSharing,
  StubOperatorEvents,
  StubOperatorSearches,
  StubSearchHealthResultsStore,
  loginAndGetCookie,
  makeTempDir,
} from "./operatorConsoleTestHelpers.mjs";

test("OperatorConsoleServer reports 501 for instance detail routes when control is unavailable", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstanceDiagnostics: new StubManagedInstanceDiagnostics(),
      managedInstanceAnalysis: new StubManagedInstanceAnalysis(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const detailRes = await fetch(`${server.publicAddress()}/api/instances/a`, {
      headers: { Cookie: cookie },
    });
    assert.equal(detailRes.status, 501);

    const logsRes = await fetch(`${server.publicAddress()}/api/instances/a/logs`, {
      headers: { Cookie: cookie },
    });
    assert.equal(logsRes.status, 501);

    const diagnosticsRes = await fetch(`${server.publicAddress()}/api/instances/a/diagnostics`, {
      headers: { Cookie: cookie },
    });
    assert.equal(diagnosticsRes.status, 200);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer exposes managed shared-content status and actions", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const shared = new StubManagedInstanceSharing();

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstanceSharing: shared,
      operatorEvents: new StubOperatorEvents(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());

    const getRes = await fetch(`${server.publicAddress()}/api/instances/a/shared`, {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes.status, 200);
    const overview = await getRes.json();
    assert.equal(overview.shared.instanceId, "a");
    assert.equal(overview.shared.files[0].identity.file_name, "fixture.txt");

    const fixtureRes = await fetch(`${server.publicAddress()}/api/instances/a/shared/fixtures`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: server.publicAddress(),
      },
      body: JSON.stringify({ fixtureId: "search-probe" }),
    });
    assert.equal(fixtureRes.status, 201);
    const fixture = await fixtureRes.json();
    assert.equal(fixture.fixture.fixtureId, "search-probe");

    const republishRes = await fetch(
      `${server.publicAddress()}/api/instances/a/shared/republish_keywords`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: server.publicAddress(),
        },
      },
    );
    assert.equal(republishRes.status, 200);
    const republish = await republishRes.json();
    assert.equal(republish.shared.instanceId, "a");
    assert.deepEqual(shared.calls, [
      ["getOverview", "a"],
      ["ensureFixture", "a", "search-probe"],
      ["republishKeywords", "a"],
      ["getOverview", "a"],
    ]);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer rejects malformed instance ids and unexpected shared sub-routes", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstanceSharing: new StubManagedInstanceSharing(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());

    const malformedRes = await fetch(`${server.publicAddress()}/api/instances/%E0%A4%A/shared`, {
      headers: { Cookie: cookie },
    });
    assert.equal(malformedRes.status, 400);

    const nestedRes = await fetch(
      `${server.publicAddress()}/api/instances/a/shared/fixtures/extra`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: server.publicAddress(),
        },
      },
    );
    assert.equal(nestedRes.status, 404);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer runs controlled discoverability checks", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const discoverability = new StubManagedInstanceDiscoverability();
    const resultsStore = new StubDiscoverabilityResultsStore();
    const searchHealthStore = new StubSearchHealthResultsStore();

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstanceDiscoverability: discoverability,
      operatorEvents: new StubOperatorEvents(),
      discoverabilityResults: resultsStore,
      searchHealthResults: searchHealthStore,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/discoverability/check`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.publicAddress(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        publisherInstanceId: "a",
        searcherInstanceId: "b",
        fixtureId: "probe",
        timeoutMs: 5000,
        pollIntervalMs: 250,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.outcome, "found");
    assert.equal(body.result.fixture.fixtureId, "probe");
    assert.deepEqual(discoverability.calls, [
      {
        publisherInstanceId: "a",
        searcherInstanceId: "b",
        fixtureId: "probe",
        timeoutMs: 5000,
        pollIntervalMs: 250,
      },
    ]);
    assert.equal(resultsStore.records.length, 1);
    assert.equal(resultsStore.records[0].result.outcome, "found");
    assert.equal(searchHealthStore.records.length, 1);
    assert.equal(searchHealthStore.records[0].source, "controlled_discoverability");

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer launches manual keyword searches", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const operatorSearches = new StubOperatorSearches();

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      operatorSearches,
      operatorEvents: new StubOperatorEvents(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/searches/launch`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.publicAddress(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "managed_instance",
        instanceId: "a",
        query: "alpha",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.source, "operator_triggered_search");
    assert.equal(body.result.searchId, "manual-search-1");
    assert.deepEqual(body.result.target, { kind: "managed_instance", instanceId: "a" });
    assert.deepEqual(operatorSearches.calls, [
      {
        mode: "managed_instance",
        instanceId: "a",
        query: "alpha",
        keywordIdHex: undefined,
      },
    ]);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});
