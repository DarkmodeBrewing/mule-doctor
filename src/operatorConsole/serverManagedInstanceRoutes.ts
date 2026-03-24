import type { IncomingMessage, ServerResponse } from "node:http";
import { redactLine } from "../logs/redaction.js";
import type { LlmInvocationGate } from "../llm/invocationGate.js";
import type {
  DiagnosticTargetRef,
  ManagedInstanceAnalysisResult,
  ManagedInstanceRecord,
} from "../types/contracts.js";
import { normalizeInvocationKeyPart } from "../llm/invocationGate.js";
import {
  DEFAULT_LOG_LINES,
  MAX_FILE_BYTES,
  MAX_LOG_LINES,
} from "./constants.js";
import { readTailLines } from "./files.js";
import { readJsonBody, sendJson } from "./http.js";
import { clampInt, handleManagedInstanceErrors } from "./serverUtils.js";
import type {
  DiagnosticTargetControl,
  DiscoverabilityResultsStore,
  ManagedInstanceAnalysis,
  ManagedInstanceControl,
  ManagedInstanceDiscoverability,
  ManagedInstanceDiagnostics,
  ManagedInstancePresets,
  ManagedInstanceSharing,
  ManagedInstanceSurfaceDiagnostics,
  OperatorEventsStore,
  OperatorSearches,
  SearchHealthResultsStore,
} from "./types.js";

export interface ManagedInstanceRouteContext {
  managedInstances?: ManagedInstanceControl;
  managedInstanceDiagnostics?: ManagedInstanceDiagnostics;
  managedInstanceSurfaceDiagnostics?: ManagedInstanceSurfaceDiagnostics;
  managedInstanceAnalysis?: ManagedInstanceAnalysis;
  managedInstanceSharing?: ManagedInstanceSharing;
  managedInstanceDiscoverability?: ManagedInstanceDiscoverability;
  operatorSearches?: OperatorSearches;
  managedInstancePresets?: ManagedInstancePresets;
  diagnosticTarget?: DiagnosticTargetControl;
  discoverabilityResults?: DiscoverabilityResultsStore;
  searchHealthResults?: SearchHealthResultsStore;
  humanInvocationGate?: Pick<LlmInvocationGate, "tryAcquire">;
  appendManagedInstanceControlEvent: (
    instance: ManagedInstanceRecord,
    message: string,
  ) => Promise<void>;
  appendManagedInstanceControlEvents: (
    instances: ManagedInstanceRecord[],
    buildMessage: (instance: ManagedInstanceRecord) => string,
  ) => Promise<void>;
  appendOperatorEvent: (
    event: Parameters<NonNullable<OperatorEventsStore["append"]>>[0],
  ) => Promise<void>;
  appendInvocationAudit: (record: {
    surface: "managed_instance_analysis" | "manual_observer_run";
    trigger: "human";
    target?: DiagnosticTargetRef;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    toolCalls: number;
    toolRounds: number;
    finishReason: "rate_limited";
    rateLimitReason?: "cooldown" | "in_flight";
    retryAfterSec?: number;
  }) => Promise<void>;
  findManagedInstance: (id: string) => Promise<ManagedInstanceRecord | undefined>;
}

export async function handleManagedInstanceApiRoute(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  if (path === "/api/instances") {
    await handleInstancesCollection(ctx, req, res);
    return true;
  }
  if (path === "/api/instance-presets") {
    await handleInstancePresets(ctx, req, res);
    return true;
  }
  if (path === "/api/instance-presets/apply") {
    await handleApplyInstancePreset(ctx, req, res);
    return true;
  }
  if (path.startsWith("/api/instance-presets/")) {
    await handleInstancePresetAction(ctx, req, res, path);
    return true;
  }
  if (path === "/api/discoverability/check") {
    await handleDiscoverabilityCheck(ctx, req, res);
    return true;
  }
  if (path === "/api/searches/launch") {
    await handleOperatorSearchLaunch(ctx, req, res);
    return true;
  }
  if (path.startsWith("/api/instances/")) {
    await handleInstanceAction(ctx, req, res, path);
    return true;
  }
  return false;
}

