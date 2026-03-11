import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InstanceManager } from "../../dist/instances/instanceManager.js";
import { ManagedInstancePresetService } from "../../dist/instances/managedInstancePresets.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-presets-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("ManagedInstancePresetService lists default presets", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
    });
    await manager.initialize();
    const service = new ManagedInstancePresetService(manager);
    const presets = service.listPresets();
    assert.deepEqual(
      presets.map((preset) => preset.id),
      ["pair", "trio"],
    );
  } finally {
    await tmp.cleanup();
  }
});

test("ManagedInstancePresetService applies a preset as planned instances", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
    });
    await manager.initialize();
    const service = new ManagedInstancePresetService(manager);
    const applied = await service.applyPreset({
      presetId: "pair",
      prefix: "lab",
    });

    assert.equal(applied.instances.length, 2);
    assert.deepEqual(
      applied.instances.map((instance) => instance.id),
      ["lab-a", "lab-b"],
    );
    assert.deepEqual(
      applied.instances.map((instance) => instance.apiPort),
      [19000, 19001],
    );
    assert.deepEqual(
      applied.instances.map((instance) => instance.preset),
      [
        { presetId: "pair", prefix: "lab" },
        { presetId: "pair", prefix: "lab" },
      ],
    );
  } finally {
    await tmp.cleanup();
  }
});

test("ManagedInstancePresetService rejects invalid prefixes", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
    });
    await manager.initialize();
    const service = new ManagedInstancePresetService(manager);
    await assert.rejects(
      service.applyPreset({ presetId: "pair", prefix: "bad prefix" }),
      /Invalid managed instance preset prefix/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("ManagedInstancePresetService rejects reused preset prefixes", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
    });
    await manager.initialize();
    const service = new ManagedInstancePresetService(manager);
    await service.applyPreset({ presetId: "pair", prefix: "lab" });

    await assert.rejects(
      service.applyPreset({ presetId: "trio", prefix: "lab" }),
      /Managed instance preset prefix already exists: lab/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("ManagedInstancePresetService starts all instances in a preset group", async () => {
  const tmp = await makeTempDir();
  try {
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      processLauncher: {
        async launch({ command, args, cwd }) {
          return {
            pid: cwd.endsWith("/lab-a") ? 4101 : 4102,
            command,
            args,
            cwd,
            logPath: `${cwd}/state/logs/rust-mule.log`,
            exit: new Promise(() => {}),
          };
        },
        async stop() {},
        async isRunning() {
          return true;
        },
      },
    });
    await manager.initialize();
    const service = new ManagedInstancePresetService(manager);
    await service.applyPreset({ presetId: "pair", prefix: "lab" });

    const started = await service.startPreset("lab");

    assert.equal(started.presetId, "pair");
    assert.equal(started.prefix, "lab");
    assert.equal(started.action, "start");
    assert.equal(started.failures.length, 0);
    assert.deepEqual(
      started.instances.map((instance) => instance.status),
      ["running", "running"],
    );
  } finally {
    await tmp.cleanup();
  }
});

test("ManagedInstancePresetService stops and restarts all instances in a preset group", async () => {
  const tmp = await makeTempDir();
  try {
    let nextPid = 5000;
    const stoppedPids = new Set();
    const launcher = {
      async launch({ command, args, cwd }) {
        const pid = nextPid += 1;
        return {
          pid,
          command,
          args,
          cwd,
          logPath: `${cwd}/state/logs/rust-mule.log`,
          exit: new Promise(() => {}),
        };
      },
      async stop(pid) {
        stoppedPids.add(pid);
      },
      async isRunning(pid) {
        return !stoppedPids.has(pid);
      },
    };
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      apiPortStart: 19000,
      apiPortEnd: 19010,
      processLauncher: launcher,
    });
    await manager.initialize();
    const service = new ManagedInstancePresetService(manager);
    await service.applyPreset({ presetId: "pair", prefix: "lab" });
    await service.startPreset("lab");

    const stopped = await service.stopPreset("lab");
    assert.equal(stopped.action, "stop");
    assert.equal(stopped.failures.length, 0);
    assert.deepEqual(
      stopped.instances.map((instance) => instance.status),
      ["stopped", "stopped"],
    );

    const restarted = await service.restartPreset("lab");
    assert.equal(restarted.action, "restart");
    assert.equal(restarted.failures.length, 0);
    assert.deepEqual(
      restarted.instances.map((instance) => instance.status),
      ["running", "running"],
    );
  } finally {
    await tmp.cleanup();
  }
});
