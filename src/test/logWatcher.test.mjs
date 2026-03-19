import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LogWatcher } from "../../dist/logs/logWatcher.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-logwatcher-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("LogWatcher tail updates offset and reads appended lines", async () => {
  const tmp = await makeTempDir();
  try {
    const logPath = join(tmp.dir, "rust-mule.log");
    await writeFile(logPath, "first\n", "utf8");

    const watcher = new LogWatcher(logPath, 10);

    await watcher.tail();
    const firstSize = (await stat(logPath)).size;
    assert.equal(watcher.getOffset(), firstSize);
    assert.deepEqual(watcher.getRecentLines(), ["first"]);

    await writeFile(logPath, "first\nsecond\n", "utf8");
    await watcher.tail();

    const secondSize = (await stat(logPath)).size;
    assert.equal(watcher.getOffset(), secondSize);
    assert.deepEqual(watcher.getRecentLines(), ["first", "second"]);
  } finally {
    await tmp.cleanup();
  }
});

test("LogWatcher preserves offset when a read fails", async (t) => {
  const tmp = await makeTempDir();
  try {
    const logPath = join(tmp.dir, "rust-mule.log");
    await writeFile(logPath, "first\n", "utf8");

    const watcher = new LogWatcher(logPath, 10);

    await watcher.tail();
    const initialOffset = watcher.getOffset();

    await writeFile(logPath, "first\nsecond\n", "utf8");
    await chmod(logPath, 0o000);
    try {
      await readFile(logPath, "utf8");
      t.skip("filesystem does not enforce chmod-based read denial in this environment");
      return;
    } catch {
      // expected on filesystems that honor chmod-based read denial
    }
    await watcher.tail();
    assert.equal(watcher.getOffset(), initialOffset);

    await chmod(logPath, 0o644);
    await watcher.tail();
    assert.deepEqual(watcher.getRecentLines(), ["first", "second"]);
  } finally {
    await tmp.cleanup();
  }
});

test("LogWatcher start tolerates log files created after startup", async () => {
  const tmp = await makeTempDir();
  try {
    const logPath = join(tmp.dir, "rust-mule.log");
    const watcher = new LogWatcher(logPath, 10);

    await watcher.start();
    assert.deepEqual(watcher.getRecentLines(), []);
    assert.equal(watcher.getOffset(), 0);

    await writeFile(logPath, "late\n", "utf8");
    await watcher.tail();

    assert.deepEqual(watcher.getRecentLines(), ["late"]);
    watcher.stop();
  } finally {
    await tmp.cleanup();
  }
});
