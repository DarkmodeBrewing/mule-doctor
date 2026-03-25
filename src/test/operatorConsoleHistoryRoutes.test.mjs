import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OperatorConsoleServer } from "../../dist/operatorConsole/server.js";

import {
  StubDiscoverabilityResultsStore,
  StubLlmInvocationResults,
  StubSearchHealthResultsStore,
  loginAndGetCookie,
  makeTempDir,
} from "./operatorConsoleTestHelpers.mjs";

test("OperatorConsoleServer returns persisted discoverability results", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const resultsStore = new StubDiscoverabilityResultsStore();
    await resultsStore.append({
      publisherInstanceId: "a",
      searcherInstanceId: "b",
      fixture: {
        fixtureId: "probe",
        token: "probe",
        fileName: "probe.txt",
        relativePath: "probe.txt",
        absolutePath: "/tmp/probe.txt",
        sizeBytes: 10,
      },
      query: "probe",
      dispatchedAt: "2026-03-12T10:00:00.000Z",
      searchId: "search-1",
      readinessAtDispatch: {
        publisherStatusReady: true,
        publisherSearchesReady: true,
        publisherReady: true,
        searcherStatusReady: true,
        searcherSearchesReady: true,
        searcherReady: true,
      },
      peerCountAtDispatch: { publisher: 1, searcher: 1 },
      states: [],
      resultCount: 1,
      outcome: "found",
      finalState: "running",
    });

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      discoverabilityResults: resultsStore,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/discoverability/results?limit=5`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].result.searchId, "search-1");
    assert.equal("token" in body.results[0].result.fixture, false);
    assert.equal("absolutePath" in body.results[0].result.fixture, false);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer returns discoverability summary", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const resultsStore = new StubDiscoverabilityResultsStore();
    await resultsStore.append({
      publisherInstanceId: "a",
      searcherInstanceId: "b",
      fixture: {
        fixtureId: "probe",
        token: "probe",
        fileName: "probe.txt",
        relativePath: "probe.txt",
        absolutePath: "/tmp/probe.txt",
        sizeBytes: 10,
      },
      query: "probe",
      dispatchedAt: "2026-03-12T10:00:00.000Z",
      searchId: "search-1",
      readinessAtDispatch: {
        publisherStatusReady: true,
        publisherSearchesReady: true,
        publisherReady: true,
        searcherStatusReady: true,
        searcherSearchesReady: true,
        searcherReady: true,
      },
      peerCountAtDispatch: { publisher: 1, searcher: 1 },
      states: [],
      resultCount: 1,
      outcome: "found",
      finalState: "running",
    });

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      discoverabilityResults: resultsStore,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/discoverability/summary?limit=5`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.summary.totalChecks, 1);
    assert.equal(body.summary.foundCount, 1);
    assert.equal(body.summary.latestPair.publisherInstanceId, "a");

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer returns persisted search health results", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const searchHealthStore = new StubSearchHealthResultsStore();
    await searchHealthStore.appendControlledDiscoverability({
      publisherInstanceId: "a",
      searcherInstanceId: "b",
      fixture: {
        fixtureId: "probe",
        token: "probe",
        fileName: "probe.txt",
        relativePath: "probe.txt",
        absolutePath: "/tmp/probe.txt",
        sizeBytes: 10,
      },
      query: "probe",
      dispatchedAt: "2026-03-12T10:00:00.000Z",
      searchId: "search-1",
      readinessAtDispatch: {
        publisherStatusReady: true,
        publisherSearchesReady: true,
        publisherReady: true,
        searcherStatusReady: true,
        searcherSearchesReady: true,
        searcherReady: true,
      },
      peerCountAtDispatch: { publisher: 1, searcher: 1 },
      publisherSharedBefore: { actions: [], downloads: [] },
      publisherSharedAfter: { actions: [], downloads: [] },
      states: [],
      resultCount: 1,
      outcome: "found",
      finalState: "running",
    });

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      searchHealthResults: searchHealthStore,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/search-health/results?limit=5`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].searchId, "search-1");
    assert.equal(body.results[0].controlledContext.fixture.fileName, "probe.txt");

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer returns search health summary", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const searchHealthStore = new StubSearchHealthResultsStore();
    await searchHealthStore.appendControlledDiscoverability({
      publisherInstanceId: "a",
      searcherInstanceId: "b",
      fixture: {
        fixtureId: "probe",
        token: "probe",
        fileName: "probe.txt",
        relativePath: "probe.txt",
        absolutePath: "/tmp/probe.txt",
        sizeBytes: 10,
      },
      query: "probe",
      dispatchedAt: "2026-03-12T10:00:00.000Z",
      searchId: "search-1",
      readinessAtDispatch: {
        publisherStatusReady: true,
        publisherSearchesReady: true,
        publisherReady: true,
        searcherStatusReady: true,
        searcherSearchesReady: true,
        searcherReady: true,
      },
      peerCountAtDispatch: { publisher: 1, searcher: 1 },
      publisherSharedBefore: { actions: [], downloads: [] },
      publisherSharedAfter: { actions: [], downloads: [] },
      states: [],
      resultCount: 1,
      outcome: "found",
      finalState: "running",
    });

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      searchHealthResults: searchHealthStore,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/search-health/summary?limit=5`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.summary.totalSearches, 1);
    assert.equal(body.summary.foundCount, 1);
    assert.equal(body.summary.latestPair.publisherInstanceId, "a");

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer returns LLM invocation audit results", async () => {
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
      llmInvocationResults: new StubLlmInvocationResults(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/llm/invocations?limit=5`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].surface, "mattermost_command");
    assert.equal(body.results[1].finishReason, "rate_limited");

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer returns LLM invocation audit summary", async () => {
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
      llmInvocationResults: new StubLlmInvocationResults(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/llm/invocations/summary?limit=5`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.summary.totalInvocations, 2);
    assert.equal(body.summary.rateLimitedCount, 1);
    assert.equal(body.summary.latestSurface, "observer_cycle");

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});
