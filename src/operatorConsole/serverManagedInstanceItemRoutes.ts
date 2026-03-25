import type { IncomingMessage, ServerResponse } from "node:http";
import { redactLine } from "../logs/redaction.js";
import { normalizeInvocationKeyPart } from "../llm/invocationGate.js";
import type {
  ManagedInstanceAnalysisResult,
  ManagedInstanceRecord,
} from "../types/contracts.js";
import { DEFAULT_LOG_LINES, MAX_FILE_BYTES, MAX_LOG_LINES } from "./constants.js";
import { readTailLines } from "./files.js";
import { readJsonBody, sendJson } from "./http.js";
import type { ManagedInstanceRouteContext } from "./serverManagedInstanceRouteContext.js";
import { pastTenseVerb } from "./serverManagedInstanceRouteContext.js";
import { clampInt, handleManagedInstanceErrors } from "./serverUtils.js";

export async function handleInstanceAction(
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
