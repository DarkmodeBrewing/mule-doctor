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
  assert.equal(paths.tokenPath, "/data/instances/a/state/api.token");
  assert.equal(paths.debugTokenPath, "/data/instances/a/state/debug.token");
  assert.equal(paths.logDir, "/data/instances/a/state/logs");
  assert.equal(paths.logPath, "/data/instances/a/state/logs/rust-mule.log");
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
    assert.match(configRaw, /\[sam\]/);
    assert.match(configRaw, /session_name = "rust-mule-a"/);
    assert.match(configRaw, /\[general\]/);
    assert.match(configRaw, /auto_open_ui = false/);
    assert.match(configRaw, new RegExp(`data_dir = "${escapeRegExp(created.runtime.stateDir)}"`));
    assert.match(configRaw, /\[api\]/);
    assert.match(configRaw, /port = 19000/);
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager renders configured rust-mule template values", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleConfigTemplate: {
        samHost: "10.99.0.2",
        samPort: 7656,
        samUdpPort: 7655,
        samDatagramTransport: "tcp",
        samForwardHost: "10.99.0.1",
        samForwardPort: 40000,
        samControlTimeoutSecs: 120,
        generalLogLevel: "info",
        generalLogToFile: true,
        generalLogFileName: "rust-mule.log",
        generalLogFileLevel: "debug",
        apiEnableDebugEndpoints: true,
        apiAuthMode: "headless_remote",
        sessionNamePrefix: "managed",
      },
    });
    await manager.initialize();

    const created = await manager.createPlannedInstance({ id: "b", apiPort: 19003 });
    const configRaw = await readFile(created.runtime.configPath, "utf8");

    assert.match(configRaw, /session_name = "managed-b"/);
    assert.match(configRaw, /host = "10.99.0.2"/);
    assert.match(configRaw, /udp_port = 7655/);
    assert.match(configRaw, /forward_host = "10.99.0.1"/);
    assert.match(configRaw, /forward_port = 40000/);
    assert.match(configRaw, /auth_mode = "headless_remote"/);
    assert.match(configRaw, /enable_debug_endpoints = true/);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

test("InstanceManager rejects invalid apiPort values", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
    });
    await manager.initialize();

    await assert.rejects(
      manager.createPlannedInstance({ id: "noninteger", apiPort: 19000.5 }),
      /Invalid port/,
    );
    await assert.rejects(
      manager.createPlannedInstance({ id: "toolow", apiPort: 0 }),
      /Invalid port/,
    );
    await assert.rejects(
      manager.createPlannedInstance({ id: "toohigh", apiPort: 70000 }),
      /Invalid port/,
    );
    await assert.rejects(
      manager.createPlannedInstance({ id: "beforerange", apiPort: 18999 }),
      /outside the allowed range/,
    );
    await assert.rejects(
      manager.createPlannedInstance({ id: "afterrange", apiPort: 19011 }),
      /outside the allowed range/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager serializes concurrent planned instance creation", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
    });
    await manager.initialize();

    await Promise.all([
      manager.createPlannedInstance({ id: "a" }),
      manager.createPlannedInstance({ id: "b" }),
      manager.createPlannedInstance({ id: "c" }),
    ]);

    const instances = await manager.listInstances();
    assert.equal(instances.length, 3);
    assert.deepEqual(
      instances.map((instance) => instance.apiPort).sort((a, b) => a - b),
      [19000, 19001, 19002],
    );
  } finally {
    await tmp.cleanup();
  }
});
