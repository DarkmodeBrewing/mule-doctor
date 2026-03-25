import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OperatorConsoleServer } from "../../dist/operatorConsole/server.js";

import {
  StubDiagnosticTargetControl,
  StubManagedInstanceDiagnostics,
  StubManagedInstancePresets,
  StubManagedInstances,
  StubManagedInstanceSurfaceDiagnostics,
  StubOperatorEvents,
  loginAndGetCookie,
  makeTempDir,
} from "./operatorConsoleTestHelpers.mjs";

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
      managedInstancePresets: new StubManagedInstancePresets(),
      operatorEvents,
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
    assert.equal(operatorEvents.events.length, 3);
    assert.equal(operatorEvents.events[1].type, "managed_instance_control_applied");
    assert.match(operatorEvents.events[1].message, /created planned managed instance lab-a/);
    assert.equal(operatorEvents.events[2].target.instanceId, "lab-b");

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
    assert.equal(operatorEvents.events.length, 5);
    assert.match(operatorEvents.events[3].message, /started managed instance lab-a/);
    assert.match(operatorEvents.events[4].message, /started managed instance lab-b/);

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
    assert.equal(operatorEvents.events.length, 7);
    assert.match(operatorEvents.events[5].message, /stopped managed instance lab-a/);

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
    assert.equal(operatorEvents.events.length, 9);
    assert.match(operatorEvents.events[7].message, /restarted managed instance lab-a/);
    assert.match(operatorEvents.events[8].message, /restarted managed instance lab-b/);

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
      managedInstanceSurfaceDiagnostics: new StubManagedInstanceSurfaceDiagnostics(),
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

    const leftSurfaceRes = await fetch(
      `${server.publicAddress()}/api/instances/a/runtime_surface`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(leftSurfaceRes.status, 200);
    const leftSurface = await leftSurfaceRes.json();
    assert.equal(leftSurface.diagnostics.detail.searches[0].searchId, "search-1");

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
