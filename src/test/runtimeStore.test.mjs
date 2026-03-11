import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../../dist/storage/runtimeStore.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-store-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("RuntimeStore initializes state/history files when missing", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir });
    await store.initialize();

    const stateRaw = await readFile(join(tmp.dir, "state.json"), "utf8");
    const historyRaw = await readFile(join(tmp.dir, "history.json"), "utf8");
    const eventsRaw = await readFile(join(tmp.dir, "operator-events.json"), "utf8");

    assert.deepEqual(JSON.parse(stateRaw), {});
    assert.deepEqual(JSON.parse(historyRaw), []);
    assert.deepEqual(JSON.parse(eventsRaw), []);
  } finally {
    await tmp.cleanup();
  }
});

test("RuntimeStore persists and merges runtime state", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir });
    await store.initialize();

    await store.updateState({ lastRun: "2026-03-05T00:00:00.000Z", logOffset: 10 });
    await store.updateState({ lastAlert: "routing_imbalance" });

    const state = await store.loadState();

    assert.equal(state.lastRun, "2026-03-05T00:00:00.000Z");
    assert.equal(state.logOffset, 10);
    assert.equal(state.lastAlert, "routing_imbalance");
  } finally {
    await tmp.cleanup();
  }
});

test("RuntimeStore enforces history retention limit", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir, historyLimit: 3 });
    await store.initialize();

    for (let i = 1; i <= 5; i++) {
      await store.appendHistory({ timestamp: `t-${i}`, peerCount: i });
    }

    const history = await store.loadHistory();
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((entry) => entry.timestamp),
      ["t-3", "t-4", "t-5"],
    );
  } finally {
    await tmp.cleanup();
  }
});

test("RuntimeStore retains history across instances (restart behavior)", async () => {
  const tmp = await makeTempDir();

  try {
    const first = new RuntimeStore({ dataDir: tmp.dir });
    await first.initialize();
    await first.appendHistory({ timestamp: "t-1", peerCount: 1 });

    const second = new RuntimeStore({ dataDir: tmp.dir });
    await second.initialize();
    const history = await second.loadHistory();

    assert.equal(history.length, 1);
    assert.equal(history[0].timestamp, "t-1");
    assert.equal(history[0].peerCount, 1);
  } finally {
    await tmp.cleanup();
  }
});

test("RuntimeStore serializes concurrent history appends", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir, historyLimit: 100 });
    await store.initialize();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.appendHistory({ timestamp: `t-${i + 1}`, peerCount: i + 1 }),
      ),
    );

    const history = await store.loadHistory();
    assert.equal(history.length, 20);
    assert.deepEqual(
      history.map((entry) => entry.timestamp),
      Array.from({ length: 20 }, (_, i) => `t-${i + 1}`),
    );
  } finally {
    await tmp.cleanup();
  }
});

test("RuntimeStore serializes concurrent state updates", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir });
    await store.initialize();

    await Promise.all([
      store.updateState({ lastRun: "2026-03-05T01:00:00.000Z" }),
      store.updateState({ lastAlert: "timeout_spike" }),
    ]);

    const state = await store.loadState();
    assert.equal(state.lastRun, "2026-03-05T01:00:00.000Z");
    assert.equal(state.lastAlert, "timeout_spike");
  } finally {
    await tmp.cleanup();
  }
});

test("RuntimeStore enforces operator event retention limit", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir, eventsLimit: 3 });
    await store.initialize();

    for (let i = 1; i <= 5; i++) {
      await store.appendEvent({
        timestamp: `t-${i}`,
        type: "observer_cycle_started",
        message: `event-${i}`,
      });
    }

    const events = await store.loadEvents();
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((entry) => entry.timestamp),
      ["t-3", "t-4", "t-5"],
    );
  } finally {
    await tmp.cleanup();
  }
});

test("RuntimeStore serializes concurrent operator event appends", async () => {
  const tmp = await makeTempDir();

  try {
    const store = new RuntimeStore({ dataDir: tmp.dir, eventsLimit: 100 });
    await store.initialize();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.appendEvent({
          timestamp: `t-${i + 1}`,
          type: "observer_cycle_completed",
          message: `event-${i + 1}`,
        }),
      ),
    );

    const events = await store.loadEvents();
    assert.equal(events.length, 20);
    assert.deepEqual(
      events.map((entry) => entry.timestamp),
      Array.from({ length: 20 }, (_, i) => `t-${i + 1}`),
    );
  } finally {
    await tmp.cleanup();
  }
});
