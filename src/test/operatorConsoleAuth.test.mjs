import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OperatorConsoleServer } from "../../dist/operatorConsole/server.js";

import {
  StubManagedInstanceAnalysis,
  StubManagedInstanceDiagnostics,
  StubManagedInstances,
  StubManagedInstanceSurfaceDiagnostics,
  StubOperatorEvents,
  loginAndGetCookie,
  makeTempDir,
} from "./operatorConsoleTestHelpers.mjs";

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
    const operatorEventsStore = new StubOperatorEvents();

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
      managedInstanceSurfaceDiagnostics: new StubManagedInstanceSurfaceDiagnostics(),
      managedInstanceAnalysis: new StubManagedInstanceAnalysis(),
      operatorEvents: operatorEventsStore,
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
    assert.match(staticUiScript, /from "\.\/constants\.js"/);
    assert.match(staticUiScript, /from "\.\/timeline\.js"/);
    assert.match(staticUiScript, /from "\.\/instances\.js"/);
    assert.match(staticUiScript, /from "\.\/discoverability\.js"/);

    const instancesModuleRes = await fetch(`${baseUrl}/static/operatorConsole/instances.js`, {
      headers: { Cookie: cookie },
    });
    assert.equal(instancesModuleRes.status, 200);
    const instancesModule = await instancesModuleRes.text();
    assert.match(instancesModule, /confirmAction/);
    assert.match(instancesModule, /instanceSurfaceView/);
    assert.match(instancesModule, /instanceWorkflowActions/);
    assert.match(instancesModule, /renderSelectedControlAvailability/);

    const instanceViewsModuleRes = await fetch(`${baseUrl}/static/operatorConsole/instanceViews.js`, {
      headers: { Cookie: cookie },
    });
    assert.equal(instanceViewsModuleRes.status, 200);
    const instanceViewsModule = await instanceViewsModuleRes.text();
    assert.match(instanceViewsModule, /action-context/);

    const timelineModuleRes = await fetch(`${baseUrl}/static/operatorConsole/timeline.js`, {
      headers: { Cookie: cookie },
    });
    assert.equal(timelineModuleRes.status, 200);
    const timelineModule = await timelineModuleRes.text();
    assert.match(timelineModule, /from "\.\/timelineEvents\.js"/);
    assert.match(timelineModule, /from "\.\/timelineFilters\.js"/);
    assert.match(timelineModule, /createTimelineController/);

    const timelineEventsModuleRes = await fetch(`${baseUrl}/static/operatorConsole/timelineEvents.js`, {
      headers: { Cookie: cookie },
    });
    assert.equal(timelineEventsModuleRes.status, 200);
    const timelineEventsModule = await timelineEventsModuleRes.text();
    assert.match(timelineEventsModule, /Cycle succeeded/);
    assert.match(timelineEventsModule, /event-badge/);
    assert.match(timelineEventsModule, /Expand/);

    const timelineFiltersModuleRes = await fetch(
      `${baseUrl}/static/operatorConsole/timelineFilters.js`,
      {
        headers: { Cookie: cookie },
      },
    );
    assert.equal(timelineFiltersModuleRes.status, 200);
    const timelineFiltersModule = await timelineFiltersModuleRes.text();
    assert.match(timelineFiltersModule, /operator-event-grouping-toggle/);
    assert.match(timelineFiltersModule, /operator-event-signal-failures/);

    const discoverabilityModuleRes = await fetch(
      `${baseUrl}/static/operatorConsole/discoverability.js`,
      {
        headers: { Cookie: cookie },
      },
    );
    assert.equal(discoverabilityModuleRes.status, 200);
    const discoverabilityModule = await discoverabilityModuleRes.text();
    assert.match(discoverabilityModule, /createDiscoverabilityController/);
    assert.match(discoverabilityModule, /discoverability-results/);
    assert.match(discoverabilityModule, /discoverability-summary/);
    assert.match(discoverabilityModule, /search-health-results/);
    assert.match(discoverabilityModule, /search-health-summary/);
    assert.match(discoverabilityModule, /llm-invocation-results/);
    assert.match(discoverabilityModule, /llm-invocation-summary/);

    const constantsModuleRes = await fetch(`${baseUrl}/static/operatorConsole/constants.js`, {
      headers: { Cookie: cookie },
    });
    assert.equal(constantsModuleRes.status, 200);
    const constantsModule = await constantsModuleRes.text();
    assert.match(constantsModule, /OPERATOR_EVENT_VIEW_PRESETS/);

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
    assert.match(rootHtml, /operator-event-signal-targets/);
    assert.match(rootHtml, /operator-event-signal-runs/);
    assert.match(rootHtml, /operator-event-signal-failures/);
    assert.match(rootHtml, /operator-event-grouping-toggle/);
    assert.match(rootHtml, /operator-view-failures/);
    assert.match(rootHtml, /operator-view-targeting/);
    assert.match(rootHtml, /operator-view-runs/);
    assert.match(rootHtml, /selected-instance-feedback/);
    assert.match(rootHtml, /selected-instance-action-summary/);
    assert.match(rootHtml, /compare-search-state/);
    assert.match(rootHtml, /compare-publish-only/);
    assert.match(rootHtml, /instance-compare-summary/);
    assert.match(rootHtml, /instance-compare-left-surface/);
    assert.match(rootHtml, /instance-runtime-summary/);
    assert.match(rootHtml, /instance-runtime-highlights/);
    assert.match(rootHtml, /instance-runtime-publish-note/);
    assert.match(rootHtml, /instance-runtime-surface-summary/);
    assert.match(rootHtml, /instance-runtime-search-threads/);
    assert.match(rootHtml, /instance-runtime-publish-files/);
    assert.match(rootHtml, /instance-compare-publish-note/);
    assert.match(rootHtml, /instance-runtime-diagnostics/);
    assert.match(rootHtml, /refresh-discoverability-results/);
    assert.match(rootHtml, /discoverability-results/);
    assert.match(rootHtml, /discoverability-summary/);
    assert.match(rootHtml, /refresh-search-health-results/);
    assert.match(rootHtml, /search-health-results/);
    assert.match(rootHtml, /search-health-summary/);
    assert.match(rootHtml, /refresh-llm-invocations/);
    assert.match(rootHtml, /llm-invocation-results/);
    assert.match(rootHtml, /llm-invocation-summary/);

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

    const instanceSurfaceDiagnosticsRes = await fetch(
      `${baseUrl}/api/instances/a/surface_diagnostics`,
      {
        headers: { Cookie: cookie },
      },
    );
    assert.equal(instanceSurfaceDiagnosticsRes.status, 200);
    const instanceSurfaceDiagnostics = await instanceSurfaceDiagnosticsRes.json();
    assert.equal(instanceSurfaceDiagnostics.diagnostics.instanceId, "a");
    assert.equal(instanceSurfaceDiagnostics.diagnostics.summary.searches.totalSearches, 2);
    assert.equal(instanceSurfaceDiagnostics.diagnostics.highlights.searches[0], "fixture-search: running (2 hits, publish enabled)");

    const instanceRuntimeSurfaceRes = await fetch(
      `${baseUrl}/api/instances/a/runtime_surface`,
      {
        headers: { Cookie: cookie },
      },
    );
    assert.equal(instanceRuntimeSurfaceRes.status, 200);
    const instanceRuntimeSurface = await instanceRuntimeSurfaceRes.json();
    assert.equal(instanceRuntimeSurface.diagnostics.instanceId, "a");
    assert.equal(instanceRuntimeSurface.diagnostics.detail.searches[0].label, "fixture-search");
    assert.equal(instanceRuntimeSurface.diagnostics.detail.sharedFiles[0].fileName, "fixture.txt");
    assert.equal(instanceRuntimeSurface.diagnostics.detail.downloads[0].fileName, "fixture.bin");

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
    assert.equal(operatorEventsStore.events.at(-1).type, "managed_instance_control_applied");
    assert.match(
      operatorEventsStore.events.at(-1).message,
      /created planned managed instance c/,
    );

    const startRes = await fetch(`${baseUrl}/api/instances/a/start`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    assert.equal(startRes.status, 200);
    const started = await startRes.json();
    assert.equal(started.instance.status, "running");
    assert.match(operatorEventsStore.events.at(-1).message, /started managed instance a/);

    const stopRes = await fetch(`${baseUrl}/api/instances/a/stop`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    assert.equal(stopRes.status, 200);
    assert.match(operatorEventsStore.events.at(-1).message, /stopped managed instance a/);

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

    const malformedProposalPathRes = await fetch(`${baseUrl}/api/proposals/%E0%A4%A`, {
      headers: { Cookie: cookie },
    });
    assert.equal(malformedProposalPathRes.status, 400);

    const invalidDriveLikePathRes = await fetch(`${baseUrl}/api/proposals/D%3Asecret.patch`, {
      headers: { Cookie: cookie },
    });
    assert.equal(invalidDriveLikePathRes.status, 400);

    const malformedLlmPathRes = await fetch(`${baseUrl}/api/llm/logs/%E0%A4%A`, {
      headers: { Cookie: cookie },
    });
    assert.equal(malformedLlmPathRes.status, 400);

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
