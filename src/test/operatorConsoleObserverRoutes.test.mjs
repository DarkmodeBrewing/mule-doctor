import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OperatorConsoleServer } from "../../dist/operatorConsole/server.js";
import { LlmInvocationGate } from "../../dist/llm/invocationGate.js";

import {
  CapturingInvocationAudit,
  FastResetObserverControl,
  StubDiagnosticTargetControl,
  StubManagedInstanceAnalysis,
  StubManagedInstanceAnalysisUnavailable,
  StubObserverControl,
  StubOperatorEvents,
  ThrowingOperatorEvents,
  loginAndGetCookie,
  makeTempDir,
} from "./operatorConsoleTestHelpers.mjs";

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

test("OperatorConsoleServer rate-limits managed instance analysis", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const audit = new CapturingInvocationAudit();

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      managedInstanceAnalysis: new StubManagedInstanceAnalysis(),
      humanInvocationGate: new LlmInvocationGate(),
      invocationAudit: audit,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const first = await fetch(`${server.publicAddress()}/api/instances/a/analyze`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: server.publicAddress() },
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${server.publicAddress()}/api/instances/a/analyze`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: server.publicAddress() },
    });
    assert.equal(second.status, 429);
    const payload = await second.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, /rate-limited/);
    assert.equal(typeof payload.retryAfterSec, "number");
    assert.equal(audit.records.length, 1);
    assert.equal(audit.records[0].surface, "managed_instance_analysis");
    assert.equal(audit.records[0].finishReason, "rate_limited");

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer does not consume analysis cooldown when no LLM work runs", async () => {
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
      managedInstanceAnalysis: new StubManagedInstanceAnalysisUnavailable(),
      humanInvocationGate: new LlmInvocationGate(),
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const first = await fetch(`${server.publicAddress()}/api/instances/missing/analyze`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: server.publicAddress() },
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${server.publicAddress()}/api/instances/missing/analyze`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: server.publicAddress() },
    });
    assert.equal(second.status, 200);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});

test("OperatorConsoleServer rate-limits manual observer run requests", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    await writeFile(rustLogPath, "", "utf8");
    const audit = new CapturingInvocationAudit();

    const server = new OperatorConsoleServer({
      authToken: "ui-secret",
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: tmp.dir,
      proposalDir: tmp.dir,
      getAppLogs: () => [],
      subscribeToAppLogs: () => () => {},
      observerControl: new FastResetObserverControl(),
      operatorEvents: new StubOperatorEvents(),
      diagnosticTarget: new StubDiagnosticTargetControl(),
      humanInvocationGate: new LlmInvocationGate(),
      invocationAudit: audit,
    });
    await server.start();

    const cookie = await loginAndGetCookie(server.publicAddress());
    const first = await fetch(`${server.publicAddress()}/api/observer/run`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: server.publicAddress(),
      },
      body: "{}",
    });
    assert.equal(first.status, 202);

    const second = await fetch(`${server.publicAddress()}/api/observer/run`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: server.publicAddress(),
      },
      body: "{}",
    });
    assert.equal(second.status, 429);
    const payload = await second.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, /rate-limited/);
    assert.equal(audit.records.length, 1);
    assert.equal(audit.records[0].surface, "manual_observer_run");
    assert.equal(audit.records[0].finishReason, "rate_limited");

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
