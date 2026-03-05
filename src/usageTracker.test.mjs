import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../dist/storage/runtimeStore.js";
import { UsageTracker } from "../dist/llm/usageTracker.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-usage-"));
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

test("UsageTracker records logs and aggregates daily/monthly totals", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir });
    await store.initialize();

    const tracker = new UsageTracker({
      runtimeStore: store,
      dataDir: tmp.dir,
      inputCostPer1k: 0.002,
      outputCostPer1k: 0.004,
    });

    await tracker.record({
      timestamp: "2026-03-05T10:00:00.000Z",
      model: "gpt-5-mini",
      tokensIn: 1000,
      tokensOut: 500,
    });

    const summary = await tracker.getSummary(new Date("2026-03-05T12:00:00.000Z"));
    assert.equal(summary.today.calls, 1);
    assert.equal(summary.today.tokensIn, 1000);
    assert.equal(summary.today.tokensOut, 500);
    assert.equal(summary.today.estimatedCost, 0.004);

    const files = await readdir(tmp.dir);
    assert.ok(files.some((name) => name.startsWith("LLM_")));

    const state = await store.loadState();
    assert.equal(state.usage.daily["2026-03-05"].calls, 1);
    assert.equal(state.usage.monthly["2026-03"].calls, 1);
  } finally {
    await tmp.cleanup();
  }
});

test("UsageTracker consumeDailyReport emits once per day", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir });
    await store.initialize();

    const tracker = new UsageTracker({ runtimeStore: store, dataDir: tmp.dir });
    await tracker.record({
      timestamp: "2026-03-05T01:00:00.000Z",
      model: "gpt-5-mini",
      tokensIn: 10,
      tokensOut: 20,
    });

    const first = await tracker.consumeDailyReport(new Date("2026-03-05T08:00:00.000Z"));
    const second = await tracker.consumeDailyReport(new Date("2026-03-05T09:00:00.000Z"));

    assert.ok(first);
    assert.equal(first.dateKey, "2026-03-05");
    assert.equal(first.today.calls, 1);
    assert.equal(second, null);
  } finally {
    await tmp.cleanup();
  }
});

test("UsageTracker consumeDailyReport includes queued records before reporting", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir });
    await store.initialize();

    const tracker = new UsageTracker({ runtimeStore: store, dataDir: tmp.dir });

    const originalWriteRecordLog = tracker.writeRecordLog.bind(tracker);
    let writeCount = 0;
    tracker.writeRecordLog = async (record) => {
      writeCount += 1;
      if (writeCount === 2) {
        await sleep(50);
      }
      await originalWriteRecordLog(record);
    };

    await tracker.record({
      timestamp: "2026-03-05T01:00:00.000Z",
      model: "gpt-5-mini",
      tokensIn: 10,
      tokensOut: 20,
    });

    const queuedRecord = tracker.record({
      timestamp: "2026-03-05T01:05:00.000Z",
      model: "gpt-5-mini",
      tokensIn: 30,
      tokensOut: 40,
    });

    await sleep(5);

    const report = await tracker.consumeDailyReport(new Date("2026-03-05T08:00:00.000Z"));
    await queuedRecord;

    assert.ok(report);
    assert.equal(report.dateKey, "2026-03-05");
    assert.equal(report.today.calls, 2);
    assert.equal(report.today.tokensIn, 40);
    assert.equal(report.today.tokensOut, 60);
  } finally {
    await tmp.cleanup();
  }
});
