import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OperatorConsoleServer } from "../dist/operatorConsole/server.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-console-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

class StubManagedInstances {
  constructor() {
    this.instances = [
      {
        id: "a",
        status: "planned",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19000,
        preset: {
          presetId: "pair",
          prefix: "lab",
        },
        runtime: {
          rootDir: "/data/instances/a",
          configPath: "/data/instances/a/config.toml",
          tokenPath: "/data/instances/a/state/api.token",
          debugTokenPath: "/data/instances/a/state/debug.token",
          logDir: "/data/instances/a/state/logs",
          logPath: "/data/instances/a/state/logs/rust-mule.log",
          stateDir: "/data/instances/a/state",
          metadataPath: "/data/instances/a/instance.json",
        },
      },
      {
        id: "b",
        status: "running",
        createdAt: "2026-03-08T00:10:00.000Z",
        updatedAt: "2026-03-08T00:10:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19001,
        preset: {
          presetId: "pair",
          prefix: "lab",
        },
        currentProcess: {
          pid: 2222,
          command: ["rust-mule"],
          cwd: "/data/instances/b",
          startedAt: "2026-03-08T00:12:00.000Z",
        },
        runtime: {
          rootDir: "/data/instances/b",
          configPath: "/data/instances/b/config.toml",
          tokenPath: "/data/instances/b/state/api.token",
          debugTokenPath: "/data/instances/b/state/debug.token",
          logDir: "/data/instances/b/state/logs",
          logPath: "/data/instances/b/state/logs/rust-mule.log",
          stateDir: "/data/instances/b/state",
          metadataPath: "/data/instances/b/instance.json",
        },
      },
    ];
  }

  async listInstances() {
    return this.instances;
  }

  async createPlannedInstance(input) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.id)) {
      throw new Error(`Invalid managed instance id: ${input.id}`);
    }
    if (this.instances.some((instance) => instance.id === input.id)) {
      throw new Error(`Managed instance already exists: ${input.id}`);
    }
    const instance = {
      ...this.instances[0],
      id: input.id,
      runtime: {
        ...this.instances[0].runtime,
        rootDir: `/data/instances/${input.id}`,
        configPath: `/data/instances/${input.id}/config.toml`,
        tokenPath: `/data/instances/${input.id}/state/api.token`,
        debugTokenPath: `/data/instances/${input.id}/state/debug.token`,
        logDir: `/data/instances/${input.id}/state/logs`,
        logPath: `/data/instances/${input.id}/state/logs/rust-mule.log`,
        stateDir: `/data/instances/${input.id}/state`,
        metadataPath: `/data/instances/${input.id}/instance.json`,
      },
      apiPort: input.apiPort ?? 19001,
      status: "planned",
      updatedAt: "2026-03-08T01:00:00.000Z",
    };
    this.instances.push(instance);
    return instance;
  }

  async startInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "running";
    instance.updatedAt = "2026-03-08T01:10:00.000Z";
    return instance;
  }

  async stopInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "stopped";
    instance.updatedAt = "2026-03-08T01:20:00.000Z";
    return instance;
  }

  async restartInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "running";
    instance.updatedAt = "2026-03-08T01:30:00.000Z";
    return instance;
  }
}

class StubManagedInstanceDiagnostics {
  async getSnapshot(id) {
    if (id !== "a" && id !== "b") {
      throw new Error(`Managed instance not found: ${id}`);
    }
    if (id === "b") {
      return {
        instanceId: "b",
        observedAt: "2026-03-08T02:03:00.000Z",
        available: false,
        reason: "instance is stopped",
      };
    }
    return {
      instanceId: "a",
      observedAt: "2026-03-08T02:00:00.000Z",
      available: true,
      peerCount: 3,
      routingBucketCount: 2,
      lookupStats: { matchPerSent: 0.5, timeoutsPerSent: 0.1 },
      networkHealth: {
        score: 62,
        components: {
          peer_count: 10,
          bucket_balance: 20,
          lookup_success: 50,
          lookup_efficiency: 80,
          error_rate: 70,
        },
      },
    };
  }
}

