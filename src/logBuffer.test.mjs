import test from "node:test";
import assert from "node:assert/strict";

import { installStdoutLogBuffer } from "../dist/operatorConsole/logBuffer.js";

test("installStdoutLogBuffer captures chunked writes and restores stdout", async () => {
  const originalWrite = process.stdout.write;
  const forwardedChunks = [];

  process.stdout.write = ((chunk, ...args) => {
    forwardedChunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    const callback = args.find((arg) => typeof arg === "function");
    if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  try {
    const preInstallWrite = process.stdout.write;
    const buffer = installStdoutLogBuffer(100);

    process.stdout.write("line-1");
    process.stdout.write("\r\nline-2\n");
    process.stdout.write(new Uint8Array(Buffer.from("line-3")));
    process.stdout.write("\npartial");

    assert.deepEqual(buffer.getRecentLines(), ["line-1", "line-2", "line-3"]);
    assert.equal(forwardedChunks.join(""), "line-1\r\nline-2\nline-3\npartial");

    buffer.restore();
    assert.notEqual(process.stdout.write, preInstallWrite);
    forwardedChunks.length = 0;
    process.stdout.write("after-restore\n");
    assert.equal(forwardedChunks.join(""), "after-restore\n");
    assert.deepEqual(buffer.getRecentLines(), ["line-1", "line-2", "line-3"]);
  } finally {
    process.stdout.write = originalWrite;
  }
});
