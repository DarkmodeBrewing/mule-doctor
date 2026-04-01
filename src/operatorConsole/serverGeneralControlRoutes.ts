import type { IncomingMessage, ServerResponse } from "node:http";
import { redactText } from "../logs/redaction.js";
import { describeDiagnosticTarget } from "../targets/describeTarget.js";
import type { DiagnosticTargetRef } from "../types/contracts.js";
import { readJsonBody, sendJson } from "./http.js";
import {
  clampInt,
  handleManagedInstanceErrors,
  log,
  redactInstanceForConsole,
} from "./serverUtils.js";
import type { ManagedInstanceComparisonResponse } from "./types.js";
import type { GeneralRouteContext } from "./serverGeneralRouteContext.js";

export async function handleGeneralControlRoute(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
): Promise<boolean> {
  if (path === "/api/observer/target") {
    await handleDiagnosticTarget(ctx, req, res);
    return true;
  }
  if (path === "/api/observer/run") {
    await handleObserverRun(ctx, req, res);
    return true;
  }
  if (path === "/api/operator/events") {
    await handleOperatorEvents(ctx, req, url, res);
    return true;
  }
  if (path === "/api/discoverability/results") {
    await handleDiscoverabilityResults(ctx, req, url, res);
    return true;
  }
  if (path === "/api/discoverability/summary") {
    await handleDiscoverabilitySummary(ctx, req, url, res);
    return true;
  }
  if (path === "/api/search-health/results") {
    await handleSearchHealthResults(ctx, req, url, res);
    return true;
  }
  if (path === "/api/search-health/summary") {
    await handleSearchHealthSummary(ctx, req, url, res);
    return true;
  }
  if (path === "/api/llm/invocations") {
    await handleLlmInvocationResults(ctx, req, url, res);
    return true;
  }
  if (path === "/api/llm/invocations/summary") {
    await handleLlmInvocationSummary(ctx, req, url, res);
    return true;
  }
  if (path === "/api/instances/compare") {
    await handleInstanceComparison(ctx, req, url, res);
    return true;
  }
  return false;
}