class StubManagedInstanceAnalysis {
  async analyze(id) {
    if (id !== "a") {
      throw new Error(`Managed instance not found: ${id}`);
    }
    return {
      instanceId: "a",
      analyzedAt: "2026-03-08T02:05:00.000Z",
      available: true,
      summary: "Managed instance is healthy with mild timeout pressure.",
    };
  }
}

class StubDiagnosticTargetControl {
  constructor() {
    this.target = { kind: "external" };
  }

  async getActiveTarget() {
    return this.target;
  }

  async setActiveTarget(target) {
    if (target.kind === "managed_instance" && target.instanceId !== "a") {
      throw new Error(`Managed instance not found: ${target.instanceId}`);
    }
    this.target =
      target.kind === "managed_instance"
        ? { kind: "managed_instance", instanceId: target.instanceId }
        : { kind: "external" };
    return this.target;
  }
}

class StubObserverControl {
  constructor() {
    this.status = {
      started: true,
      cycleInFlight: false,
      intervalMs: 300000,
      currentCycleStartedAt: undefined,
      currentCycleTarget: undefined,
    };
  }

  getStatus() {
    return this.status;
  }

  triggerRunNow() {
    if (this.status.cycleInFlight) {
      return { accepted: false, reason: "observer cycle already in progress" };
    }
    this.status = {
      ...this.status,
      cycleInFlight: true,
      currentCycleStartedAt: "2026-03-08T02:10:00.000Z",
      currentCycleTarget: { kind: "external" },
    };
    return { accepted: true };
  }
}

class StubOperatorEvents {
  constructor() {
    this.events = [
      {
        timestamp: "2026-03-08T02:00:00.000Z",
        type: "diagnostic_target_changed",
        message: "Active diagnostic target changed to managed instance a",
        target: { kind: "managed_instance", instanceId: "a" },
        actor: "operator_console",
      },
    ];
  }

  async listRecent(limit = 20) {
    return this.events.slice(-limit);
  }

  async append(event) {
    this.events.push({
      timestamp: "2026-03-08T02:10:00.000Z",
      ...event,
    });
  }
}

class ThrowingOperatorEvents {
  async listRecent() {
    return [];
  }

  async append() {
    throw new Error("operator events unavailable");
  }
}

class StubManagedInstancePresets {
  constructor() {
    this.startedPrefixes = [];
    this.appliedPrefixes = new Set();
  }

  listPresets() {
    return [
      {
        id: "pair",
        name: "Pair",
        description: "Two managed instances",
        nodes: [{ suffix: "a" }, { suffix: "b" }],
      },
      {
        id: "trio",
        name: "Trio",
        description: "Three managed instances",
        nodes: [{ suffix: "a" }, { suffix: "b" }, { suffix: "c" }],
      },
    ];
  }

  async applyPreset(input) {
    if (input.presetId !== "pair" && input.presetId !== "trio") {
      throw new Error(`Managed instance preset not found: ${input.presetId}`);
    }
    if (!input.prefix) {
      throw new Error("Invalid managed instance preset prefix: ");
    }
    if (this.appliedPrefixes.has(input.prefix)) {
      throw new Error(`Managed instance preset prefix already exists: ${input.prefix}`);
    }
    this.appliedPrefixes.add(input.prefix);
    const ids =
      input.presetId === "pair"
        ? [`${input.prefix}-a`, `${input.prefix}-b`]
        : [`${input.prefix}-a`, `${input.prefix}-b`, `${input.prefix}-c`];
    return {
      presetId: input.presetId,
      prefix: input.prefix,
      instances: ids.map((id, index) => ({
        id,
        status: "planned",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19100 + index,
        preset: {
          presetId: input.presetId,
          prefix: input.prefix,
        },
        runtime: {
          rootDir: `/data/instances/${id}`,
          configPath: `/data/instances/${id}/config.toml`,
          tokenPath: `/data/instances/${id}/state/api.token`,
          debugTokenPath: `/data/instances/${id}/state/debug.token`,
          logDir: `/data/instances/${id}/state/logs`,
          logPath: `/data/instances/${id}/state/logs/rust-mule.log`,
          stateDir: `/data/instances/${id}/state`,
          metadataPath: `/data/instances/${id}/instance.json`,
        },
      })),
    };
  }

