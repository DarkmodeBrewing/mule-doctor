import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InstanceManager } from "../dist/instances/instanceManager.js";
import { ManagedInstancePresetService } from "../dist/instances/managedInstancePresets.js";

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
