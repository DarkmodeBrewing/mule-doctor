import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InstanceManager, buildRuntimePaths } from "../dist/instances/instanceManager.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-instance-manager-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("buildRuntimePaths derives isolated per-instance paths", () => {
  const paths = buildRuntimePaths("/data/instances", "a");
  assert.equal(paths.rootDir, "/data/instances/a");
  assert.equal(paths.configPath, "/data/instances/a/config.toml");
  assert.equal(paths.tokenPath, "/data/instances/a/token");
  assert.equal(paths.debugTokenPath, "/data/instances/a/debug.token");
  assert.equal(paths.logDir, "/data/instances/a/logs");
  assert.equal(paths.logPath, "/data/instances/a/logs/rust-mule.log");
  assert.equal(paths.stateDir, "/data/instances/a/state");
  assert.equal(paths.metadataPath, "/data/instances/a/instance.json");
});

test("InstanceManager creates and persists planned instances", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
    });
    await manager.initialize();

    const created = await manager.createPlannedInstance({ id: "a" });
    assert.equal(created.id, "a");
    assert.equal(created.status, "planned");
    assert.equal(created.apiPort, 19000);
    assert.equal(created.runtime.rootDir, join(tmp.dir, "instances", "a"));

    const persisted = await manager.listInstances();
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].id, "a");

    const metadataRaw = await readFile(created.runtime.metadataPath, "utf8");
    const metadata = JSON.parse(metadataRaw);
    assert.equal(metadata.id, "a");

    const configRaw = await readFile(created.runtime.configPath, "utf8");
    assert.match(configRaw, /Placeholder config/);
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager allocates non-overlapping API ports", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
    });
    await manager.initialize();

    const first = await manager.createPlannedInstance({ id: "a" });
    const second = await manager.createPlannedInstance({ id: "b" });

    assert.equal(first.apiPort, 19000);
    assert.equal(second.apiPort, 19001);
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager rejects duplicate ids and reserved ports", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
    });
    await manager.initialize();

    await manager.createPlannedInstance({ id: "a", apiPort: 19005 });

    await assert.rejects(
      manager.createPlannedInstance({ id: "a" }),
      /Managed instance already exists/,
    );
    await assert.rejects(
      manager.createPlannedInstance({ id: "b", apiPort: 19005 }),
      /API port already reserved/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager rejects invalid ids", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
    });
    await manager.initialize();

    await assert.rejects(
      manager.createPlannedInstance({ id: "../bad" }),
      /Invalid managed instance id/,
    );
  } finally {
    await tmp.cleanup();
  }
});
