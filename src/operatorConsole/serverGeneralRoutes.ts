import type { IncomingMessage, ServerResponse } from "node:http";
import { redactLine, redactText } from "../logs/redaction.js";
import type { LlmInvocationGate } from "../llm/invocationGate.js";
import { describeDiagnosticTarget } from "../targets/describeTarget.js";
import type {
  DiagnosticTargetRef,
  RuntimeState,
} from "../types/contracts.js";
import {
  DEFAULT_LOG_LINES,
  MAX_FILE_BYTES,
  MAX_LOG_LINES,
} from "./constants.js";
import {
  listFiles,
  readFromAllowedDir,
  readTailLines,
} from "./files.js";
import { readJsonBody, sendJson } from "./http.js";
import {
  clampInt,
  handleManagedInstanceErrors,
  log,
  redactInstanceForConsole,
  sanitizeCycleOutcome,
} from "./serverUtils.js";
import type {
  DiagnosticTargetControl,
  DiscoverabilityResultsStore,
  LlmInvocationResultsStore,
  ManagedInstanceComparisonResponse,
  ManagedInstanceControl,
  ManagedInstanceDiagnostics,
  ObserverControl,
  OperatorEventsStore,
  SearchHealthResultsStore,
} from "./types.js";

export interface GeneralRouteContext {
  startedAt: string;
  rustMuleLogPath: string;
  llmLogDir: string;
  proposalDir: string;
  getAppLogs: (n?: number) => string[];
  getRuntimeState?: () => Promise<RuntimeState>;
  managedInstances?: ManagedInstanceControl;
  managedInstanceDiagnostics?: ManagedInstanceDiagnostics;
  diagnosticTarget?: DiagnosticTargetControl;
  observerControl?: ObserverControl;
  humanInvocationGate?: Pick<LlmInvocationGate, "tryAcquire">;
  operatorEvents?: OperatorEventsStore;
  discoverabilityResults?: DiscoverabilityResultsStore;
  searchHealthResults?: SearchHealthResultsStore;
  llmInvocationResults?: LlmInvocationResultsStore;
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
}

