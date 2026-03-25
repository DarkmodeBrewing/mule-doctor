import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { InstanceManager } from "../../dist/instances/instanceManager.js";
import {
  FakeProcessLauncher,
  makeTempDir,
  writeFakeRustMuleBinary,
} from "./instanceManagerTestHelpers.mjs";

test("InstanceManager starts a planned instance and persists process state", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const launcher = new FakeProcessLauncher();
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath,
      processLauncher: launcher,
    });
    await manager.initialize();
    await manager.createPlannedInstance({ id: "a", apiPort: 19005 });

    const started = await manager.startInstance("a");

    assert.equal(started.status, "running");
    assert.equal(started.currentProcess.pid, 5000);
    assert.deepEqual(started.currentProcess.command, [
      rustMuleBinaryPath,
      "--config",
      started.runtime.configPath,
    ]);
    assert.equal(launcher.launches.length, 1);

    const persisted = await manager.getInstance("a");
    assert.equal(persisted.status, "running");
    assert.equal(persisted.currentProcess.pid, 5000);
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager stops a running instance and records last exit", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const launcher = new FakeProcessLauncher();
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath,
      processLauncher: launcher,
      stopTimeoutMs: 500,
    });
    await manager.initialize();
    await manager.createPlannedInstance({ id: "a" });
    await manager.startInstance("a");

    const stopped = await manager.stopInstance("a", "manual stop");

    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.currentProcess, undefined);
    assert.equal(stopped.lastExit.reason, "manual stop");
    assert.equal(stopped.lastExit.signal, "SIGTERM");
    assert.deepEqual(launcher.stopCalls, [{ pid: 5000, signal: "SIGTERM" }]);
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager marks records failed when startup reconciliation finds missing process", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const firstLauncher = new FakeProcessLauncher();
    const firstManager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      processLauncher: firstLauncher,
      rustMuleBinaryPath,
    });
    await firstManager.initialize();
    await firstManager.createPlannedInstance({ id: "a" });
    await firstManager.startInstance("a");
    firstLauncher.running.clear();

    const secondManager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      processLauncher: new FakeProcessLauncher(),
      rustMuleBinaryPath,
    });
    await secondManager.initialize();

    const record = await secondManager.getInstance("a");
    assert.equal(record.status, "failed");
    assert.equal(record.currentProcess, undefined);
    assert.match(record.lastError, /startup reconciliation/);
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager monitors reconciled live processes and updates status after exit", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const firstLauncher = new FakeProcessLauncher();
    const firstManager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      processLauncher: firstLauncher,
      reconcilePollMs: 50,
      rustMuleBinaryPath,
    });
    await firstManager.initialize();
    await firstManager.createPlannedInstance({ id: "a" });
    const started = await firstManager.startInstance("a");

    const secondLauncher = new FakeProcessLauncher();
    secondLauncher.running.add(started.currentProcess.pid);
    const secondManager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      processLauncher: secondLauncher,
      reconcilePollMs: 50,
      rustMuleBinaryPath,
    });
    await secondManager.initialize();

    let record = await secondManager.getInstance("a");
    assert.equal(record.status, "running");

    secondLauncher.running.delete(started.currentProcess.pid);
    await new Promise((resolve) => setTimeout(resolve, 120));

    record = await secondManager.getInstance("a");
    assert.equal(record.status, "stopped");
    assert.equal(record.currentProcess, undefined);
    assert.equal(record.lastExit.reason, "process exited after mule-doctor startup reconciliation");
  } finally {
    await tmp.cleanup();
  }
});

test("InstanceManager restarts a running instance with a new pid", async () => {
  const tmp = await makeTempDir();
  try {
    const rustMuleBinaryPath = await writeFakeRustMuleBinary(tmp.dir);
    const launcher = new FakeProcessLauncher();
    const manager = new InstanceManager({
      dataDir: tmp.dir,
      instanceRootDir: join(tmp.dir, "instances"),
      rustMuleBinaryPath,
      processLauncher: launcher,
      stopTimeoutMs: 500,
    });
    await manager.initialize();
    await manager.createPlannedInstance({ id: "a" });
    await manager.startInstance("a");

    const restarted = await manager.restartInstance("a");

    assert.equal(restarted.status, "running");
    assert.equal(restarted.currentProcess.pid, 5001);
    assert.equal(launcher.stopCalls.length, 1);
    assert.equal(launcher.launches.length, 2);
  } finally {
    await tmp.cleanup();
  }
});
