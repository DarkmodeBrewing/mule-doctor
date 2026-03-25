import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export {
  loginAndGetCookie,
  makeTempDir,
  readSseUntil,
};
