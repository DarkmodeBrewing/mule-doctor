import test from "node:test";
import assert from "node:assert/strict";

import { installStdoutLogBuffer } from "../../dist/operatorConsole/logBuffer.js";

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
    const observed = [];
    const unsubscribe = buffer.subscribe((line) => observed.push(line));

    process.stdout.write("line-1");
    process.stdout.write("\r\nline-2\n");
    process.stdout.write(new Uint8Array(Buffer.from("line-3")));
    process.stdout.write("\npartial");

    assert.deepEqual(buffer.getRecentLines(), ["line-1", "line-2", "line-3"]);
    assert.deepEqual(observed, ["line-1", "line-2", "line-3"]);
    assert.equal(forwardedChunks.join(""), "line-1\r\nline-2\nline-3\npartial");

    unsubscribe();
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

test("installStdoutLogBuffer isolates listener failures", async () => {
  const originalWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const stderrChunks = [];

  process.stdout.write = ((chunk, ...args) => {
    const callback = args.find((arg) => typeof arg === "function");
    if (typeof callback === "function") {
      callback();
    }
    return true;
  });
  process.stderr.write = ((chunk, ...args) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    const callback = args.find((arg) => typeof arg === "function");
    if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  try {
    const buffer = installStdoutLogBuffer(100);
    const observed = [];
    buffer.subscribe(() => {
      throw new Error("boom");
    });
    buffer.subscribe((line) => observed.push(line));

    process.stdout.write("hello\n");

    assert.deepEqual(observed, ["hello"]);
    assert.equal(stderrChunks.join("").includes("AppLogBuffer listener error"), true);
    buffer.restore();
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalStderrWrite;
  }
});
