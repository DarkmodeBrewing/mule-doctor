import test from "node:test";
import assert from "node:assert/strict";

import { MattermostClient } from "../../dist/integrations/mattermost.js";

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

function makeOkResponse() {
  return {
    ok: true,
    status: 200,
    async text() {
      return "ok";
    },
  };
}

class StubAnalyzer {
  async analyze() {
    return "ok";
  }

  async consumeDailyUsageReport() {
    return null;
  }
}

class StubDiscoverabilityResults {
  async summarizeRecent(limit = 3) {
    return {
      windowSize: limit,
      totalChecks: limit,
      foundCount: 1,
      completedEmptyCount: limit - 1,
      timedOutCount: 0,
      successRatePct: (1 / limit) * 100,
      latestRecordedAt: "2026-03-12T10:00:00.000Z",
      latestOutcome: "found",
      latestQuery: "fixture-1",
      latestPair: {
        publisherInstanceId: "publisher-1",
        searcherInstanceId: "searcher-1",
      },
      lastSuccessAt: "2026-03-12T10:00:00.000Z",
    };
  }
}

class StubSearchHealthResults {
  async summarizeRecent(limit = 5) {
    return {
      windowSize: limit,
      totalSearches: limit,
      foundCount: 2,
      completedEmptyCount: limit - 2,
      timedOutCount: 0,
      dispatchReadyCount: limit - 1,
      dispatchNotReadyCount: 1,
      degradedTransportCount: 1,
      successRatePct: (2 / limit) * 100,
      latestRecordedAt: "2026-03-12T11:00:00.000Z",
      latestOutcome: "found",
      latestQuery: "fixture-2",
      latestSource: "controlled_discoverability",
      latestPair: {
        publisherInstanceId: "publisher-2",
        searcherInstanceId: "searcher-2",
      },
      lastSuccessAt: "2026-03-12T11:00:00.000Z",
    };
  }
}

class ThrowingDiscoverabilityResults {
  async summarizeRecent() {
    throw new Error("discoverability store unavailable");
  }
}

class ThrowingSearchHealthResults {
  async summarizeRecent() {
    throw new Error("search health unavailable");
  }
}

test("MattermostClient posts structured periodic report attachments", async () => {
  const calls = [];
  global.fetch = async (_url, init) => {
    calls.push(init);
    return makeOkResponse();
  };

  const client = new MattermostClient(
    "https://example.test/hook",
    new StubAnalyzer(),
    {
      discoverabilityResults: new StubDiscoverabilityResults(),
      searchHealthResults: new StubSearchHealthResults(),
    },
  );
  await client.postPeriodicReport({
    summary: "All clear",
    targetLabel: "managed instance a",
    healthScore: 82,
    peerCount: 120,
    routingBucketCount: 16,
    lookupSuccessPct: 91.5,
    lookupTimeoutPct: 3.2,
  });

  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body);
  assert.match(payload.text, /Target: managed instance a/);
  assert.equal(payload.attachments.length, 4);
  assert.equal(payload.attachments[0].title, "Node Metrics");
  assert.equal(payload.attachments[0].color, "#2ecc71");
  assert.ok(payload.attachments[0].text.includes("Health score: 82/100"));
  assert.equal(payload.attachments[1].title, "Observations");
  assert.equal(payload.attachments[1].text, "All clear");
  assert.equal(payload.attachments[2].title, "Discoverability Summary");
  assert.ok(payload.attachments[2].text.includes("Window: 3 recent checks"));
  assert.ok(payload.attachments[2].text.includes("Found: 1"));
  assert.ok(payload.attachments[2].text.includes("Latest path: publisher-1 -> searcher-1"));
  assert.ok(payload.attachments[2].text.includes("Latest query: fixture-1"));
  assert.equal(payload.attachments[3].title, "Search Health Summary");
  assert.ok(payload.attachments[3].text.includes("Window: 5 recent searches"));
  assert.ok(payload.attachments[3].text.includes("Dispatch-ready: 4"));
  assert.ok(payload.attachments[3].text.includes("Degraded transport: 1"));
  assert.ok(payload.attachments[3].text.includes("Latest path: publisher-2 -> searcher-2"));
});

test("MattermostClient posts daily usage report attachments", async () => {
  const calls = [];
  global.fetch = async (_url, init) => {
    calls.push(init);
    return makeOkResponse();
  };

  const client = new MattermostClient("https://example.test/hook", new StubAnalyzer());
  await client.postDailyUsageReport({
    dateKey: "2026-03-05",
    monthKey: "2026-03",
    today: { calls: 3, tokensIn: 100, tokensOut: 50, estimatedCost: 0.012345 },
    month: { calls: 9, tokensIn: 900, tokensOut: 450, estimatedCost: 0.123456 },
  });

  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.attachments.length, 2);
  assert.equal(payload.attachments[0].title, "Today's usage");
  assert.ok(payload.attachments[0].text.includes("Calls: 3"));
  assert.ok(payload.attachments[0].text.includes("Estimated cost: $0.012345"));
  assert.equal(payload.attachments[1].title, "Monthly usage");
  assert.ok(payload.attachments[1].text.includes("Period: 2026-03"));
});

test("MattermostClient still posts periodic report when discoverability summary fails", async () => {
  const calls = [];
  global.fetch = async (_url, init) => {
    calls.push(init);
    return makeOkResponse();
  };

  const client = new MattermostClient(
    "https://example.test/hook",
    new StubAnalyzer(),
    {
      discoverabilityResults: new ThrowingDiscoverabilityResults(),
      searchHealthResults: new ThrowingSearchHealthResults(),
    },
  );
  await client.postPeriodicReport({
    summary: "All clear",
    targetLabel: "managed instance a",
    healthScore: 82,
  });

  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.attachments.length, 2);
  assert.equal(payload.attachments[0].title, "Node Metrics");
  assert.equal(payload.attachments[1].title, "Observations");
});

test("MattermostClient posts patch proposal metadata and diff content", async () => {
  const calls = [];
  global.fetch = async (_url, init) => {
    calls.push(init);
    return makeOkResponse();
  };

  const client = new MattermostClient("https://example.test/hook", new StubAnalyzer());
  await client.postPatchProposal({
    artifactPath: ".mule-doctor/proposals/proposal-2026-03-05.patch",
    diff: "diff --git a/src/lib.rs b/src/lib.rs\n@@\n-pub fn old() {}\n+pub fn new() {}\n",
    bytes: 78,
    lines: 4,
  });

  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.text, "rust-mule patch proposal available");
  assert.equal(payload.attachments.length, 2);
  assert.equal(payload.attachments[0].title, "Patch Proposal Metadata");
  assert.ok(
    payload.attachments[0].text.includes(
      "Artifact: .mule-doctor/proposals/proposal-2026-03-05.patch",
    ),
  );
  assert.ok(payload.attachments[0].text.includes("Content truncated: no"));
  assert.equal(payload.attachments[1].title, "Patch Content");
  assert.ok(payload.attachments[1].text.includes("```diff"));
  assert.ok(payload.attachments[1].text.includes("+pub fn new() {}"));
});

test("MattermostClient fails with timeout when webhook does not respond", async () => {
  global.fetch = async (_url, init = {}) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const client = new MattermostClient("https://example.test/hook", new StubAnalyzer(), 200);
  await assert.rejects(() => client.post("hello"), /Mattermost webhook timed out after 200ms/);
});
