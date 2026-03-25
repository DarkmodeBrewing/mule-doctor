import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OperatorConsoleServer } from "../../dist/operatorConsole/server.js";

import {
  loginAndGetCookie,
  makeTempDir,
  readSseUntil,
} from "./operatorConsoleTestHelpers.mjs";

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