  async startPreset(prefix) {
    if (!prefix) {
      throw new Error("Invalid managed instance preset prefix: ");
    }
    if (prefix !== "lab") {
      throw new Error(`Managed instance preset group not found: ${prefix}`);
    }
    this.startedPrefixes.push(prefix);
    return {
      presetId: "pair",
      prefix,
      action: "start",
      instances: ["lab-a", "lab-b"].map((id, index) => ({
        id,
        status: "running",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:10:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19100 + index,
        preset: {
          presetId: "pair",
          prefix,
        },
        currentProcess: {
          pid: 5001 + index,
          command: ["rust-mule"],
          cwd: `/data/instances/${id}`,
          startedAt: "2026-03-09T00:10:00.000Z",
        },
        runtime: {
          rootDir: `/data/instances/${id}`,
          configPath: `/data/instances/${id}/config.toml`,
          tokenPath: `/data/instances/${id}/state/api.token`,
          debugTokenPath: `/data/instances/${id}/state/debug.token`,
          logDir: `/data/instances/${id}/state/logs`,
          logPath: `/data/instances/${id}/state/logs/rust-mule.log`,
          stateDir: `/data/instances/${id}/state`,
          metadataPath: `/data/instances/${id}/instance.json`,
        },
      })),
      failures: [],
    };
  }

  async stopPreset(prefix) {
    if (prefix !== "lab") {
      throw new Error(`Managed instance preset group not found: ${prefix}`);
    }
    return {
      presetId: "pair",
      prefix,
      action: "stop",
      instances: ["lab-a", "lab-b"].map((id, index) => ({
        id,
        status: "stopped",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:20:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19100 + index,
        preset: {
          presetId: "pair",
          prefix,
        },
        runtime: {
          rootDir: `/data/instances/${id}`,
          configPath: `/data/instances/${id}/config.toml`,
          tokenPath: `/data/instances/${id}/state/api.token`,
          debugTokenPath: `/data/instances/${id}/state/debug.token`,
          logDir: `/data/instances/${id}/state/logs`,
          logPath: `/data/instances/${id}/state/logs/rust-mule.log`,
          stateDir: `/data/instances/${id}/state`,
          metadataPath: `/data/instances/${id}/instance.json`,
        },
      })),
      failures: [],
    };
  }

  async restartPreset(prefix) {
    if (prefix !== "lab") {
      throw new Error(`Managed instance preset group not found: ${prefix}`);
    }
    return {
      presetId: "pair",
      prefix,
      action: "restart",
      instances: ["lab-a", "lab-b"].map((id, index) => ({
        id,
        status: "running",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:30:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19100 + index,
        preset: {
          presetId: "pair",
          prefix,
        },
        currentProcess: {
          pid: 5101 + index,
          command: ["rust-mule"],
          cwd: `/data/instances/${id}`,
          startedAt: "2026-03-09T00:30:00.000Z",
        },
        runtime: {
          rootDir: `/data/instances/${id}`,
          configPath: `/data/instances/${id}/config.toml`,
          tokenPath: `/data/instances/${id}/state/api.token`,
          debugTokenPath: `/data/instances/${id}/state/debug.token`,
          logDir: `/data/instances/${id}/state/logs`,
          logPath: `/data/instances/${id}/state/logs/rust-mule.log`,
          stateDir: `/data/instances/${id}/state`,
          metadataPath: `/data/instances/${id}/instance.json`,
        },
      })),
      failures: [],
    };
  }
}