async function handleObserverRun(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.observerControl) {
    sendJson(res, 501, { ok: false, error: "observer control unavailable" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  const decision = ctx.humanInvocationGate?.tryAcquire([
    { key: "human_llm:global", cooldownMs: 30_000 },
    { key: "human_llm:observer_run", cooldownMs: 300_000 },
  ]);
  if (decision && !decision.ok) {
    const recordedAt = new Date().toISOString();
    await ctx.appendInvocationAudit({
      surface: "manual_observer_run",
      trigger: "human",
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
      error: `observer run is rate-limited (${decision.reason})`,
      retryAfterSec: decision.retryAfterSec,
    });
    return;
  }

  const result = ctx.observerControl.triggerRunNow();
  if (!result.accepted) {
    decision?.lease.release({ cooldown: false });
    sendJson(res, 409, { ok: false, error: result.reason ?? "observer run not accepted" });
    return;
  }
  decision?.lease.release();
  let target: DiagnosticTargetRef | undefined;
  try {
    target = ctx.diagnosticTarget ? await ctx.diagnosticTarget.getActiveTarget() : undefined;
  } catch (err) {
    log(
      "warn",
      "operatorConsole",
      `Failed to resolve active target for run-now event: ${String(err)}`,
    );
    target = undefined;
  }
  await ctx.appendOperatorEvent({
    type: "observer_run_requested",
    message: `Operator triggered a scheduled observer cycle for ${describeDiagnosticTarget(target)}`,
    target,
    actor: "operator_console",
  });
  sendJson(res, 202, {
    ok: true,
    accepted: true,
    scheduler: ctx.observerControl.getStatus(),
  });
}

async function handleOperatorEvents(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.operatorEvents) {
    sendJson(res, 501, { ok: false, error: "operator event history unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const limit = clampInt(parseInt(url.searchParams.get("limit") ?? "", 10), 30, 1, 200);
  const events = await ctx.operatorEvents.listRecent(limit);
  sendJson(res, 200, {
    ok: true,
    events: events.map((event) => ({
      ...event,
      message: redactText(event.message),
    })),
  });
}

async function handleInstanceComparison(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstances || !ctx.managedInstanceDiagnostics) {
    sendJson(res, 501, { ok: false, error: "managed instance comparison unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const leftId = url.searchParams.get("left")?.trim();
  const rightId = url.searchParams.get("right")?.trim();
  if (!leftId || !rightId) {
    sendJson(res, 400, { ok: false, error: "left and right managed instance ids are required" });
    return;
  }
  if (leftId === rightId) {
    sendJson(res, 400, { ok: false, error: "left and right managed instance ids must differ" });
    return;
  }

  const comparison = await handleManagedInstanceErrors(
    async (): Promise<ManagedInstanceComparisonResponse> => {
      const instances = await ctx.managedInstances!.listInstances();
      const leftInstance = instances.find((instance) => instance.id === leftId);
      const rightInstance = instances.find((instance) => instance.id === rightId);
      if (!leftInstance) {
        throw new Error(`Managed instance not found: ${leftId}`);
      }
      if (!rightInstance) {
        throw new Error(`Managed instance not found: ${rightId}`);
      }
      const [leftSnapshot, rightSnapshot] = await Promise.all([
        ctx.managedInstanceDiagnostics!.getSnapshot(leftId),
        ctx.managedInstanceDiagnostics!.getSnapshot(rightId),
      ]);
      return {
        left: {
          instance: redactInstanceForConsole(leftInstance),
          snapshot: leftSnapshot,
        },
        right: {
          instance: redactInstanceForConsole(rightInstance),
          snapshot: rightSnapshot,
        },
      };
    },
  );

  sendJson(res, 200, { ok: true, comparison });
}

async function handleDiagnosticTarget(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.diagnosticTarget) {
    sendJson(res, 501, { ok: false, error: "diagnostic target control unavailable" });
    return;
  }

  if (req.method === "GET") {
    const target = await ctx.diagnosticTarget.getActiveTarget();
    sendJson(res, 200, { ok: true, target });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  const payload = await readJsonBody(req);
  const target = await handleManagedInstanceErrors(() =>
    ctx.diagnosticTarget!.setActiveTarget({
      kind: (typeof payload.kind === "string" ? payload.kind : "external") as DiagnosticTargetRef["kind"],
      instanceId: typeof payload.instanceId === "string" ? payload.instanceId : undefined,
    }),
  );
  sendJson(res, 200, { ok: true, target });
}

async function handleDiscoverabilityResults(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.discoverabilityResults) {
    sendJson(res, 501, { ok: false, error: "discoverability result history unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const limit = clampInt(parseInt(url.searchParams.get("limit") ?? "", 10), 20, 1, 200);
  const results = await ctx.discoverabilityResults.listRecent(limit);
  sendJson(res, 200, { ok: true, results });
}

async function handleDiscoverabilitySummary(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.discoverabilityResults) {
    sendJson(res, 501, { ok: false, error: "discoverability summary unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const limit = clampInt(parseInt(url.searchParams.get("limit") ?? "", 10), 20, 1, 200);
  const summary = await ctx.discoverabilityResults.summarizeRecent(limit);
  sendJson(res, 200, { ok: true, summary });
}

async function handleSearchHealthResults(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.searchHealthResults) {
    sendJson(res, 501, { ok: false, error: "search health history unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const limit = clampInt(parseInt(url.searchParams.get("limit") ?? "", 10), 20, 1, 200);
  const results = await ctx.searchHealthResults.listRecent(limit);
  sendJson(res, 200, { ok: true, results });
}

async function handleSearchHealthSummary(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.searchHealthResults) {
    sendJson(res, 501, { ok: false, error: "search health summary unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const limit = clampInt(parseInt(url.searchParams.get("limit") ?? "", 10), 20, 1, 200);
  const summary = await ctx.searchHealthResults.summarizeRecent(limit);
  sendJson(res, 200, { ok: true, summary });
}

async function handleLlmInvocationResults(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.llmInvocationResults) {
    sendJson(res, 501, { ok: false, error: "llm invocation history unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const limit = clampInt(parseInt(url.searchParams.get("limit") ?? "", 10), 20, 1, 200);
  const results = await ctx.llmInvocationResults.listRecent(limit);
  sendJson(res, 200, { ok: true, results });
}

async function handleLlmInvocationSummary(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.llmInvocationResults) {
    sendJson(res, 501, { ok: false, error: "llm invocation summary unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const limit = clampInt(parseInt(url.searchParams.get("limit") ?? "", 10), 20, 1, 200);
  const summary = await ctx.llmInvocationResults.summarizeRecent(limit);
  sendJson(res, 200, { ok: true, summary });
}
