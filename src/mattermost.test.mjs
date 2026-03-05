import test from "node:test";
import assert from "node:assert/strict";

import { MattermostClient } from "../dist/integrations/mattermost.js";

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

test("MattermostClient posts structured periodic report attachments", async () => {
  const calls = [];
  global.fetch = async (_url, init) => {
    calls.push(init);
    return makeOkResponse();
  };

  const client = new MattermostClient("https://example.test/hook", new StubAnalyzer());
  await client.postPeriodicReport({
    summary: "All clear",
    healthScore: 82,
    peerCount: 120,
    routingBucketCount: 16,
    lookupSuccessPct: 91.5,
    lookupTimeoutPct: 3.2,
  });

  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.attachments.length, 2);
  assert.equal(payload.attachments[0].title, "Node Metrics");
  assert.equal(payload.attachments[0].color, "#2ecc71");
  assert.ok(payload.attachments[0].text.includes("Health score: 82/100"));
  assert.equal(payload.attachments[1].title, "Observations");
  assert.equal(payload.attachments[1].text, "All clear");
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
