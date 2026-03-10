import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RecentFileLogSource } from "../dist/logs/recentFileLogSource.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-recent-file-log-source-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("RecentFileLogSource reads appended lines on subsequent calls", async () => {
  const tmp = await makeTempDir();
  try {
    const logPath = join(tmp.dir, "rust-mule.log");
    await writeFile(logPath, "line 1\n", "utf8");
    const source = new RecentFileLogSource(logPath);

    assert.deepEqual(source.getRecentLines(), ["line 1"]);

    await appendFile(logPath, "line 2\n", "utf8");

    assert.deepEqual(source.getRecentLines(), ["line 1", "line 2"]);
    assert.deepEqual(source.getRecentLines(1), ["line 2"]);
  } finally {
    await tmp.cleanup();
  }
});

test("RecentFileLogSource redacts lines when configured", async () => {
  const tmp = await makeTempDir();
  try {
    const logPath = join(tmp.dir, "rust-mule.log");
    await writeFile(logPath, "token=secret-value\n", "utf8");
    const source = new RecentFileLogSource(logPath, { redact: true });

    assert.deepEqual(source.getRecentLines(), ["token=[redacted]"]);
  } finally {
    await tmp.cleanup();
  }
});
