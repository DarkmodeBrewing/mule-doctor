import test from "node:test";
import assert from "node:assert/strict";

import { getNetworkHealth } from "../../dist/health/healthScore.js";

test("getNetworkHealth returns high score for healthy network signals", () => {
  const result = getNetworkHealth({
    peerCount: 150,
    routingBuckets: [
      { index: 0, count: 8, size: 8 },
      { index: 1, count: 9, size: 9 },
      { index: 2, count: 8, size: 8 },
      { index: 3, count: 10, size: 10 },
      { index: 4, count: 9, size: 9 },
      { index: 5, count: 8, size: 8 },
      { index: 6, count: 9, size: 9 },
      { index: 7, count: 8, size: 8 },
    ],
    lookupStats: {
      matchPerSent: 0.9,
      timeoutsPerSent: 0.03,
      total: 100,
      outboundShaperDelayedTotal: 1,
    },
    avgHops: 6,
  });

  assert.ok(result.score >= 85, `expected high health score, got ${result.score}`);
  assert.ok(result.components.lookup_success >= 85);
  assert.ok(result.components.error_rate >= 85);
});

test("getNetworkHealth returns low score for degraded network signals", () => {
  const result = getNetworkHealth({
    peerCount: 8,
    routingBuckets: [
      { index: 0, count: 40, size: 40 },
      { index: 1, count: 0, size: 0 },
      { index: 2, count: 0, size: 0 },
      { index: 3, count: 0, size: 0 },
      { index: 4, count: 0, size: 0 },
      { index: 5, count: 0, size: 0 },
      { index: 6, count: 0, size: 0 },
      { index: 7, count: 0, size: 0 },
    ],
    lookupStats: {
      matchPerSent: 0.2,
      timeoutsPerSent: 0.55,
      total: 100,
      outboundShaperDelayedTotal: 10,
    },
    avgHops: 18,
  });

  assert.ok(result.score <= 40, `expected degraded score, got ${result.score}`);
  assert.ok(result.components.lookup_success <= 30);
  assert.ok(result.components.bucket_balance <= 30);
});

test("getNetworkHealth handles missing data deterministically", () => {
  const result = getNetworkHealth({
    peerCount: 0,
    routingBuckets: [],
    lookupStats: {},
  });

  assert.deepEqual(result, {
    score: 8,
    components: {
      peer_count: 0,
      bucket_balance: 0,
      lookup_success: 0,
      lookup_efficiency: 50,
      error_rate: 0,
    },
  });
});

test("getNetworkHealth falls back to successful/total when matchPerSent is synthetic", () => {
  const result = getNetworkHealth({
    peerCount: 64,
    routingBuckets: [
      { index: 0, count: 6, size: 6 },
      { index: 1, count: 6, size: 6 },
      { index: 2, count: 6, size: 6 },
      { index: 3, count: 6, size: 6 },
    ],
    lookupStats: {
      total: 100,
      successful: 80,
      matchPerSent: 0,
      timeoutsPerSent: 0.1,
    },
    avgHops: 7,
  });

  assert.equal(result.components.lookup_success, 80);
});

test("getNetworkHealth handles zero-traffic lookup payload without inflating score", () => {
  const result = getNetworkHealth({
    peerCount: 0,
    routingBuckets: [],
    lookupStats: {
      total: 0,
      successful: 0,
      failed: 0,
      matchPerSent: 0,
      timeoutsPerSent: 0,
      outboundShaperDelayedTotal: 0,
    },
  });

  assert.deepEqual(result, {
    score: 8,
    components: {
      peer_count: 0,
      bucket_balance: 0,
      lookup_success: 0,
      lookup_efficiency: 50,
      error_rate: 0,
    },
  });
});
