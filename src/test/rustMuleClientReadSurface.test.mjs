import test from "node:test";
import assert from "node:assert/strict";

import { RustMuleClient } from "../../dist/api/rustMuleClient.js";
import { makeJsonResponse, writeTempFile } from "./rustMuleClientTestHelpers.mjs";

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

test("RustMuleClient exposes status readiness explicitly", async () => {
  global.fetch = async () =>
    makeJsonResponse({
      ready: true,
      uptime_secs: 123,
      node_id_hex: "abc123",
    });

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const status = await client.getStatus();

  assert.equal(status.ready, true);
  assert.equal(status.uptime_secs, 123);
});

test("RustMuleClient exposes search readiness explicitly", async () => {
  global.fetch = async () =>
    makeJsonResponse({
      ready: true,
      searches: [{ search_id_hex: "01", keyword_label: "fixture", hits: 1 }],
    });

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const searches = await client.getSearches();

  assert.equal(searches.ready, true);
  assert.equal(searches.searches.length, 1);
  assert.equal(searches.searches[0].search_id_hex, "01");
});

test("RustMuleClient reads search detail from /api/v1/searches/{id}", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return makeJsonResponse({
      search: {
        search_id_hex: "search-01",
        keyword_label: "fixture-token",
        state: "running",
      },
      hits: [
        {
          file_id_hex: "file-01",
          filename: "fixture-token.txt",
          file_size: 128,
        },
      ],
    });
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const detail = await client.getSearchDetail("search-01");

  assert.equal(calls[0], "http://127.0.0.1:17835/api/v1/searches/search-01");
  assert.equal(detail.search.search_id_hex, "search-01");
  assert.equal(detail.hits.length, 1);
  assert.equal(detail.hits[0].filename, "fixture-token.txt");
});

test("RustMuleClient ignores invalid array-shaped search payloads in search detail", async () => {
  global.fetch = async () =>
    makeJsonResponse({
      search: ["not", "an", "object"],
      hits: [],
    });

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const detail = await client.getSearchDetail("search-01");

  assert.deepEqual(detail.search, {});
  assert.deepEqual(detail.hits, []);
});

test("RustMuleClient reads shared files from /api/v1/shared", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return makeJsonResponse({
      files: [
        {
          identity: {
            file_name: "fixture-token.txt",
            relative_path: "fixture-token.txt",
          },
          keyword_publish_queued: true,
        },
      ],
    });
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const shared = await client.getSharedFiles();

  assert.equal(calls[0], "http://127.0.0.1:17835/api/v1/shared");
  assert.equal(shared.files.length, 1);
  assert.equal(shared.files[0].identity.file_name, "fixture-token.txt");
  assert.equal(shared.files[0].keyword_publish_queued, true);
});

test("RustMuleClient reads shared actions from /api/v1/shared/actions", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return makeJsonResponse({
      actions: [
        {
          kind: "republish_keywords",
          state: "running",
        },
      ],
    });
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const actions = await client.getSharedActions();

  assert.equal(calls[0], "http://127.0.0.1:17835/api/v1/shared/actions");
  assert.equal(actions.actions.length, 1);
  assert.equal(actions.actions[0].kind, "republish_keywords");
});

test("RustMuleClient starts keyword search via /api/v1/kad/search_keyword", async () => {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return makeJsonResponse({
      keyword_id_hex: "feedfacefeedfacefeedfacefeedface",
      search_id_hex: "feedfacefeedfacefeedfacefeedface",
    });
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const response = await client.startKeywordSearch({ query: "fixture token" });

  assert.equal(calls[0].url, "http://127.0.0.1:17835/api/v1/kad/search_keyword");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, '{"query":"fixture token"}');
  assert.equal(response.keyword_id_hex, "feedfacefeedfacefeedfacefeedface");
  assert.equal(response.search_id_hex, "feedfacefeedfacefeedfacefeedface");
});

test("RustMuleClient reads downloads from /api/v1/downloads", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return makeJsonResponse({
      queue_len: 1,
      downloads: [
        {
          file_name: "fixture-token.txt",
          state: "downloading",
          progress_pct: 33.3,
        },
      ],
    });
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const downloads = await client.getDownloads();

  assert.equal(calls[0], "http://127.0.0.1:17835/api/v1/downloads");
  assert.equal(downloads.queue_len, 1);
  assert.equal(downloads.downloads.length, 1);
  assert.equal(downloads.downloads[0].file_name, "fixture-token.txt");
});

test("RustMuleClient combines status and search readiness", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/status")) {
      return makeJsonResponse({ ready: true, node_id_hex: "abc123" });
    }
    if (String(url).endsWith("/searches")) {
      return makeJsonResponse({ ready: false, searches: [] });
    }
    throw new Error(`Unexpected URL in test: ${String(url)}`);
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const readiness = await client.getReadiness();

  assert.deepEqual(calls.sort(), [
    "http://127.0.0.1:17835/api/v1/searches",
    "http://127.0.0.1:17835/api/v1/status",
  ]);
  assert.equal(readiness.statusReady, true);
  assert.equal(readiness.searchesReady, false);
  assert.equal(readiness.ready, false);
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

test("RustMuleClient loadToken fails when configured auth token file is missing", async () => {
  const client = new RustMuleClient("http://127.0.0.1:17835", "/does/not/exist/token");

  await assert.rejects(() => client.loadToken(), /Failed to load auth token/);
});

test("RustMuleClient loadToken fails when configured debug token file is missing", async () => {
  const client = new RustMuleClient(
    "http://127.0.0.1:17835",
    undefined,
    "/api/v1",
    "/does/not/exist/debug.token",
  );

  await assert.rejects(() => client.loadToken(), /Failed to load debug token/);
});

test("RustMuleClient times out HTTP read requests and returns fallback values", async () => {
  global.fetch = async (_url, init = {}) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const client = new RustMuleClient("http://127.0.0.1:17835", undefined, "/api/v1", undefined, 200);
  const node = await client.getNodeInfo();
  const peers = await client.getPeers();
  const stats = await client.getLookupStats();

  assert.equal(node.nodeId, "unknown");
  assert.equal(node.version, "unknown");
  assert.equal(node.uptime, 0);
  assert.deepEqual(peers, []);
  assert.equal(stats.total, 0);
  assert.equal(stats.successful, 0);
});

test("RustMuleClient returns graceful fallback when status endpoint is missing (404)", async () => {
  global.fetch = async () => makeJsonResponse({ code: 404 }, 404);

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const node = await client.getNodeInfo();

  assert.equal(node.nodeId, "unknown");
  assert.equal(node.version, "unknown");
  assert.equal(node.uptime, 0);
});

test("RustMuleClient returns graceful fallback when events endpoint is missing (404)", async () => {
  global.fetch = async () => makeJsonResponse({ code: 404 }, 404);

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const stats = await client.getLookupStats();

  assert.equal(stats.total, 0);
  assert.equal(stats.successful, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.matchPerSent, 0);
  assert.equal(stats.timeoutsPerSent, 0);
});

test("RustMuleClient surfaces 403 for core read endpoints", async () => {
  global.fetch = async () => makeJsonResponse({ code: 403 }, 403);

  const client = new RustMuleClient("http://127.0.0.1:17835");
  await assert.rejects(() => client.getNodeInfo(), /failed with status 403/);
  await assert.rejects(() => client.getPeers(), /failed with status 403/);
  await assert.rejects(() => client.getLookupStats(), /failed with status 403/);
});
