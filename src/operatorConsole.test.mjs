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
    if (id !== "a") {
      throw new Error(`Managed instance not found: ${id}`);
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
    this.status = { started: true, cycleInFlight: false, intervalMs: 300000 };
  }

  getStatus() {
    return this.status;
  }

  triggerRunNow() {
    if (this.status.cycleInFlight) {
      return { accepted: false, reason: "observer cycle already in progress" };
    }
    this.status = { ...this.status, cycleInFlight: true };
    return { accepted: true };
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

test("OperatorConsoleServer triggers observer run-now and reports scheduler status", async () => {
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
        lastTargetFailureReason: "Managed instance a is stopped",
      }),
      observerControl: {
        getStatus: () => ({ started: true, cycleInFlight: false, intervalMs: 300000 }),
        triggerRunNow: () => ({ accepted: true }),
      },
      subscribeToAppLogs: () => () => {},
      rustMuleStreamPollMs: 25,
      managedInstances: new StubManagedInstances(),
      managedInstanceDiagnostics: new StubManagedInstanceDiagnostics(),
      managedInstanceAnalysis: new StubManagedInstanceAnalysis(),
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
      lastTargetFailureReason: "Managed instance a is stopped",
    });
    assert.deepEqual(health.scheduler, {
      started: true,
      cycleInFlight: false,
      intervalMs: 300000,
    });

    const staticUiRes = await fetch(`${baseUrl}/static/operatorConsole/app.js`, {
      headers: { Cookie: cookie },
    });
    assert.equal(staticUiRes.status, 200);
    assert.equal(staticUiRes.headers.get("content-type"), "application/javascript; charset=utf-8");

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
    assert.equal(instances.instances.length, 1);
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
      body: JSON.stringify({ id: "b", apiPort: 19002 }),
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
