import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Observer } from "../../dist/observer.js";
import { OperatorEventLog } from "../../dist/operatorConsole/operatorEventLog.js";
import { RuntimeStore } from "../../dist/storage/runtimeStore.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-observer-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class StubAnalyzer {
  async analyze() {
    return "ok";
  }

  async consumeDailyUsageReport() {
    return null;
  }
}

class StubMattermost {
  async post() {
    return;
  }
}

class StubClient {
  async getReadiness() {
    return {
      statusReady: true,
      searchesReady: true,
      ready: true,
      status: { ready: true },
      searches: { ready: true, searches: [] },
    };
  }

  async getNodeInfo() {
    return { nodeId: "n1", version: "v1", uptime: 123 };
  }

  async getPeers() {
    return [
      { id: "p1", address: "a" },
      { id: "p2", address: "b" },
    ];
  }

  async getRoutingBuckets() {
    return [
      { index: 0, count: 4, size: 4 },
      { index: 1, count: 4, size: 4 },
      { index: 2, count: 5, size: 5 },
    ];
  }

  async getLookupStats() {
    return {
      total: 10,
      successful: 9,
      failed: 1,
      matchPerSent: 0.9,
      timeoutsPerSent: 0.1,
      outboundShaperDelayedTotal: 0,
      avgHops: 6,
    };
  }
}

class StubLogWatcher {
  getOffset() {
    return 321;
  }

  getRecentLines() {
    return ["external log line"];
  }
}

class SlowAnalyzer {
  constructor(delayMs = 35) {
    this.delayMs = delayMs;
    this.calls = 0;
  }

  async analyze() {
    this.calls += 1;
    await sleep(this.delayMs);
    return "ok";
  }

  async consumeDailyUsageReport() {
    return null;
  }
}

class CountingMattermost {
  constructor() {
    this.periodicCalls = 0;
    this.lastPeriodicReport = null;
  }

  async postPeriodicReport(report) {
    this.periodicCalls += 1;
    this.lastPeriodicReport = report;
  }

  async postDailyUsageReport() {
    return;
  }
}

class StubTargetResolver {
  constructor(target) {
    this.target = target;
  }

  async describeActiveTarget() {
    return {
      target: this.target.target,
      label: this.target.label,
    };
  }

  async resolve() {
    return this.target;
  }
}

class FailingTargetResolver {
  async describeActiveTarget() {
    return {
      target: { kind: "managed_instance", instanceId: "missing" },
      label: "managed instance missing",
    };
  }

  async resolve() {
    throw new Error("Managed instance missing is stopped");
  }
}

class NotReadyClient extends StubClient {
  async getReadiness() {
    return {
      statusReady: true,
      searchesReady: false,
      ready: false,
      status: { ready: true },
      searches: { ready: false, searches: [] },
    };
  }
}

class CapturingAnalyzer {
  constructor() {
    this.calls = 0;
    this.prompts = [];
  }

  async analyze(prompt) {
    this.calls += 1;
    this.prompts.push(prompt);
    return "managed ok";
  }

  async consumeDailyUsageReport() {
    return null;
  }
}

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

test("Observer start uses non-overlapping scheduling for long cycles", async () => {
  const analyzer = new SlowAnalyzer(35);
  const mattermost = new CountingMattermost();
  const observer = new Observer(analyzer, mattermost, { intervalMs: 10 });

  observer.start();
  await sleep(65);
  observer.stop();
  await sleep(50);

  assert.equal(analyzer.calls >= 1, true);
  assert.equal(analyzer.calls <= 2, true);
  assert.equal(mattermost.periodicCalls, analyzer.calls);
});

test("Observer ignores duplicate start calls", async () => {
  const analyzer = new SlowAnalyzer(40);
  const mattermost = new CountingMattermost();
  const observer = new Observer(analyzer, mattermost, { intervalMs: 10 });

  observer.start();
  observer.start();
  await sleep(20);
  observer.stop();
  await sleep(60);

  assert.equal(analyzer.calls, 1);
  assert.equal(mattermost.periodicCalls, 1);
});

test("Observer stop then start waits for in-flight cycle before next cycle", async () => {
  const analyzer = new SlowAnalyzer(60);
  const mattermost = new CountingMattermost();
  const observer = new Observer(analyzer, mattermost, { intervalMs: 1000 });

  observer.start();
  await sleep(15);
  observer.stop();
  observer.start();

  await sleep(20);
  assert.equal(analyzer.calls, 1);

  await sleep(90);
  observer.stop();
  await sleep(20);

  assert.equal(analyzer.calls, 2);
  assert.equal(mattermost.periodicCalls, 2);
});

test("Observer triggerRunNow accepts when idle and rejects when unavailable", async () => {
  const analyzer = new SlowAnalyzer(10);
  const mattermost = new CountingMattermost();
  const observer = new Observer(analyzer, mattermost, { intervalMs: 1000 });

  assert.equal(observer.triggerRunNow().accepted, false);

  observer.start();
  await sleep(30);
  assert.equal(analyzer.calls, 1);

  const accepted = observer.triggerRunNow();
  assert.equal(accepted.accepted, true);
  await sleep(30);
  observer.stop();
  await sleep(20);

  assert.equal(analyzer.calls, 2);
  assert.equal(mattermost.periodicCalls, 2);
});

test("Observer triggerRunNow rejects while a cycle is already in progress", async () => {
  const observer = new Observer(new SlowAnalyzer(40), new CountingMattermost(), {
    intervalMs: 1000,
  });

  observer.start();
  await sleep(10);
  const result = observer.triggerRunNow();
  observer.stop();
  await sleep(50);

  assert.equal(result.accepted, false);
  assert.match(result.reason, /already in progress/);
});

test("Observer getStatus exposes current cycle target while a cycle is running", async () => {
  const tmp = await makeTempDir();

  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const slowAnalyzer = new SlowAnalyzer(60);
    const observer = new Observer(slowAnalyzer, new CountingMattermost(), {
      runtimeStore,
      targetResolver: new StubTargetResolver({
        target: { kind: "managed_instance", instanceId: "a" },
        label: "managed instance a",
        client: new StubClient(),
        logSource: { getRecentLines: () => ["managed log line"] },
      }),
      analyzerFactory: () => slowAnalyzer,
      intervalMs: 999999,
    });

    observer.start();
    await sleep(10);

    const statusWhileRunning = observer.getStatus();
    assert.equal(statusWhileRunning.started, true);
    assert.equal(statusWhileRunning.cycleInFlight, true);
    assert.deepEqual(statusWhileRunning.currentCycleTarget, {
      kind: "managed_instance",
      instanceId: "a",
    });
    assert.equal(typeof statusWhileRunning.currentCycleStartedAt, "string");

    observer.stop();
    await sleep(80);

    const statusAfterRun = observer.getStatus();
    assert.equal(statusAfterRun.cycleInFlight, false);
    assert.equal(statusAfterRun.currentCycleStartedAt, undefined);
    assert.equal(statusAfterRun.currentCycleTarget, undefined);
  } finally {
    await tmp.cleanup();
  }
});
