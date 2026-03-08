import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../dist/storage/runtimeStore.js";
import { DiagnosticTargetService } from "../dist/instances/diagnosticTargetService.js";
import { OperatorEventLog } from "../dist/operatorConsole/operatorEventLog.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-target-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

class StubInstanceManager {
  constructor() {
    this.instances = new Map([["a", { id: "a" }]]);
  }

  async getInstance(id) {
    return this.instances.get(id);
  }
}

test("DiagnosticTargetService defaults to external target", async () => {
  const tmp = await makeTempDir();
  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const service = new DiagnosticTargetService({ runtimeStore });
    assert.deepEqual(await service.getActiveTarget(), { kind: "external" });
  } finally {
    await tmp.cleanup();
  }
});

test("DiagnosticTargetService persists managed instance targets", async () => {
  const tmp = await makeTempDir();
  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const service = new DiagnosticTargetService({
      runtimeStore,
      instanceManager: new StubInstanceManager(),
      eventLog: new OperatorEventLog(runtimeStore),
    });
    const target = await service.setActiveTarget({
      kind: "managed_instance",
      instanceId: "a",
    });

    assert.deepEqual(target, { kind: "managed_instance", instanceId: "a" });
    assert.deepEqual(await service.getActiveTarget(), target);
    assert.deepEqual((await runtimeStore.loadState()).activeDiagnosticTarget, target);
    const events = await runtimeStore.loadEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "diagnostic_target_changed");
    assert.deepEqual(events[0].target, target);
    assert.equal(events[0].message, "Active diagnostic target changed to managed instance a");
  } finally {
    await tmp.cleanup();
  }
});

test("DiagnosticTargetService rejects missing managed instance targets", async () => {
  const tmp = await makeTempDir();
  try {
    const runtimeStore = new RuntimeStore({ dataDir: tmp.dir });
    await runtimeStore.initialize();

    const service = new DiagnosticTargetService({
      runtimeStore,
      instanceManager: new StubInstanceManager(),
    });

    await assert.rejects(
      service.setActiveTarget({ kind: "managed_instance", instanceId: "missing" }),
      /Managed instance not found: missing/,
    );
  } finally {
    await tmp.cleanup();
  }
});
