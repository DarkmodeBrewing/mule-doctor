import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { InstanceManager, buildRuntimePaths } from "../../dist/instances/instanceManager.js";
import {
  escapeRegExp,
  makeTempDir,
  writeFakeRustMuleBinary,
} from "./instanceManagerTestHelpers.mjs";

test("buildRuntimePaths derives isolated per-instance paths", () => {
  const paths = buildRuntimePaths("/data/instances", "a");
  assert.equal(paths.rootDir, "/data/instances/a");
  assert.equal(paths.configPath, "/data/instances/a/config.toml");
  assert.equal(paths.tokenPath, "/data/instances/a/state/api.token");
  assert.equal(paths.debugTokenPath, "/data/instances/a/state/debug.token");
  assert.equal(paths.logDir, "/data/instances/a/state/logs");
  assert.equal(paths.logPath, "/data/instances/a/state/logs/rust-mule.log");
  assert.equal(paths.stateDir, "/data/instances/a/state");
  assert.equal(paths.sharedDir, "/data/instances/a/shared");
  assert.equal(paths.metadataPath, "/data/instances/a/instance.json");
});

test("InstanceManager creates and persists planned instances", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleBinaryPath,
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
    assert.match(configRaw, /\[sharing\]/);
    assert.match(
      configRaw,
      new RegExp(`share_roots = \\["${escapeRegExp(created.runtime.sharedDir)}"\\]`),
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager creates planned instances in a batch", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleBinaryPath,
    });
    await manager.initialize();

    const created = await manager.createPlannedInstances([
      { id: "a", preset: { presetId: "pair", prefix: "lab" } },
      { id: "b", preset: { presetId: "pair", prefix: "lab" } },
    ]);

    assert.deepEqual(
      created.map((instance) => instance.id),
      ["a", "b"],
    );
    assert.deepEqual(
      created.map((instance) => instance.apiPort),
      [19000, 19001],
    );
    assert.deepEqual(
      created.map((instance) => instance.preset),
      [
        { presetId: "pair", prefix: "lab" },
        { presetId: "pair", prefix: "lab" },
      ],
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager rejects empty planned-instance batches", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath,
    });
    await manager.initialize();

    await assert.rejects(
      manager.createPlannedInstances([]),
      /At least one managed instance input is required/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager renders configured rust-mule template values", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleBinaryPath,
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
        sharingShareRoots: ["/srv/fixtures", "/srv/fixtures-extra"],
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
    assert.match(
      configRaw,
      /share_roots = \["[^"]*\/shared", "\/srv\/fixtures", "\/srv\/fixtures-extra"\]/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager accepts nested rust-mule template sections and writes ownership comments", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleBinaryPath,
      rustMuleConfigTemplate: {
        sam: {
          host: "10.99.0.20",
          forwardHost: "10.99.0.10",
        },
        general: {
          logLevel: "debug",
        },
        api: {
          authMode: "local_ui",
        },
        sharing: {
          extraShareRoots: ["/srv/nested-fixtures"],
        },
        sessionNamePrefix: "nested",
      },
    });
    await manager.initialize();

    const created = await manager.createPlannedInstance({ id: "nested-a", apiPort: 19004 });
    const configRaw = await readFile(created.runtime.configPath, "utf8");

    assert.match(configRaw, /# mule-doctor-owned keys are generated per instance:/);
    assert.match(configRaw, /# externally supplied template keys may set shared rust-mule defaults:/);
    assert.match(
      configRaw,
      /# rejected template keys that would conflict with mule-doctor-owned runtime isolation:/,
    );
    assert.match(configRaw, /session_name = "nested-nested-a"/);
    assert.match(configRaw, /host = "10.99.0.20"/);
    assert.match(configRaw, /forward_host = "10.99.0.10"/);
    assert.match(configRaw, /log_level = "debug"/);
    assert.match(configRaw, /auth_mode = "local_ui"/);
    assert.match(configRaw, /share_roots = \["[^"]*\/shared", "\/srv\/nested-fixtures"\]/);
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager rejects template ownership conflicts for mule-doctor-managed keys", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath,
      rustMuleConfigTemplate: {
        sam: {
          host: "127.0.0.1",
          sessionName: "forbidden",
        },
        general: {
          dataDir: "/tmp/not-allowed",
        },
        api: {
          port: 20100,
        },
      },
    });
    await manager.initialize();

    await assert.rejects(
      manager.createPlannedInstance({ id: "bad-owned-keys" }),
      /Managed rust-mule config template may not set mule-doctor-owned keys: sam\.session_name, general\.data_dir, api\.port/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager rejects template ownership conflicts for share_roots and flat aliases", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath,
      rustMuleConfigTemplate: {
        generalAutoOpenUi: true,
        samSessionName: "forbidden-flat",
        sharing: {
          shareRoots: ["/srv/direct-share-roots"],
        },
      },
    });
    await manager.initialize();

    await assert.rejects(
      manager.createPlannedInstance({ id: "bad-flat-owned-keys" }),
      /Managed rust-mule config template may not set mule-doctor-owned keys: sharing\.share_roots, sam\.session_name, general\.auto_open_ui/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager rejects invalid numeric template values", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath,
      rustMuleConfigTemplate: {
        samPort: Number.NaN,
      },
    });
    await manager.initialize();

    await assert.rejects(
      manager.createPlannedInstance({ id: "bad-template" }),
      /Managed rust-mule config template field 'samPort' must be a finite number/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager allocates non-overlapping API ports", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleBinaryPath,
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
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleBinaryPath,
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
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath,
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
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleBinaryPath,
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
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      rustMuleBinaryPath,
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

test("InstanceManager initialize rejects explicit missing rust-mule binaries", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath: join(tmp.dir, "missing-rust-mule"),
    });

    await assert.rejects(manager.initialize(), /missing-rust-mule/);
  } finally {
    await tmp.cleanup();
  }
});
