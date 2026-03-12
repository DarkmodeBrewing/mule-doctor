import test from "node:test";
import assert from "node:assert/strict";

import { ManagedInstanceDiagnosticsService } from "../../dist/instances/managedInstanceDiagnostics.js";

class StubInstanceManager {
  constructor(record) {
    this.record = record;
  }

  async getInstance(id) {
    return id === this.record.id ? this.record : null;
  }
}

function buildRecord(overrides = {}) {
  return {
    id: "a",
    status: "running",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    apiHost: "127.0.0.1",
    apiPort: 19000,
    runtime: {
      rootDir: "/data/instances/a",
      configPath: "/data/instances/a/config.toml",
      tokenPath: "/data/instances/a/state/api.token",
      debugTokenPath: "/data/instances/a/state/debug.token",
      logDir: "/data/instances/a/state/logs",
      logPath: "/data/instances/a/state/logs/rust-mule.log",
      stateDir: "/data/instances/a/state",
      sharedDir: "/data/instances/a/shared",
      metadataPath: "/data/instances/a/instance.json",
    },
    ...overrides,
  };
}

test("ManagedInstanceDiagnosticsService reuses client for unchanged instance settings", () => {
  const record = buildRecord();
  const service = new ManagedInstanceDiagnosticsService(new StubInstanceManager(record));

  const left = service.getClientForInstance(record);
  const right = service.getClientForInstance(record);

  assert.equal(left, right);
});

test("ManagedInstanceDiagnosticsService rebuilds client when same id changes endpoint or token paths", () => {
  const original = buildRecord();
  const changed = buildRecord({
    apiPort: 19001,
    runtime: {
      ...original.runtime,
      tokenPath: "/data/instances/a/state/api-next.token",
      debugTokenPath: "/data/instances/a/state/debug-next.token",
    },
  });
  const service = new ManagedInstanceDiagnosticsService(new StubInstanceManager(original));

  const left = service.getClientForInstance(original);
  const right = service.getClientForInstance(changed);

  assert.notEqual(left, right);
});