test("OperatorConsoleServer reports 501 for instance detail routes when control is unavailable", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstanceDiagnostics: new StubManagedInstanceDiagnostics(),
      managedInstanceAnalysis: new StubManagedInstanceAnalysis(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const detailRes = await fetch(`${server.publicAddress()}/api/instances/a`, {
      headers: { Cookie: cookie },
    });
    assert.equal(detailRes.status, 501);

    const logsRes = await fetch(`${server.publicAddress()}/api/instances/a/logs`, {
      headers: { Cookie: cookie },
    });
    assert.equal(logsRes.status, 501);

    const diagnosticsRes = await fetch(`${server.publicAddress()}/api/instances/a/diagnostics`, {
      headers: { Cookie: cookie },
    });
    assert.equal(diagnosticsRes.status, 200);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer gets and sets the active diagnostic target", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstances: new StubManagedInstances(),
      diagnosticTarget: new StubDiagnosticTargetControl(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const getRes = await fetch(`${server.publicAddress()}/api/observer/target`, {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes.status, 200);
    assert.deepEqual(await getRes.json(), {
      ok: true,
      target: { kind: "external" },
    });

    const setRes = await fetch(`${server.publicAddress()}/api/observer/target`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: server.publicAddress(),
      },
      body: JSON.stringify({ kind: "managed_instance", instanceId: "a" }),
    });
    assert.equal(setRes.status, 200);
    assert.deepEqual(await setRes.json(), {
      ok: true,
      target: { kind: "managed_instance", instanceId: "a" },
    });

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer returns operator event history", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      operatorEvents: new StubOperatorEvents(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(`${server.publicAddress()}/api/operator/events?limit=10`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0].type, "diagnostic_target_changed");

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer lists and applies managed instance presets", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstancePresets: new StubManagedInstancePresets(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const listRes = await fetch(`${server.publicAddress()}/api/instance-presets`, {
      headers: { Cookie: cookie },
    });
    assert.equal(listRes.status, 200);
    const listPayload = await listRes.json();
    assert.equal(listPayload.presets.length, 2);
    assert.equal(listPayload.presets[0].description, "Two managed instances");
    assert.deepEqual(
      listPayload.presets[0].nodes.map((node) => node.suffix),
      ["a", "b"],
    );

    const applyRes = await fetch(`${server.publicAddress()}/api/instance-presets/apply`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.publicAddress(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ presetId: "pair", prefix: "lab" }),
    });
    assert.equal(applyRes.status, 201);
    const applyPayload = await applyRes.json();
    assert.deepEqual(
      applyPayload.applied.instances.map((instance) => instance.id),
      ["lab-a", "lab-b"],
    );

    const invalidPresetRes = await fetch(`${server.publicAddress()}/api/instance-presets/apply`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.publicAddress(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ presetId: "missing", prefix: "lab" }),
    });
    assert.equal(invalidPresetRes.status, 404);

    const duplicatePrefixRes = await fetch(`${server.publicAddress()}/api/instance-presets/apply`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.publicAddress(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ presetId: "trio", prefix: "lab" }),
    });
    assert.equal(duplicatePrefixRes.status, 400);

    const startPresetRes = await fetch(`${server.publicAddress()}/api/instance-presets/lab/start`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.publicAddress(),
      },
    });
    assert.equal(startPresetRes.status, 200);
    const startPresetPayload = await startPresetRes.json();
    assert.equal(startPresetPayload.result.prefix, "lab");
    assert.equal(startPresetPayload.result.action, "start");
    assert.equal(startPresetPayload.result.instances.length, 2);
    assert.equal(startPresetPayload.started.action, "start");

    const stopPresetRes = await fetch(`${server.publicAddress()}/api/instance-presets/lab/stop`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.publicAddress(),
      },
    });
    assert.equal(stopPresetRes.status, 200);
    const stopPresetPayload = await stopPresetRes.json();
    assert.equal(stopPresetPayload.result.action, "stop");

    const restartPresetRes = await fetch(
      `${server.publicAddress()}/api/instance-presets/lab/restart`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: server.publicAddress(),
        },
      },
    );
    assert.equal(restartPresetRes.status, 200);
    const restartPresetPayload = await restartPresetRes.json();
    assert.equal(restartPresetPayload.result.action, "restart");

    const malformedPrefixRes = await fetch(
      `${server.publicAddress()}/api/instance-presets/%E0/start`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: server.publicAddress(),
        },
      },
    );
    assert.equal(malformedPrefixRes.status, 400);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer compares two managed instances", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstances: new StubManagedInstances(),
      managedInstanceDiagnostics: new StubManagedInstanceDiagnostics(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(
      `${server.publicAddress()}/api/instances/compare?left=a&right=b`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.comparison.left.instance.id, "a");
    assert.equal(payload.comparison.right.instance.id, "b");
    assert.equal(payload.comparison.left.snapshot.available, true);
    assert.equal(payload.comparison.right.snapshot.available, false);
    assert.equal("logPath" in payload.comparison.left.instance.runtime, false);

    const invalidRes = await fetch(
      `${server.publicAddress()}/api/instances/compare?left=a&right=a`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(invalidRes.status, 400);

    const missingParamRes = await fetch(
      `${server.publicAddress()}/api/instances/compare?left=a`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(missingParamRes.status, 400);

    const missingInstanceRes = await fetch(
      `${server.publicAddress()}/api/instances/compare?left=a&right=missing`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(missingInstanceRes.status, 404);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer reports 501 for managed instance comparison when unavailable", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const res = await fetch(
      `${server.publicAddress()}/api/instances/compare?left=a&right=b`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(res.status, 501);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer triggers observer run-now and reports scheduler status", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const observerControl = new StubObserverControl();
    const operatorEvents = new StubOperatorEvents();
    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      observerControl,
      operatorEvents,
      diagnosticTarget: new StubDiagnosticTargetControl(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const runRes = await fetch(`${server.publicAddress()}/api/observer/run`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: server.publicAddress(),
      },
      body: "{}",
    });
    assert.equal(runRes.status, 202);
    const runPayload = await runRes.json();
    assert.equal(runPayload.ok, true);
    assert.equal(runPayload.scheduler.cycleInFlight, true);
    assert.equal(runPayload.scheduler.currentCycleStartedAt, "2026-03-08T02:10:00.000Z");
    assert.deepEqual(runPayload.scheduler.currentCycleTarget, { kind: "external" });
    assert.equal(operatorEvents.events.length, 2);
    assert.equal(operatorEvents.events[1].type, "observer_run_requested");

    const secondRunRes = await fetch(`${server.publicAddress()}/api/observer/run`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: server.publicAddress(),
      },
      body: "{}",
    });
    assert.equal(secondRunRes.status, 409);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer still returns 202 when run-now event logging fails", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const observerControl = new StubObserverControl();
    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      observerControl,
      operatorEvents: new ThrowingOperatorEvents(),
      diagnosticTarget: new StubDiagnosticTargetControl(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const runRes = await fetch(`${server.publicAddress()}/api/observer/run`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: server.publicAddress(),
      },
      body: "{}",
    });
    assert.equal(runRes.status, 202);
    const runPayload = await runRes.json();
    assert.equal(runPayload.ok, true);
    assert.equal(runPayload.scheduler.cycleInFlight, true);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

