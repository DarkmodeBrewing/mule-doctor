import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Observer } from "../dist/observer.js";
import { RuntimeStore } from "../dist/storage/runtimeStore.js";

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
}

class StubMattermost {
  async post() {
    return;
  }
}

class StubClient {
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
  }

  async postPeriodicReport() {
    this.periodicCalls += 1;
  }

  async postDailyUsageReport() {
    return;
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

    const history = await runtimeStore.loadHistory();
    assert.equal(history.length, 1);
    assert.equal(typeof history[0].healthScore, "number");
    assert.equal(history[0].peerCount, 2);
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