async function handleDiscoverabilityCheck(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstanceDiscoverability) {
    sendJson(res, 501, { ok: false, error: "managed discoverability checks unavailable" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  const result = await handleManagedInstanceErrors(() =>
    ctx.managedInstanceDiscoverability!.runControlledCheck({
      publisherInstanceId: typeof payload.publisherInstanceId === "string" ? payload.publisherInstanceId : "",
      searcherInstanceId: typeof payload.searcherInstanceId === "string" ? payload.searcherInstanceId : "",
      fixtureId: typeof payload.fixtureId === "string" ? payload.fixtureId : undefined,
      timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
      pollIntervalMs: typeof payload.pollIntervalMs === "number" ? payload.pollIntervalMs : undefined,
    }),
  );
  await ctx.appendOperatorEvent({
    type: "managed_instance_control_applied",
    message:
      `Operator ran controlled discoverability check from ${result.publisherInstanceId} to ${result.searcherInstanceId} ` +
      `with outcome ${result.outcome}.`,
    target: {
      kind: "managed_instance",
      instanceId: result.searcherInstanceId,
    },
    actor: "operator_console",
  });
  if (ctx.discoverabilityResults) {
    await ctx.discoverabilityResults.append(result);
  }
  if (ctx.searchHealthResults) {
    await ctx.searchHealthResults.appendControlledDiscoverability(result);
  }
  sendJson(res, 200, { ok: true, result });
}

async function handleOperatorSearchLaunch(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.operatorSearches) {
    sendJson(res, 501, { ok: false, error: "manual keyword search unavailable" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  const mode = typeof payload.mode === "string" ? payload.mode : undefined;
  if (mode !== "active_target" && mode !== "managed_instance") {
    sendJson(res, 400, { ok: false, error: "invalid mode: expected 'active_target' or 'managed_instance'" });
    return;
  }
  const query = typeof payload.query === "string" && payload.query.trim().length > 0 ? payload.query : undefined;
  const keywordIdHex =
    typeof payload.keywordIdHex === "string" && payload.keywordIdHex.trim().length > 0
      ? payload.keywordIdHex
      : undefined;
  if (!query && !keywordIdHex) {
    sendJson(res, 400, {
      ok: false,
      error: "manual search requires a non-empty 'query' or 'keywordIdHex'",
    });
    return;
  }
  if (query && keywordIdHex) {
    sendJson(res, 400, {
      ok: false,
      error: "manual search requires either 'query' or 'keywordIdHex', not both",
    });
    return;
  }
  const result = await handleManagedInstanceErrors(() =>
    ctx.operatorSearches!.startSearch({
      mode,
      instanceId: typeof payload.instanceId === "string" ? payload.instanceId : undefined,
      query,
      keywordIdHex,
    }),
  );
  await ctx.appendOperatorEvent({
    type: "managed_instance_control_applied",
    message: `Operator launched manual keyword search against ${result.targetLabel} (${result.searchId}).`,
    target: result.target,
    actor: "operator_console",
  });
  sendJson(res, 200, { ok: true, result });
}

async function handleInstancesCollection(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstances) {
    sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
    return;
  }
  if (req.method === "GET") {
    const instances = await ctx.managedInstances.listInstances();
    sendJson(res, 200, { ok: true, instances });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  const id = typeof payload.id === "string" ? payload.id : "";
  const apiPort =
    typeof payload.apiPort === "number" && Number.isInteger(payload.apiPort)
      ? payload.apiPort
      : undefined;
  const created = await handleManagedInstanceErrors(() =>
    ctx.managedInstances!.createPlannedInstance({ id, apiPort }),
  );
  await ctx.appendManagedInstanceControlEvent(
    created,
    `Operator created planned managed instance ${created.id}.`,
  );
  sendJson(res, 201, { ok: true, instance: created });
}

async function handleInstancePresets(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstancePresets) {
    sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  sendJson(res, 200, { ok: true, presets: ctx.managedInstancePresets.listPresets() });
}

async function handleApplyInstancePreset(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstancePresets) {
    sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  const applied = await handleManagedInstanceErrors(() =>
    ctx.managedInstancePresets!.applyPreset({
      presetId: typeof payload.presetId === "string" ? payload.presetId : "",
      prefix: typeof payload.prefix === "string" ? payload.prefix : "",
    }),
  );
  await ctx.appendManagedInstanceControlEvents(
    applied.instances,
    (instance) =>
      `Operator applied preset ${applied.presetId} and created planned managed instance ${instance.id}.`,
  );
  sendJson(res, 201, { ok: true, applied });
}

async function handleInstancePresetAction(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  if (!ctx.managedInstancePresets) {
    sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
    return;
  }
  const suffix = path.slice("/api/instance-presets/".length);
  const [prefixRaw, action] = suffix.split("/");
  let prefix = "";
  try {
    prefix = decodeURIComponent(prefixRaw ?? "").trim();
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid percent-encoding in preset group prefix" });
    return;
  }
  if (!prefix) {
    sendJson(res, 400, { ok: false, error: "missing preset group prefix" });
    return;
  }
  if (action !== "start" && action !== "stop" && action !== "restart") {
    sendJson(res, 404, { ok: false, error: "preset action not found" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const lifecycleAction = action;
  const actionVerb = pastTenseVerb(lifecycleAction);
  const result = await handleManagedInstanceErrors(() => {
    if (action === "start") {
      return ctx.managedInstancePresets!.startPreset(prefix);
    }
    if (action === "stop") {
      return ctx.managedInstancePresets!.stopPreset(prefix);
    }
    return ctx.managedInstancePresets!.restartPreset(prefix);
  });
  await ctx.appendManagedInstanceControlEvents(
    result.instances,
    (instance) => `Operator ${actionVerb} managed instance ${instance.id} from preset group ${prefix}.`,
  );
  if (action === "start") {
    sendJson(res, 200, { ok: true, result, started: result });
    return;
  }
  sendJson(res, 200, { ok: true, result });
}

async function handleInstanceAction(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  const suffix = path.slice("/api/instances/".length);
  const [idRaw, action, ...rest] = suffix.split("/");
  let id: string;
  try {
    id = decodeURIComponent(idRaw ?? "").trim();
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid percent-encoding in instance id" });
    return;
  }
  if (!id) {
    sendJson(res, 400, { ok: false, error: "missing instance id" });
    return;
  }
  if (!action) {
    await handleInstanceDetail(ctx, req, res, id);
    return;
  }
  if (action === "logs") {
    await handleInstanceLogs(ctx, req, res, id, req.url);
    return;
  }
  if (action === "diagnostics") {
    await handleInstanceDiagnostics(ctx, req, res, id);
    return;
  }
  if (action === "surface_diagnostics") {
    await handleInstanceSurfaceDiagnostics(ctx, req, res, id, "summary");
    return;
  }
  if (action === "runtime_surface") {
    await handleInstanceSurfaceDiagnostics(ctx, req, res, id, "snapshot");
    return;
  }
  if (action === "analyze") {
    await handleInstanceAnalyze(ctx, req, res, id);
    return;
  }
  if (action === "shared") {
    await handleInstanceSharedAction(ctx, req, res, id, rest);
    return;
  }
  await handleInstanceLifecycleAction(ctx, req, res, id, action);
}

async function handleInstanceDetail(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!ctx.managedInstances) {
    sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
    return;
  }
  const instance = await ctx.findManagedInstance(id);
  if (!instance) {
    sendJson(res, 404, { ok: false, error: `managed instance not found: ${id}` });
    return;
  }
  sendJson(res, 200, { ok: true, instance });
}

async function handleInstanceLogs(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  requestUrl: string | undefined,
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!ctx.managedInstances) {
    sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
    return;
  }
  const instance = await ctx.findManagedInstance(id);
  if (!instance) {
    sendJson(res, 404, { ok: false, error: `managed instance not found: ${id}` });
    return;
  }
  const lines = clampInt(
    parseInt(new URL(requestUrl ?? "/", "http://operator-console.local").searchParams.get("lines") ?? "", 10),
    DEFAULT_LOG_LINES,
    1,
    MAX_LOG_LINES,
  );
  const content = await readTailLines(instance.runtime.logPath, lines, MAX_FILE_BYTES);
  sendJson(res, 200, {
    ok: true,
    instance: { id: instance.id, status: instance.status },
    lines: content.map(redactLine),
  });
}

async function handleInstanceDiagnostics(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!ctx.managedInstanceDiagnostics) {
    sendJson(res, 501, { ok: false, error: "managed instance diagnostics unavailable" });
    return;
  }
  const snapshot = await handleManagedInstanceErrors(() => ctx.managedInstanceDiagnostics!.getSnapshot(id));
  sendJson(res, 200, { ok: true, snapshot });
}

async function handleInstanceSurfaceDiagnostics(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  mode: "summary" | "snapshot",
): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!ctx.managedInstanceSurfaceDiagnostics) {
    sendJson(res, 501, { ok: false, error: "managed instance surface diagnostics unavailable" });
    return;
  }
  const diagnostics = await handleManagedInstanceErrors(() =>
    mode === "summary"
      ? ctx.managedInstanceSurfaceDiagnostics!.getSummary(id)
      : ctx.managedInstanceSurfaceDiagnostics!.getSnapshot(id),
  );
  sendJson(res, 200, { ok: true, diagnostics });
}

async function handleInstanceAnalyze(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!ctx.managedInstanceAnalysis) {
    sendJson(res, 501, { ok: false, error: "managed instance analysis unavailable" });
    return;
  }
  const instanceGateKeyPart = normalizeInvocationKeyPart(id, { maxLength: 48 }) ?? "unknown";
  const decision = ctx.humanInvocationGate?.tryAcquire([
    { key: "human_llm:global", cooldownMs: 30_000 },
    { key: "human_llm:operator_analyze", cooldownMs: 60_000 },
    { key: `human_llm:operator_analyze:instance:${instanceGateKeyPart}`, cooldownMs: 300_000 },
  ]);
  if (decision && !decision.ok) {
    const recordedAt = new Date().toISOString();
    await ctx.appendInvocationAudit({
      surface: "managed_instance_analysis",
      trigger: "human",
      target: { kind: "managed_instance", instanceId: id },
      startedAt: recordedAt,
      completedAt: recordedAt,
      durationMs: 0,
      toolCalls: 0,
      toolRounds: 0,
      finishReason: "rate_limited",
      rateLimitReason: decision.reason,
      retryAfterSec: decision.retryAfterSec,
    });
    sendJson(res, 429, {
      ok: false,
      error: `managed instance analysis is rate-limited (${decision.reason})`,
      retryAfterSec: decision.retryAfterSec,
    });
    return;
  }
  let analysis: ManagedInstanceAnalysisResult | undefined;
  try {
    analysis = await handleManagedInstanceErrors(() => ctx.managedInstanceAnalysis!.analyze(id));
  } finally {
    decision?.lease.release({ cooldown: analysis?.available !== false });
  }
  sendJson(res, 200, { ok: true, analysis });
}

async function handleInstanceLifecycleAction(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  action: string,
): Promise<void> {
  if (!ctx.managedInstances) {
    sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (action !== "start" && action !== "stop" && action !== "restart") {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }
  const actionVerb = pastTenseVerb(action);
  let instance: ManagedInstanceRecord;
  if (action === "start") {
    instance = await handleManagedInstanceErrors(() => ctx.managedInstances!.startInstance(id));
  } else if (action === "stop") {
    instance = await handleManagedInstanceErrors(() =>
      ctx.managedInstances!.stopInstance(id, "stopped from operator console"),
    );
  } else {
    instance = await handleManagedInstanceErrors(() => ctx.managedInstances!.restartInstance(id));
  }
  await ctx.appendManagedInstanceControlEvent(
    instance,
    `Operator ${actionVerb} managed instance ${instance.id}.`,
  );
  sendJson(res, 200, { ok: true, instance });
}

async function handleInstanceSharedAction(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  actionSegments: string[],
): Promise<void> {
  if (!ctx.managedInstanceSharing) {
    sendJson(res, 501, { ok: false, error: "managed instance shared-content control unavailable" });
    return;
  }
  const [subAction] = actionSegments;
  if (actionSegments.length > 1) {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }
  if (!subAction) {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    const shared = await handleManagedInstanceErrors(() => ctx.managedInstanceSharing!.getOverview(id));
    sendJson(res, 200, { ok: true, shared });
    return;
  }
  if (subAction === "fixtures") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    const fixture = await handleManagedInstanceErrors(() =>
      ctx.managedInstanceSharing!.ensureFixture(id, {
        fixtureId: typeof payload.fixtureId === "string" ? payload.fixtureId : undefined,
      }),
    );
    await ctx.appendOperatorEvent({
      type: "managed_instance_control_applied",
      message: `Operator created fixture ${fixture.fileName} for managed instance ${id}.`,
      target: { kind: "managed_instance", instanceId: id },
      actor: "operator_console",
    });
    sendJson(res, 201, { ok: true, fixture });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (subAction !== "reindex" && subAction !== "republish_sources" && subAction !== "republish_keywords") {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }
  const shared = await handleManagedInstanceErrors(() => {
    if (subAction === "reindex") {
      return ctx.managedInstanceSharing!.reindex(id);
    }
    if (subAction === "republish_sources") {
      return ctx.managedInstanceSharing!.republishSources(id);
    }
    return ctx.managedInstanceSharing!.republishKeywords(id);
  });
  await ctx.appendOperatorEvent({
    type: "managed_instance_control_applied",
    message: `Operator triggered ${subAction} for managed instance ${id} shared content.`,
    target: { kind: "managed_instance", instanceId: id },
    actor: "operator_console",
  });
  sendJson(res, 200, { ok: true, shared });
}

function pastTenseVerb(action: "start" | "stop" | "restart"): string {
  if (action === "start") return "started";
  if (action === "stop") return "stopped";
  return "restarted";
}
