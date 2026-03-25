import test from "node:test";
import assert from "node:assert/strict";

import { Observer } from "../../dist/observer.js";
import { RuntimeStore } from "../../dist/storage/runtimeStore.js";
import {
  CountingMattermost,
  makeTempDir,
  sleep,
  SlowAnalyzer,
  StubClient,
  StubTargetResolver,
} from "./observerTestHelpers.mjs";

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
