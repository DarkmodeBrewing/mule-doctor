import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RustMuleClient } from "../dist/api/rustMuleClient.js";

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

async function writeTempFile(filename, content) {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-"));
  const filePath = join(dir, filename);
  await writeFile(filePath, content, "utf8");
  return {
    filePath,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("RustMuleClient uses /api/v1 status for node info", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return makeJsonResponse({
      uptime_secs: 123,
      node_id_hex: "abc123",
      version: "test-v1",
    });
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const info = await client.getNodeInfo();

  assert.equal(calls[0], "http://127.0.0.1:17835/api/v1/status");
  assert.equal(info.uptime, 123);
  assert.equal(info.nodeId, "abc123");
  assert.equal(info.version, "test-v1");
});

test("RustMuleClient maps peers from /kad/peers payload", async () => {
  global.fetch = async () =>
    makeJsonResponse({
      peers: [
        {
          kad_id_hex: "0011",
          udp_dest_short: "peer-short",
        },
      ],
    });

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const peers = await client.getPeers();
  assert.equal(peers.length, 1);
  assert.equal(peers[0].id, "0011");
  assert.equal(peers[0].address, "peer-short");
});

test("RustMuleClient returns [] when debug routing buckets endpoint is unavailable", async () => {
  global.fetch = async () => makeJsonResponse({ code: 404 }, 404);

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const buckets = await client.getRoutingBuckets();
  assert.deepEqual(buckets, []);
});

test("RustMuleClient sends X-Debug-Token on debug endpoints and tolerates 403", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");
  const calls = [];

  try {
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return makeJsonResponse({ code: 403 }, 403);
    };

    const client = new RustMuleClient(
      "http://127.0.0.1:17835",
      undefined,
      "/api/v1",
      debugToken.filePath,
    );
    await client.loadToken();

    const buckets = await client.getRoutingBuckets();

    assert.deepEqual(buckets, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:17835/api/v1/debug/routing/buckets");
    assert.equal(calls[0].init.headers["X-Debug-Token"], "debug-secret");
  } finally {
    await debugToken.cleanup();
  }
});

test("RustMuleClient derives lookup stats from /events totals and canonical ratios", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return makeJsonResponse({
      sent_reqs_total: 100,
      tracked_out_matched_total: 60,
      timeouts_total: 10,
      tracked_out_unmatched_total: 5,
      tracked_out_expired_total: 15,
      outbound_shaper_delayed_total: 7,
    });
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const stats = await client.getLookupStats();

  assert.equal(calls[0], "http://127.0.0.1:17835/api/v1/events");
  assert.equal(stats.total, 100);
  assert.equal(stats.successful, 60);
  assert.equal(stats.failed, 30);
  assert.equal(stats.matchPerSent, 0.6);
  assert.equal(stats.timeoutsPerSent, 0.1);
  assert.equal(stats.outboundShaperDelayedTotal, 7);
});

test("RustMuleClient preserves explicit zero matched count without recv fallback", async () => {
  global.fetch = async () =>
    makeJsonResponse({
      sent_reqs_total: 50,
      tracked_out_matched_total: 0,
      recv_ress_total: 9,
      timeouts_total: 5,
      tracked_out_unmatched_total: 0,
      tracked_out_expired_total: 0,
      outbound_shaper_delayed_total: 0,
    });

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const stats = await client.getLookupStats();

  assert.equal(stats.successful, 0);
  assert.equal(stats.matchPerSent, 0);
  assert.equal(stats.timeoutsPerSent, 0.1);
});

test("RustMuleClient triggerBootstrap posts debug restart and polls job endpoint", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");
  const calls = [];

  try {
    global.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      if (String(url).endsWith("/debug/bootstrap/restart")) {
        return makeJsonResponse({ job_id: "job-123" }, 202);
      }
      if (String(url).endsWith("/debug/bootstrap/jobs/job-123")) {
        return makeJsonResponse({ status: "completed", detail: "ok" });
      }
      throw new Error(`Unexpected URL in test: ${String(url)}`);
    };

    const client = new RustMuleClient(
      "http://127.0.0.1:17835",
      undefined,
      "/api/v1",
      debugToken.filePath,
    );
    await client.loadToken();

    const result = await client.triggerBootstrap({ pollIntervalMs: 1, maxWaitMs: 1000 });

    assert.equal(result.jobId, "job-123");
    assert.equal(result.status, "completed");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["X-Debug-Token"], "debug-secret");
    assert.equal(calls[1].init.headers["X-Debug-Token"], "debug-secret");
  } finally {
    await debugToken.cleanup();
  }
});

test("RustMuleClient traceLookup posts and returns normalized hops", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");

  try {
    global.fetch = async (url) => {
      if (String(url).endsWith("/debug/trace_lookup")) {
        return makeJsonResponse({ trace_id: "trace-42" }, 202);
      }
      if (String(url).endsWith("/debug/trace_lookup/trace-42")) {
        return makeJsonResponse({
          status: "completed",
          hops: [
            {
              peer_queried: "peer-a",
              distance: 12,
              rtt_ms: 44,
              contacts_returned: 3,
            },
            {
              peer: "peer-b",
              error: "timeout",
            },
          ],
        });
      }
      throw new Error(`Unexpected URL in test: ${String(url)}`);
    };

    const client = new RustMuleClient(
      "http://127.0.0.1:17835",
      undefined,
      "/api/v1",
      debugToken.filePath,
    );
    await client.loadToken();

    const result = await client.traceLookup("abcd", { pollIntervalMs: 1, maxWaitMs: 1000 });

    assert.equal(result.traceId, "trace-42");
    assert.equal(result.status, "completed");
    assert.equal(result.hops.length, 2);
    assert.equal(result.hops[0].peerQueried, "peer-a");
    assert.equal(result.hops[0].rttMs, 44);
    assert.equal(result.hops[1].peerQueried, "peer-b");
    assert.equal(result.hops[1].error, "timeout");
  } finally {
    await debugToken.cleanup();
  }
});

test("RustMuleClient loadToken fails when configured auth token file is missing", async () => {
  const client = new RustMuleClient("http://127.0.0.1:17835", "/does/not/exist/token");

  await assert.rejects(() => client.loadToken(), /Failed to load auth token/);
});

test("RustMuleClient times out HTTP requests with a bounded timeout", async () => {
  global.fetch = async (_url, init = {}) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const client = new RustMuleClient("http://127.0.0.1:17835", undefined, "/api/v1", undefined, 200);

  await assert.rejects(() => client.getNodeInfo(), /timed out after 200ms/);
});
