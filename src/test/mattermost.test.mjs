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
  async listRecent(limit = 3) {
    return Array.from({ length: limit }, (_, i) => ({
      recordedAt: `2026-03-12T10:0${i}:00.000Z`,
      result: {
        publisherInstanceId: `publisher-${i + 1}`,
        searcherInstanceId: `searcher-${i + 1}`,
        fixture: {
          fixtureId: `fixture-${i + 1}`,
          fileName: `fixture-${i + 1}.txt`,
          relativePath: `fixture-${i + 1}.txt`,
          sizeBytes: 16,
        },
        query: `fixture-${i + 1}`,
        dispatchedAt: `2026-03-12T10:0${i}:00.000Z`,
        searchId: `search-${i + 1}`,
        readinessAtDispatch: { publisherReady: true, searcherReady: true },
        peerCountAtDispatch: { publisher: 1, searcher: 2 },
        states: [],
        resultCount: i + 1,
        outcome: i === 0 ? "found" : "completed_empty",
        finalState: "completed",
      },
    }));
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
    new StubDiscoverabilityResults(),
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
  assert.equal(payload.attachments.length, 3);
  assert.equal(payload.attachments[0].title, "Node Metrics");
  assert.equal(payload.attachments[0].color, "#2ecc71");
  assert.ok(payload.attachments[0].text.includes("Health score: 82/100"));
  assert.equal(payload.attachments[1].title, "Observations");
  assert.equal(payload.attachments[1].text, "All clear");
  assert.equal(payload.attachments[2].title, "Recent Discoverability");
  assert.ok(payload.attachments[2].text.includes("FOUND: publisher-1 -> searcher-1"));
  assert.ok(payload.attachments[2].text.includes("Query: fixture-1"));
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
