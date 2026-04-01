import test from "node:test";
import assert from "node:assert/strict";

import { RustMuleClient } from "../../dist/api/rustMuleClient.js";
import { makeJsonResponse, writeTempFile } from "./rustMuleClientTestHelpers.mjs";

test("RustMuleClient posts shared maintenance actions to rust-mule", async () => {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const kind = String(url).split("/").pop();
    return makeJsonResponse({
      actions: [
        {
          kind,
          state: "queued",
        },
      ],
    });
  };

  const client = new RustMuleClient("http://127.0.0.1:17835");
  const reindex = await client.reindexShared();
  const republishSources = await client.republishSources();
  const republishKeywords = await client.republishKeywords();

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "http://127.0.0.1:17835/api/v1/shared/actions/reindex",
      "http://127.0.0.1:17835/api/v1/shared/actions/republish_sources",
      "http://127.0.0.1:17835/api/v1/shared/actions/republish_keywords",
    ],
  );
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.equal(call.init.body, '{"confirm":true}');
  }
  assert.equal(reindex.actions[0].kind, "reindex");
  assert.equal(republishSources.actions[0].kind, "republish_sources");
  assert.equal(republishKeywords.actions[0].kind, "republish_keywords");
});

test("RustMuleClient triggerBootstrap posts debug restart and polls job endpoint", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");
  const calls = [];

  try {
    let pollCount = 0;
    global.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      if (String(url).endsWith("/debug/bootstrap/restart")) {
        return makeJsonResponse({ job_id: "job-123" }, 202);
      }
      if (String(url).endsWith("/debug/bootstrap/jobs/job-123")) {
        pollCount += 1;
        if (pollCount === 1) {
          return makeJsonResponse({ status: "running", detail: "still working" });
        }
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
    assert.equal(pollCount, 2);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["X-Debug-Token"], "debug-secret");
    assert.equal(calls[1].init.headers["X-Debug-Token"], "debug-secret");
    assert.equal(calls[2].init.headers["X-Debug-Token"], "debug-secret");
  } finally {
    await debugToken.cleanup();
  }
});

test("RustMuleClient traceLookup posts and returns normalized hops", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");

  try {
    let pollCount = 0;
    global.fetch = async (url) => {
      if (String(url).endsWith("/debug/trace_lookup")) {
        return makeJsonResponse({ trace_id: "trace-42" }, 202);
      }
      if (String(url).endsWith("/debug/trace_lookup/trace-42")) {
        pollCount += 1;
        if (pollCount === 1) {
          return makeJsonResponse({ status: "running", hops: [] });
        }
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
    assert.equal(pollCount, 2);
    assert.equal(result.hops.length, 2);
    assert.equal(result.hops[0].peerQueried, "peer-a");
    assert.equal(result.hops[0].rttMs, 44);
    assert.equal(result.hops[1].peerQueried, "peer-b");
    assert.equal(result.hops[1].error, "timeout");
  } finally {
    await debugToken.cleanup();
  }
});

test("RustMuleClient triggerBootstrap surfaces 403 for invalid debug token", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");
  const calls = [];

  try {
    global.fetch = async (url, init = {}) => {
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

    await assert.rejects(
      () => client.triggerBootstrap({ pollIntervalMs: 1, maxWaitMs: 100 }),
      /failed with status 403/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:17835/api/v1/debug/bootstrap/restart");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["X-Debug-Token"], "debug-secret");
  } finally {
    await debugToken.cleanup();
  }
});

test("RustMuleClient triggerBootstrap surfaces 404 when debug endpoints are disabled", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");
  const calls = [];

  try {
    global.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      return makeJsonResponse({ code: 404 }, 404);
    };

    const client = new RustMuleClient(
      "http://127.0.0.1:17835",
      undefined,
      "/api/v1",
      debugToken.filePath,
    );
    await client.loadToken();

    await assert.rejects(
      () => client.triggerBootstrap({ pollIntervalMs: 1, maxWaitMs: 100 }),
      /failed with status 404/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:17835/api/v1/debug/bootstrap/restart");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["X-Debug-Token"], "debug-secret");
  } finally {
    await debugToken.cleanup();
  }
});

test("RustMuleClient traceLookup surfaces 403 for invalid debug token", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");
  const calls = [];

  try {
    global.fetch = async (url, init = {}) => {
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

    await assert.rejects(
      () => client.traceLookup("abcd", { pollIntervalMs: 1, maxWaitMs: 100 }),
      /failed with status 403/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:17835/api/v1/debug/trace_lookup");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["X-Debug-Token"], "debug-secret");
  } finally {
    await debugToken.cleanup();
  }
});

test("RustMuleClient traceLookup surfaces 404 when debug endpoints are disabled", async () => {
  const debugToken = await writeTempFile("debug.token", "debug-secret\n");
  const calls = [];

  try {
    global.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      return makeJsonResponse({ code: 404 }, 404);
    };

    const client = new RustMuleClient(
      "http://127.0.0.1:17835",
      undefined,
      "/api/v1",
      debugToken.filePath,
    );
    await client.loadToken();

    await assert.rejects(
      () => client.traceLookup("abcd", { pollIntervalMs: 1, maxWaitMs: 100 }),
      /failed with status 404/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:17835/api/v1/debug/trace_lookup");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["X-Debug-Token"], "debug-secret");
  } finally {
    await debugToken.cleanup();
  }
});
