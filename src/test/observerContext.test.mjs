import test from "node:test";
import assert from "node:assert/strict";

import { Observer } from "../../dist/observer.js";
import { OperatorEventLog } from "../../dist/operatorConsole/operatorEventLog.js";
import { RuntimeStore } from "../../dist/storage/runtimeStore.js";
import { SearchHealthLog } from "../../dist/searchHealth/searchHealthLog.js";
import {
  CapturingAnalyzer,
  CountingMattermost,
  FailingTargetResolver,
  makeTempDir,
  NotReadyClient,
  StubAnalyzer,
  StubClient,
  StubLogWatcher,
  StubMattermost,
  StubTargetResolver,
} from "./observerTestHelpers.mjs";

test("Observer persists health score and includes it in cycle context", async () => {
  const tmp = await makeTempDir();

  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const observer = new Observer(new StubAnalyzer(), new StubMattermost(), {
      client: new StubClient(),
      logWatcher: new StubLogWatcher(),
      runtimeStore,
      intervalMs: 999999,
    });

    const context = await observer.collectAndPersistContext();

    assert.ok(context);
    assert.ok(context.networkHealth);
    assert.equal(typeof context.networkHealth.score, "number");

    const state = await runtimeStore.loadState();
    assert.equal(typeof state.lastHealthScore, "number");
    assert.equal(state.logOffset, 321);
    assert.deepEqual(state.lastObservedTarget, { kind: "external" });
    assert.equal(state.lastTargetFailureReason, undefined);
    assert.equal(state.currentCycleStartedAt, undefined);
    assert.equal(state.currentCycleTarget, undefined);

    const history = await runtimeStore.loadHistory();
    assert.equal(history.length, 1);
    assert.equal(typeof history[0].healthScore, "number");
    assert.equal(history[0].peerCount, 2);
    assert.deepEqual(history[0].target, { kind: "external" });
  } finally {
    await tmp.cleanup();
  }
});

test("Observer routes cycle analysis through the resolved managed target", async () => {
  const tmp = await makeTempDir();

  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const managedAnalyzer = new CapturingAnalyzer();
    const mattermost = new CountingMattermost();
    const observer = new Observer(new StubAnalyzer(), mattermost, {
      runtimeStore,
      eventLog: new OperatorEventLog(runtimeStore),
      targetResolver: new StubTargetResolver({
        target: { kind: "managed_instance", instanceId: "a" },
        label: "managed instance a",
        client: new StubClient(),
        logSource: { getRecentLines: () => ["managed log line"] },
      }),
      analyzerFactory: () => managedAnalyzer,
      intervalMs: 999999,
    });

    await observer.runCycle();

    assert.equal(managedAnalyzer.calls, 1);
    assert.ok(managedAnalyzer.prompts[0].includes("managed instance a"));
    assert.equal(mattermost.lastPeriodicReport.targetLabel, "managed instance a");

    const state = await runtimeStore.loadState();
    assert.deepEqual(state.lastObservedTarget, { kind: "managed_instance", instanceId: "a" });
    assert.equal(state.logOffset, undefined);
    assert.equal(state.lastTargetFailureReason, undefined);
    assert.equal(state.lastCycleOutcome, "success");
    assert.equal(typeof state.lastCycleDurationMs, "number");
    assert.equal(typeof state.lastCycleStartedAt, "string");
    assert.equal(typeof state.lastCycleCompletedAt, "string");

    const history = await runtimeStore.loadHistory();
    assert.equal(history.length, 1);
    assert.deepEqual(history[0].target, { kind: "managed_instance", instanceId: "a" });
    const events = await runtimeStore.loadEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "observer_cycle_started");
    assert.equal(events[1].type, "observer_cycle_completed");
    assert.equal(events[1].outcome, "success");
  } finally {
    await tmp.cleanup();
  }
});

test("Observer records observed search lifecycle for the active target", async () => {
  const tmp = await makeTempDir();

  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();
    const searchHealthLog = new SearchHealthLog(runtimeStore);

    class SearchClient extends StubClient {
      async getReadiness() {
        return {
          statusReady: true,
          searchesReady: true,
          ready: true,
          status: { ready: true },
          searches: {
            ready: true,
            searches: [
              {
                search_id_hex: "search-1",
                keyword_label: "observer-search",
                state: "running",
                hits: 0,
              },
            ],
          },
        };
      }
    }

    const observer = new Observer(new StubAnalyzer(), new StubMattermost(), {
      runtimeStore,
      searchHealthLog,
      targetResolver: new StubTargetResolver({
        target: { kind: "external" },
        label: "external configured rust-mule client",
        client: new SearchClient(),
        logSource: new StubLogWatcher(),
      }),
      intervalMs: 999999,
    });

    await observer.collectAndPersistContext();
    await observer.collectAndPersistContext();

    const records = await searchHealthLog.listRecent(10);
    assert.equal(records.length, 1);
    assert.equal(records[0].source, "observer_target_observation");
    assert.equal(records[0].observerContext.label, "external configured rust-mule client");
    assert.deepEqual(records[0].observerContext.target, { kind: "external" });
    assert.equal(records[0].outcome, "active");
  } finally {
    await tmp.cleanup();
  }
});