export async function handleGeneralApiRoute(
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
  if (req.method !== "GET") {
    return false;
  }
  if (path === "/api/health") {
    await handleHealth(ctx, res);
    return true;
  }
  if (path === "/api/logs/app") {
    await handleAppLogs(ctx, url, res);
    return true;
  }
  if (path === "/api/logs/rust-mule") {
    await handleRustMuleLogs(ctx, url, res);
    return true;
  }
  if (path === "/api/llm/logs") {
    await handleLlmLogs(ctx, res);
    return true;
  }
  if (path.startsWith("/api/llm/logs/")) {
    await handleLlmLogDetail(ctx, path, res);
    return true;
  }
  if (path === "/api/proposals") {
    await handleProposals(ctx, res);
    return true;
  }
  if (path.startsWith("/api/proposals/")) {
    await handleProposalDetail(ctx, path, res);
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

  const comparison = await handleManagedInstanceErrors(async (): Promise<ManagedInstanceComparisonResponse> => {
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
  });

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

async function handleHealth(ctx: GeneralRouteContext, res: ServerResponse): Promise<void> {
  const runtimeState = ctx.getRuntimeState ? await ctx.getRuntimeState() : undefined;
  const schedulerStatus = ctx.observerControl?.getStatus();
  sendJson(res, 200, {
    ok: true,
    startedAt: ctx.startedAt,
    now: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    scheduler: schedulerStatus
      ? {
          started: schedulerStatus.started,
          cycleInFlight: schedulerStatus.cycleInFlight,
          intervalMs: schedulerStatus.intervalMs,
          currentCycleStartedAt: schedulerStatus.currentCycleStartedAt ?? runtimeState?.currentCycleStartedAt,
          currentCycleTarget: schedulerStatus.currentCycleTarget ?? runtimeState?.currentCycleTarget,
          lastCycleStartedAt: runtimeState?.lastCycleStartedAt,
          lastCycleCompletedAt: runtimeState?.lastCycleCompletedAt,
          lastCycleDurationMs: runtimeState?.lastCycleDurationMs,
          lastCycleOutcome: sanitizeCycleOutcome(runtimeState?.lastCycleOutcome),
        }
      : undefined,
    observer: runtimeState
      ? buildObserverStatus(runtimeState)
      : undefined,
    paths: {
      rustMuleLogPath: ctx.rustMuleLogPath,
      llmLogDir: ctx.llmLogDir,
      proposalDir: ctx.proposalDir,
    },
  });
}

async function handleAppLogs(ctx: GeneralRouteContext, url: URL, res: ServerResponse): Promise<void> {
  const lines = clampInt(parseInt(url.searchParams.get("lines") ?? "", 10), DEFAULT_LOG_LINES, 1, MAX_LOG_LINES);
  sendJson(res, 200, {
    ok: true,
    lines: ctx.getAppLogs(lines).map(redactLine),
  });
}

async function handleRustMuleLogs(ctx: GeneralRouteContext, url: URL, res: ServerResponse): Promise<void> {
  const lines = clampInt(parseInt(url.searchParams.get("lines") ?? "", 10), DEFAULT_LOG_LINES, 1, MAX_LOG_LINES);
  const content = await readTailLines(ctx.rustMuleLogPath, lines, MAX_FILE_BYTES);
  sendJson(res, 200, { ok: true, lines: content.map(redactLine) });
}

async function handleLlmLogs(ctx: GeneralRouteContext, res: ServerResponse): Promise<void> {
  const files = await listFiles(ctx.llmLogDir, (name) => /^LLM_.*\.log$/i.test(name));
  sendJson(res, 200, { ok: true, files });
}

async function handleLlmLogDetail(
  ctx: GeneralRouteContext,
  path: string,
  res: ServerResponse,
): Promise<void> {
  const fileName = decodeURIComponent(path.slice("/api/llm/logs/".length));
  const content = await readFromAllowedDir(ctx.llmLogDir, fileName, MAX_FILE_BYTES);
  sendJson(res, 200, {
    ok: true,
    file: content.name,
    sizeBytes: content.sizeBytes,
    truncated: content.truncated,
    content: redactText(content.content),
  });
}

async function handleProposals(ctx: GeneralRouteContext, res: ServerResponse): Promise<void> {
  const files = await listFiles(ctx.proposalDir, (name) => name.toLowerCase().endsWith(".patch"));
  sendJson(res, 200, { ok: true, files });
}

async function handleProposalDetail(
  ctx: GeneralRouteContext,
  path: string,
  res: ServerResponse,
): Promise<void> {
  const fileName = decodeURIComponent(path.slice("/api/proposals/".length));
  const content = await readFromAllowedDir(ctx.proposalDir, fileName, MAX_FILE_BYTES);
  sendJson(res, 200, {
    ok: true,
    file: content.name,
    sizeBytes: content.sizeBytes,
    truncated: content.truncated,
    content: redactText(content.content),
  });
}

function buildObserverStatus(runtimeState: RuntimeState) {
  return {
    activeDiagnosticTarget: runtimeState.activeDiagnosticTarget,
    lastObservedTarget: runtimeState.lastObservedTarget,
    lastRun: runtimeState.lastRun,
    lastHealthScore: runtimeState.lastHealthScore,
    currentCycleStartedAt: runtimeState.currentCycleStartedAt,
    currentCycleTarget: runtimeState.currentCycleTarget,
    lastCycleStartedAt: runtimeState.lastCycleStartedAt,
    lastCycleCompletedAt: runtimeState.lastCycleCompletedAt,
    lastCycleDurationMs: runtimeState.lastCycleDurationMs,
    lastCycleOutcome: sanitizeCycleOutcome(runtimeState.lastCycleOutcome),
    lastTargetFailureReason: runtimeState.lastTargetFailureReason
      ? redactText(runtimeState.lastTargetFailureReason)
      : runtimeState.lastTargetFailureReason,
  };
}
