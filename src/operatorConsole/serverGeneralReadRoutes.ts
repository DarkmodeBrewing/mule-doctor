import type { ServerResponse } from "node:http";
import { redactLine, redactText } from "../logs/redaction.js";
import { RequestError } from "./http.js";
import type { RuntimeState } from "../types/contracts.js";
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
import { sendJson } from "./http.js";
import {
  clampInt,
  sanitizeCycleOutcome,
} from "./serverUtils.js";
import type { GeneralRouteContext } from "./serverGeneralRouteContext.js";

export async function handleGeneralReadRoute(
  ctx: GeneralRouteContext,
  url: URL,
  path: string,
  res: ServerResponse,
): Promise<boolean> {
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
          currentCycleStartedAt:
            schedulerStatus.currentCycleStartedAt ?? runtimeState?.currentCycleStartedAt,
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
  const fileName = decodeRouteFileName(path.slice("/api/llm/logs/".length), "Invalid LLM log path");
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
  const fileName = decodeRouteFileName(path.slice("/api/proposals/".length), "Invalid proposal path");
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

function decodeRouteFileName(rawPath: string, invalidMessage: string): string {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    throw new RequestError(400, invalidMessage);
  }
}
