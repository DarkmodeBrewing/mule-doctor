import test from "node:test";
import assert from "node:assert/strict";

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

test("RustMuleClient derives lookup stats from status totals", async () => {
  global.fetch = async () =>
    makeJsonResponse({
      sent_reqs_total: 100,
      tracked_out_matched_total: 60,
      timeouts_total: 10,
      tracked_out_unmatched_total: 5,
      tracked_out_expired_total: 15,
    });

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const stats = await client.getLookupStats();
  assert.equal(stats.total, 100);
  assert.equal(stats.successful, 60);
  assert.equal(stats.failed, 30);
});
