import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OperatorConsoleServer } from "../dist/operatorConsole/server.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-console-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function loginAndGetCookie(baseUrl) {
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: "ui-secret" }),
    redirect: "manual",
  });
  assert.equal(loginRes.status, 303);
  const cookie = loginRes.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie;
}

async function readSseUntil(stream, predicate, timeoutMs = 2000) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("timed out waiting for SSE payload")), remainingMs);
        }),
      ]);
      if (chunk.done) {
        throw new Error("SSE stream closed before matching payload");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const lines = frame
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith(":"));
        const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
        const dataLine = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim();
        if (!event || !dataLine) continue;
        const payload = JSON.parse(dataLine);
        if (predicate({ event, payload })) {
          return { event, payload };
        }
      }
    }
    throw new Error("timed out waiting for SSE payload");
  } finally {
    reader.releaseLock();
  }
}

test("OperatorConsoleServer requires authentication for UI and API endpoints", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    const llmDir = join(tmp.dir, "llm");
    const proposalDir = join(tmp.dir, "proposals");
    await mkdir(llmDir, { recursive: true });
    await mkdir(proposalDir, { recursive: true });
    await writeFile(rustLogPath, "line1\nline2\n", "utf8");
    await writeFile(join(llmDir, "LLM_2026-03-08.log"), "token=secret\npayload=ok\n", "utf8");
    await writeFile(
      join(proposalDir, "proposal-2026-03-08.patch"),
      "diff --git a/src/a.rs b/src/a.rs\n",
      "utf8",
    );

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: llmDir,
      proposalDir,
      getAppLogs: () => ['{"msg":"api_key=topsecret"}'],
      subscribeToAppLogs: () => () => {},
      rustMuleStreamPollMs: 25,
    });
    await server.start();

    const baseUrl = server.publicAddress();

    const rootRes = await fetch(`${baseUrl}/`);
    assert.equal(rootRes.status, 200);
    assert.match(await rootRes.text(), /Authentication required/);

    const loginScriptRes = await fetch(`${baseUrl}/static/operatorConsole/login.js`);
    assert.equal(loginScriptRes.status, 200);
    assert.equal(loginScriptRes.headers.get("content-type"), "application/javascript; charset=utf-8");

    const unauthorizedIndexHtmlRes = await fetch(`${baseUrl}/static/operatorConsole/index.html`);
    assert.equal(unauthorizedIndexHtmlRes.status, 401);

    const unauthorizedDirectoryRes = await fetch(`${baseUrl}/static/operatorConsole/.`);
    assert.equal(unauthorizedDirectoryRes.status, 401);

    const unauthorizedHealthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(unauthorizedHealthRes.status, 401);

    const cookie = await loginAndGetCookie(baseUrl);

    const healthRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Cookie: cookie },
    });
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get("cache-control"), "no-store");
    assert.equal(healthRes.headers.get("x-content-type-options"), "nosniff");
    const health = await healthRes.json();
    assert.equal(health.ok, true);

    const staticUiRes = await fetch(`${baseUrl}/static/operatorConsole/app.js`, {
      headers: { Cookie: cookie },
    });
    assert.equal(staticUiRes.status, 200);
    assert.equal(staticUiRes.headers.get("content-type"), "application/javascript; charset=utf-8");

    const authorizedIndexHtmlRes = await fetch(`${baseUrl}/static/operatorConsole/index.html`, {
      headers: { Cookie: cookie },
    });
    assert.equal(authorizedIndexHtmlRes.status, 404);

    const authorizedDirectoryRes = await fetch(`${baseUrl}/static/operatorConsole/.`, {
      headers: { Cookie: cookie },
    });
    assert.equal(authorizedDirectoryRes.status, 404);

    const appRes = await fetch(`${baseUrl}/api/logs/app?lines=10`, {
      headers: { Cookie: cookie },
    });
    assert.equal(appRes.status, 200);
    const appLogs = await appRes.json();
    assert.equal(appLogs.lines[0].includes("[redacted]"), true);

    const llmListRes = await fetch(`${baseUrl}/api/llm/logs`, {
      headers: { Cookie: cookie },
    });
    assert.equal(llmListRes.status, 200);
    const llmList = await llmListRes.json();
    assert.equal(llmList.files.length, 1);
    assert.equal(llmList.files[0].name, "LLM_2026-03-08.log");

    const proposalListRes = await fetch(`${baseUrl}/api/proposals`, {
      headers: { Cookie: cookie },
    });
    assert.equal(proposalListRes.status, 200);
    const proposals = await proposalListRes.json();
    assert.equal(proposals.files.length, 1);
    assert.equal(proposals.files[0].name, "proposal-2026-03-08.patch");

    const invalidPathRes = await fetch(`${baseUrl}/api/proposals/%2e%2e%2fsecret.txt`, {
      headers: { Cookie: cookie },
    });
    assert.equal(invalidPathRes.status, 400);

    const invalidDriveLikePathRes = await fetch(`${baseUrl}/api/proposals/D%3Asecret.patch`, {
      headers: { Cookie: cookie },
    });
    assert.equal(invalidDriveLikePathRes.status, 400);

    const malformedCookieHealthRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Cookie: "mule_doctor_ui_token=%E0%A4%A" },
    });
    assert.equal(malformedCookieHealthRes.status, 401);

    const unauthenticatedLogoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      redirect: "manual",
    });
    assert.equal(unauthenticatedLogoutRes.status, 401);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer streams app logs over SSE", async () => {
  const tmp = await makeTempDir();
  const appLogListeners = new Set();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => ["boot line"],
      subscribeToAppLogs: (listener) => {
        appLogListeners.add(listener);
        return () => {
          appLogListeners.delete(listener);
        };
      },
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const streamRes = await fetch(`${server.publicAddress()}/api/stream/app?lines=10`, {
      headers: { Cookie: cookie },
    });
    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers.get("content-type"), "text/event-stream; charset=utf-8");

    const snapshot = await readSseUntil(streamRes.body, ({ event }) => event === "snapshot");
    assert.deepEqual(snapshot.payload.lines, ["boot line"]);

    for (const listener of appLogListeners) {
      listener('authorization":"Bearer topsecret"');
    }

    const lineEvent = await readSseUntil(
      streamRes.body,
      ({ event, payload }) => event === "line" && payload.line.includes("[redacted]"),
    );
    assert.equal(lineEvent.payload.line.includes("[redacted]"), true);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer streams rust-mule log updates over SSE", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "start line\n", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      rustMuleStreamPollMs: 25,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const streamRes = await fetch(`${server.publicAddress()}/api/stream/rust-mule?lines=10`, {
      headers: { Cookie: cookie },
    });
    assert.equal(streamRes.status, 200);

    const snapshot = await readSseUntil(streamRes.body, ({ event }) => event === "snapshot");
    assert.deepEqual(snapshot.payload.lines, ["start line"]);

    await appendFile(rustLogPath, 'token=secret-follower\nnext line\n', "utf8");
    const lineEvent = await readSseUntil(
      streamRes.body,
      ({ event, payload }) => event === "line" && payload.line.includes("[redacted]"),
    );
    assert.equal(lineEvent.payload.line.includes("[redacted]"), true);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});