test("Observer deduplicates observed searches when search_id_hex is absent", async () => {
  const tmp = await makeTempDir();

  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();
    const searchHealthLog = new SearchHealthLog(runtimeStore);

    class SearchClient extends StubClient {
      async getReadiness() {
        return {
          statusReady: true,
          searchesReady: true,
          ready: true,
          status: { ready: true },
          searches: {
            ready: true,
            searches: [
              {
                keyword_id_hex: "keyword-1",
                keyword_label: "observer-search",
                state: "running",
                hits: 0,
              },
            ],
          },
        };
      }

      async getSearchDetail() {
        throw new Error("detail should not be fetched without search_id_hex");
      }
    }

    const observer = new Observer(new StubAnalyzer(), new StubMattermost(), {
      runtimeStore,
      searchHealthLog,
      targetResolver: new StubTargetResolver({
        target: { kind: "external" },
        label: "external configured rust-mule client",
        client: new SearchClient(),
        logSource: new StubLogWatcher(),
      }),
      intervalMs: 999999,
    });

    await observer.collectAndPersistContext();
    await observer.collectAndPersistContext();

    const records = await searchHealthLog.listRecent(10);
    assert.equal(records.length, 1);
    assert.equal(records[0].searchId, "keyword-1");
    assert.equal(records[0].source, "observer_target_observation");
  } finally {
    await tmp.cleanup();
  }
});

test("Observer reports unavailable active targets without stopping the loop", async () => {
  const tmp = await makeTempDir();

  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const mattermost = new CountingMattermost();
    const observer = new Observer(new StubAnalyzer(), mattermost, {
      runtimeStore,
      eventLog: new OperatorEventLog(runtimeStore),
      targetResolver: new FailingTargetResolver(),
      intervalMs: 999999,
    });

    await observer.runCycle();

    assert.equal(mattermost.periodicCalls, 1);
    assert.match(mattermost.lastPeriodicReport.summary, /Active diagnostic target unavailable/);
    assert.equal(mattermost.lastPeriodicReport.targetLabel, "managed instance missing");
    assert.equal(mattermost.lastPeriodicReport.healthScore, 0);

    const state = await runtimeStore.loadState();
    assert.equal(state.lastHealthScore, 0);
    assert.deepEqual(state.lastObservedTarget, {
      kind: "managed_instance",
      instanceId: "missing",
    });
    assert.equal(typeof state.lastRun, "string");
    assert.match(state.lastTargetFailureReason, /Managed instance missing is stopped/);
    assert.equal(state.currentCycleStartedAt, undefined);
    assert.equal(state.currentCycleTarget, undefined);
    assert.equal(state.lastCycleOutcome, "unavailable");
    assert.equal(typeof state.lastCycleDurationMs, "number");

    const history = await runtimeStore.loadHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].healthScore, 0);
    assert.deepEqual(history[0].target, {
      kind: "managed_instance",
      instanceId: "missing",
    });
    const events = await runtimeStore.loadEvents();
    assert.equal(events.length, 2);
    assert.equal(events[1].outcome, "unavailable");
  } finally {
    await tmp.cleanup();
  }
});

test("Observer reports reachable but not-ready targets as unavailable", async () => {
  const tmp = await makeTempDir();

  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const mattermost = new CountingMattermost();
    const observer = new Observer(new StubAnalyzer(), mattermost, {
      runtimeStore,
      eventLog: new OperatorEventLog(runtimeStore),
      targetResolver: new StubTargetResolver({
        target: { kind: "external" },
        label: "external configured rust-mule client",
        client: new NotReadyClient(),
        logSource: new StubLogWatcher(),
      }),
      intervalMs: 999999,
    });

    await observer.runCycle();

    assert.equal(mattermost.periodicCalls, 1);
    assert.match(mattermost.lastPeriodicReport.summary, /Active diagnostic target unavailable/);
    assert.match(mattermost.lastPeriodicReport.summary, /\/api\/v1\/searches\.ready=false/);

    const state = await runtimeStore.loadState();
    assert.equal(state.lastHealthScore, 0);
    assert.equal(state.lastCycleOutcome, "unavailable");
    assert.match(state.lastTargetFailureReason, /rust-mule target not ready/);
    assert.match(state.lastTargetFailureReason, /\/api\/v1\/searches\.ready=false/);

    const history = await runtimeStore.loadHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].healthScore, 0);
  } finally {
    await tmp.cleanup();
  }
});

test("Observer records scheduler error outcomes for failed cycles", async () => {
  const tmp = await makeTempDir();

  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const observer = new Observer(
      {
        async analyze() {
          throw new Error("analysis failed: api_key=secret");
        },
        async consumeDailyUsageReport() {
          return null;
        },
      },
      new CountingMattermost(),
      {
        client: new StubClient(),
        logWatcher: new StubLogWatcher(),
        runtimeStore,
        eventLog: new OperatorEventLog(runtimeStore),
        intervalMs: 999999,
      },
    );

    await observer.runCycle();

    const state = await runtimeStore.loadState();
    assert.equal(state.lastCycleOutcome, "error");
    assert.equal(typeof state.lastRun, "string");
    assert.equal(state.currentCycleStartedAt, undefined);
    assert.equal(state.currentCycleTarget, undefined);
    assert.match(state.lastTargetFailureReason, /\[redacted\]/);
    const events = await runtimeStore.loadEvents();
    assert.equal(events.length, 2);
    assert.equal(events[1].outcome, "error");
  } finally {
    await tmp.cleanup();
  }
});