async function loginAndGetCookie(baseUrl) {
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: "ui-secret" }),
    redirect: "manual",
  });
  assert.equal(loginRes.status, 303);
  const cookie = loginRes.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie;
}

async function readSseUntil(stream, predicate, timeoutMs = 2000) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("timed out waiting for SSE payload")), remainingMs);
        }),
      ]);
      if (chunk.done) {
        throw new Error("SSE stream closed before matching payload");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const lines = frame
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith(":"));
        const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
        const dataLine = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim();
        if (!event || !dataLine) continue;
        const payload = JSON.parse(dataLine);
        if (predicate({ event, payload })) {
          return { event, payload };
        }
      }
    }
    throw new Error("timed out waiting for SSE payload");
  } finally {
    reader.releaseLock();
  }
}

test("OperatorConsoleServer requires authentication for UI and API endpoints", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    const llmDir = join(tmp.dir, "llm");
    const proposalDir = join(tmp.dir, "proposals");
    await mkdir(llmDir, { recursive: true });
    await mkdir(proposalDir, { recursive: true });
    await writeFile(rustLogPath, "line1\nline2\n", "utf8");
    await writeFile(join(llmDir, "LLM_2026-03-08.log"), "token=secret\npayload=ok\n", "utf8");
    await writeFile(
      join(proposalDir, "proposal-2026-03-08.patch"),
      "diff --git a/src/a.rs b/src/a.rs\n",
      "utf8",
    );

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: llmDir,
      proposalDir,
      getAppLogs: () => ['{"msg":"api_key=topsecret"}'],
      getRuntimeState: async () => ({
        activeDiagnosticTarget: { kind: "managed_instance", instanceId: "a" },
        lastObservedTarget: { kind: "managed_instance", instanceId: "a" },
        lastRun: "2026-03-08T03:00:00.000Z",
        lastHealthScore: 0,
        currentCycleStartedAt: undefined,
        currentCycleTarget: undefined,
        lastCycleStartedAt: "2026-03-08T02:58:00.000Z",
        lastCycleCompletedAt: "2026-03-08T03:00:00.000Z",
        lastCycleDurationMs: 120000,
        lastCycleOutcome: "unavailable",
        lastTargetFailureReason: "Managed instance a is stopped",
      }),
      observerControl: {
        getStatus: () => ({
          started: true,
          cycleInFlight: false,
          intervalMs: 300000,
          currentCycleStartedAt: undefined,
          currentCycleTarget: undefined,
        }),
        triggerRunNow: () => ({ accepted: true }),
      },
      subscribeToAppLogs: () => () => {},
      rustMuleStreamPollMs: 25,
      managedInstances: new StubManagedInstances(),
      managedInstanceDiagnostics: new StubManagedInstanceDiagnostics(),
      managedInstanceAnalysis: new StubManagedInstanceAnalysis(),
      operatorEvents: new StubOperatorEvents(),
    });
    await server.start();

    const baseUrl = server.publicAddress();

    const rootRes = await fetch(`${baseUrl}/`);
    assert.equal(rootRes.status, 200);
    assert.match(await rootRes.text(), /Authentication required/);

    const loginScriptRes = await fetch(`${baseUrl}/static/operatorConsole/login.js`);
    assert.equal(loginScriptRes.status, 200);
    assert.equal(loginScriptRes.headers.get("content-type"), "application/javascript; charset=utf-8");

    const unauthorizedIndexHtmlRes = await fetch(`${baseUrl}/static/operatorConsole/index.html`);
    assert.equal(unauthorizedIndexHtmlRes.status, 401);

    const unauthorizedDirectoryRes = await fetch(`${baseUrl}/static/operatorConsole/.`);
    assert.equal(unauthorizedDirectoryRes.status, 401);

    const unauthorizedHealthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(unauthorizedHealthRes.status, 401);

    const unauthorizedInstancesRes = await fetch(`${baseUrl}/api/instances`);
    assert.equal(unauthorizedInstancesRes.status, 401);

    const unauthorizedEventsRes = await fetch(`${baseUrl}/api/operator/events`);
    assert.equal(unauthorizedEventsRes.status, 401);

    const cookie = await loginAndGetCookie(baseUrl);

    const healthRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Cookie: cookie },
    });
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get("cache-control"), "no-store");
    assert.equal(healthRes.headers.get("x-content-type-options"), "nosniff");
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.deepEqual(health.observer, {
      activeDiagnosticTarget: { kind: "managed_instance", instanceId: "a" },
      lastObservedTarget: { kind: "managed_instance", instanceId: "a" },
      lastRun: "2026-03-08T03:00:00.000Z",
      lastHealthScore: 0,
      lastCycleStartedAt: "2026-03-08T02:58:00.000Z",
      lastCycleCompletedAt: "2026-03-08T03:00:00.000Z",
      lastCycleDurationMs: 120000,
      lastCycleOutcome: "unavailable",
      lastTargetFailureReason: "Managed instance a is stopped",
    });
    assert.deepEqual(health.scheduler, {
      started: true,
      cycleInFlight: false,
      intervalMs: 300000,
      lastCycleStartedAt: "2026-03-08T02:58:00.000Z",
      lastCycleCompletedAt: "2026-03-08T03:00:00.000Z",
      lastCycleDurationMs: 120000,
      lastCycleOutcome: "unavailable",
    });

    const operatorEventsRes = await fetch(`${baseUrl}/api/operator/events`, {
      headers: { Cookie: cookie },
    });
    assert.equal(operatorEventsRes.status, 200);
    const operatorEvents = await operatorEventsRes.json();
    assert.equal(operatorEvents.events.length, 1);
    assert.equal(operatorEvents.events[0].type, "diagnostic_target_changed");

    const staticUiRes = await fetch(`${baseUrl}/static/operatorConsole/app.js`, {
      headers: { Cookie: cookie },
    });
    assert.equal(staticUiRes.status, 200);
    assert.equal(staticUiRes.headers.get("content-type"), "application/javascript; charset=utf-8");
    const staticUiScript = await staticUiRes.text();
    assert.match(staticUiScript, /Cycle succeeded/);
    assert.match(staticUiScript, /event-badge/);
    assert.match(staticUiScript, /operator-event-grouping-toggle/);
    assert.match(staticUiScript, /Expand/);

    const rootPageRes = await fetch(`${baseUrl}/`, {
      headers: { Cookie: cookie },
    });
    assert.equal(rootPageRes.status, 200);
    const rootHtml = await rootPageRes.text();
    assert.match(rootHtml, /instance-preset-help/);
    assert.match(rootHtml, /operator-timeline-card/);
    assert.match(rootHtml, /operator-event-group-filter/);
    assert.match(rootHtml, /operator-event-instance-filter/);
    assert.match(rootHtml, /operator-event-type-filter/);
    assert.match(rootHtml, /operator-event-grouping-toggle/);

    const authorizedIndexHtmlRes = await fetch(`${baseUrl}/static/operatorConsole/index.html`, {
      headers: { Cookie: cookie },
    });
    assert.equal(authorizedIndexHtmlRes.status, 404);

    const authorizedDirectoryRes = await fetch(`${baseUrl}/static/operatorConsole/.`, {
      headers: { Cookie: cookie },
    });
    assert.equal(authorizedDirectoryRes.status, 404);

    const appRes = await fetch(`${baseUrl}/api/logs/app?lines=10`, {
      headers: { Cookie: cookie },
    });
    assert.equal(appRes.status, 200);
    const appLogs = await appRes.json();
    assert.equal(appLogs.lines[0].includes("[redacted]"), true);

    const instancesRes = await fetch(`${baseUrl}/api/instances`, {
      headers: { Cookie: cookie },
    });
    assert.equal(instancesRes.status, 200);
    const instances = await instancesRes.json();
    assert.equal(instances.instances.length, 2);
    assert.equal(instances.instances[0].id, "a");

    const instanceDetailRes = await fetch(`${baseUrl}/api/instances/a`, {
      headers: { Cookie: cookie },
    });
    assert.equal(instanceDetailRes.status, 200);
    const instanceDetail = await instanceDetailRes.json();
    assert.equal(instanceDetail.instance.id, "a");

    const instanceLogsRes = await fetch(`${baseUrl}/api/instances/a/logs?lines=10`, {
      headers: { Cookie: cookie },
    });
    assert.equal(instanceLogsRes.status, 200);
    const instanceLogs = await instanceLogsRes.json();
    assert.equal(Array.isArray(instanceLogs.lines), true);
    assert.equal("logPath" in instanceLogs.instance, false);

    const invalidLinesRes = await fetch(`${baseUrl}/api/instances/a/logs?lines=not-a-number`, {
      headers: { Cookie: cookie },
    });
    assert.equal(invalidLinesRes.status, 200);
    const invalidLines = await invalidLinesRes.json();
    assert.equal(Array.isArray(invalidLines.lines), true);

    const outOfRangeLinesRes = await fetch(`${baseUrl}/api/instances/a/logs?lines=999999`, {
      headers: { Cookie: cookie },
    });
    assert.equal(outOfRangeLinesRes.status, 200);
    const outOfRangeLines = await outOfRangeLinesRes.json();
    assert.equal(Array.isArray(outOfRangeLines.lines), true);

    const diagnosticsRes = await fetch(`${baseUrl}/api/instances/a/diagnostics`, {
      headers: { Cookie: cookie },
    });
    assert.equal(diagnosticsRes.status, 200);
    const diagnostics = await diagnosticsRes.json();
    assert.equal(diagnostics.snapshot.instanceId, "a");
    assert.equal(diagnostics.snapshot.available, true);

    const analysisRes = await fetch(`${baseUrl}/api/instances/a/analyze`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    assert.equal(analysisRes.status, 200);
    const analysis = await analysisRes.json();
    assert.equal(analysis.analysis.instanceId, "a");
    assert.match(analysis.analysis.summary, /healthy/);

    const createRes = await fetch(`${baseUrl}/api/instances`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: baseUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "c", apiPort: 19002 }),
    });
    assert.equal(createRes.status, 201);

    const startRes = await fetch(`${baseUrl}/api/instances/a/start`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    assert.equal(startRes.status, 200);
    const started = await startRes.json();
    assert.equal(started.instance.status, "running");

    const stopRes = await fetch(`${baseUrl}/api/instances/a/stop`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    assert.equal(stopRes.status, 200);

    const crossOriginRes = await fetch(`${baseUrl}/api/instances/a/start`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://evil.example" },
    });
    assert.equal(crossOriginRes.status, 403);

    const invalidCreateRes = await fetch(`${baseUrl}/api/instances`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: baseUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "../bad" }),
    });
    assert.equal(invalidCreateRes.status, 400);

    const missingInstanceRes = await fetch(`${baseUrl}/api/instances/missing/start`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    assert.equal(missingInstanceRes.status, 404);

    const llmListRes = await fetch(`${baseUrl}/api/llm/logs`, {
      headers: { Cookie: cookie },
    });
    assert.equal(llmListRes.status, 200);
    const llmList = await llmListRes.json();
    assert.equal(llmList.files.length, 1);
    assert.equal(llmList.files[0].name, "LLM_2026-03-08.log");

    const proposalListRes = await fetch(`${baseUrl}/api/proposals`, {
      headers: { Cookie: cookie },
    });
    assert.equal(proposalListRes.status, 200);
    const proposals = await proposalListRes.json();
    assert.equal(proposals.files.length, 1);
    assert.equal(proposals.files[0].name, "proposal-2026-03-08.patch");

    const invalidPathRes = await fetch(`${baseUrl}/api/proposals/%2e%2e%2fsecret.txt`, {
      headers: { Cookie: cookie },
    });
    assert.equal(invalidPathRes.status, 400);

    const invalidDriveLikePathRes = await fetch(`${baseUrl}/api/proposals/D%3Asecret.patch`, {
      headers: { Cookie: cookie },
    });
    assert.equal(invalidDriveLikePathRes.status, 400);

    const malformedCookieHealthRes = await fetch(`${baseUrl}/api/health`, {
      headers: { Cookie: "mule_doctor_ui_token=%E0%A4%A" },
    });
    assert.equal(malformedCookieHealthRes.status, 401);

    const unauthenticatedLogoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      redirect: "manual",
    });
    assert.equal(unauthenticatedLogoutRes.status, 401);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer streams app logs over SSE", async () => {
  const tmp = await makeTempDir();
  const appLogListeners = new Set();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => ["boot line"],
      subscribeToAppLogs: (listener) => {
        appLogListeners.add(listener);
        return () => {
          appLogListeners.delete(listener);
        };
      },
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const streamRes = await fetch(`${server.publicAddress()}/api/stream/app?lines=10`, {
      headers: { Cookie: cookie },
    });
    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers.get("content-type"), "text/event-stream; charset=utf-8");

    const snapshot = await readSseUntil(streamRes.body, ({ event }) => event === "snapshot");
    assert.deepEqual(snapshot.payload.lines, ["boot line"]);

    for (const listener of appLogListeners) {
      listener('authorization":"Bearer topsecret"');
    }

    const lineEvent = await readSseUntil(
      streamRes.body,
      ({ event, payload }) => event === "line" && payload.line.includes("[redacted]"),
    );
    assert.equal(lineEvent.payload.line.includes("[redacted]"), true);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer streams rust-mule log updates over SSE", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "start line\n", "utf8");

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      rustMuleStreamPollMs: 25,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const streamRes = await fetch(`${server.publicAddress()}/api/stream/rust-mule?lines=10`, {
      headers: { Cookie: cookie },
    });
    assert.equal(streamRes.status, 200);

    const snapshot = await readSseUntil(streamRes.body, ({ event }) => event === "snapshot");
    assert.deepEqual(snapshot.payload.lines, ["start line"]);

    await appendFile(rustLogPath, 'token=secret-follower\nnext line\n', "utf8");
    const lineEvent = await readSseUntil(
      streamRes.body,
      ({ event, payload }) => event === "line" && payload.line.includes("[redacted]"),
    );
    assert.equal(lineEvent.payload.line.includes("[redacted]"), true);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});
