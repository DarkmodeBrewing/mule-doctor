/**
 * server.ts
 * Read-only operator console for inspecting runtime health, logs, and proposals.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { redactLine, redactText } from "../logs/redaction.js";
import type {
  DiagnosticTargetRef,
  ManagedInstanceRecord,
  RuntimeState,
} from "../types/contracts.js";
import { describeDiagnosticTarget } from "../targets/describeTarget.js";
import {
  AUTH_COOKIE_NAME,
  DEFAULT_LOG_LINES,
  DEFAULT_STREAM_HEARTBEAT_MS,
  DEFAULT_STREAM_LINES,
  DEFAULT_STREAM_POLL_MS,
  DEFAULT_UI_PORT,
  MAX_FILE_BYTES,
  MAX_LOG_LINES,
  MAX_STREAM_LINES,
  PUBLIC_UNAUTHENTICATED_ASSETS,
} from "./constants.js";
import {
  applySecurityHeaders,
  getBearerToken,
  getCookie,
  getHeaderValue,
  readFormBody,
  readJsonBody,
  redirect,
  RequestError,
  sendJson,
  sendSseHeaders,
  writeSseEvent,
} from "./http.js";
import {
  getFileSize,
  listFiles,
  readFromAllowedDir,
  readStreamChunk,
  readTailLines,
  sendStaticAsset,
  sendStaticHtml,
} from "./files.js";
import {
  clampInt,
  handleManagedInstanceErrors,
  log,
  redactInstanceForConsole,
  sanitizeCycleOutcome,
  sanitizeHost,
} from "./serverUtils.js";
import type {
  AuthState,
  DiagnosticTargetControl,
  ManagedInstanceAnalysis,
  ManagedInstanceComparisonResponse,
  ManagedInstanceControl,
  ManagedInstanceDiagnostics,
  ManagedInstancePresets,
  ManagedInstanceSharing,
  OperatorConsoleConfig,
  OperatorEventsStore,
  ObserverControl,
} from "./types.js";

export class OperatorConsoleServer {
  private readonly authToken: string | undefined;
  private readonly host: string;
  private readonly port: number;
  private readonly rustMuleLogPath: string;
  private readonly llmLogDir: string;
  private readonly proposalDir: string;
  private readonly getAppLogs: (n?: number) => string[];
  private readonly getRuntimeState: (() => Promise<RuntimeState>) | undefined;
  private readonly subscribeToAppLogs: ((listener: (line: string) => void) => () => void) | undefined;
  private readonly rustMuleStreamPollMs: number;
  private readonly managedInstances: ManagedInstanceControl | undefined;
  private readonly managedInstanceDiagnostics: ManagedInstanceDiagnostics | undefined;
  private readonly managedInstanceAnalysis: ManagedInstanceAnalysis | undefined;
  private readonly managedInstanceSharing: ManagedInstanceSharing | undefined;
  private readonly managedInstancePresets: ManagedInstancePresets | undefined;
  private readonly diagnosticTarget: DiagnosticTargetControl | undefined;
  private readonly observerControl: ObserverControl | undefined;
  private readonly operatorEvents:
    | OperatorConsoleConfig["operatorEvents"]
    | undefined;
  private readonly startedAt: string;

  private server: Server | undefined;
  private boundPort: number | undefined;
  private readonly streamCleanups = new Set<() => void>();

  constructor(config: OperatorConsoleConfig) {
    this.authToken = config.authToken?.trim() || undefined;
    this.host = sanitizeHost(config.host);
    this.port = clampInt(config.port, DEFAULT_UI_PORT, 0, 65_535);
    this.rustMuleLogPath = config.rustMuleLogPath;
    this.llmLogDir = config.llmLogDir;
    this.proposalDir = config.proposalDir;
    this.getAppLogs = config.getAppLogs;
    this.getRuntimeState = config.getRuntimeState;
    this.subscribeToAppLogs = config.subscribeToAppLogs;
    this.rustMuleStreamPollMs = clampInt(
      config.rustMuleStreamPollMs,
      DEFAULT_STREAM_POLL_MS,
      100,
      60_000,
    );
    this.managedInstances = config.managedInstances;
    this.managedInstanceDiagnostics = config.managedInstanceDiagnostics;
    this.managedInstanceAnalysis = config.managedInstanceAnalysis;
    this.managedInstanceSharing = config.managedInstanceSharing;
    this.managedInstancePresets = config.managedInstancePresets;
    this.diagnosticTarget = config.diagnosticTarget;
    this.observerControl = config.observerControl;
    this.operatorEvents = config.operatorEvents;
    this.startedAt = new Date().toISOString();
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        if (err instanceof RequestError) {
          sendJson(res, err.statusCode, { ok: false, error: err.message });
          return;
        }
        sendJson(res, 500, {
          ok: false,
          error: `operator console request failed: ${String(err)}`,
        });
      });
    });

    await new Promise<void>((resolveStart, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, this.host, () => {
        this.server?.off("error", reject);
        resolveStart();
      });
    });

    const address = this.server.address();
    if (address && typeof address !== "string") {
      this.boundPort = address.port;
    } else {
      this.boundPort = this.port;
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;

    for (const cleanup of this.streamCleanups) {
      cleanup();
    }
    this.streamCleanups.clear();

    await new Promise<void>((resolveStop, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolveStop();
      });
    });
  }

  publicAddress(): string {
    const port = this.boundPort ?? this.port;
    return `http://${this.host}:${port}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://operator-console.local");
    const path = url.pathname;
    const auth = this.authenticate(req);

    if (path === "/auth/login") {
      await this.handleLogin(req, res);
      return;
    }

    if (path === "/auth/logout") {
      if (!auth.ok) {
        sendJson(res, 401, { ok: false, error: "operator console authentication required" });
        return;
      }
      this.handleLogout(req, res);
      return;
    }

    if (req.method === "POST" && !this.isSameOrigin(req)) {
      sendJson(res, 403, { ok: false, error: "cross-origin control requests are not allowed" });
      return;
    }

    if (path === "/" || path === "/index.html") {
      if (!auth.ok) {
        await sendStaticHtml(res, "login.html");
        return;
      }
      await sendStaticHtml(res, "index.html");
      return;
    }

    if (path.startsWith("/static/operatorConsole/")) {
      const fileName = path.slice("/static/operatorConsole/".length);
      if (!auth.ok && !PUBLIC_UNAUTHENTICATED_ASSETS.has(fileName)) {
        sendJson(res, 401, { ok: false, error: "operator console authentication required" });
        return;
      }
      await sendStaticAsset(res, fileName);
      return;
    }

    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: "operator console authentication required" });
      return;
    }

    if (path === "/api/stream/app") {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      await this.handleAppLogStream(url, req, res);
      return;
    }

    if (path === "/api/stream/rust-mule") {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      await this.handleRustMuleLogStream(url, req, res);
      return;
    }

    if (path === "/api/instances") {
      await this.handleInstancesCollection(req, res);
      return;
    }

    if (path === "/api/instance-presets") {
      await this.handleInstancePresets(req, res);
      return;
    }

    if (path === "/api/instance-presets/apply") {
      await this.handleApplyInstancePreset(req, res);
      return;
    }

    if (path.startsWith("/api/instance-presets/")) {
      await this.handleInstancePresetAction(req, res, path);
      return;
    }

    if (path === "/api/observer/target") {
      await this.handleDiagnosticTarget(req, res);
      return;
    }

    if (path === "/api/observer/run") {
      await this.handleObserverRun(req, res);
      return;
    }

    if (path === "/api/operator/events") {
      await this.handleOperatorEvents(req, url, res);
      return;
    }

    if (path === "/api/instances/compare") {
      await this.handleInstanceComparison(req, url, res);
      return;
    }

    if (path.startsWith("/api/instances/")) {
      await this.handleInstanceAction(req, res, path);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    if (path === "/api/health") {
      const runtimeState = this.getRuntimeState ? await this.getRuntimeState() : undefined;
      const schedulerStatus = this.observerControl?.getStatus();
      sendJson(res, 200, {
        ok: true,
        startedAt: this.startedAt,
        now: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
        scheduler: schedulerStatus
          ? {
              started: schedulerStatus.started,
              cycleInFlight: schedulerStatus.cycleInFlight,
              intervalMs: schedulerStatus.intervalMs,
              currentCycleStartedAt:
                schedulerStatus.currentCycleStartedAt ?? runtimeState?.currentCycleStartedAt,
              currentCycleTarget:
                schedulerStatus.currentCycleTarget ?? runtimeState?.currentCycleTarget,
              lastCycleStartedAt: runtimeState?.lastCycleStartedAt,
              lastCycleCompletedAt: runtimeState?.lastCycleCompletedAt,
              lastCycleDurationMs: runtimeState?.lastCycleDurationMs,
              lastCycleOutcome: sanitizeCycleOutcome(runtimeState?.lastCycleOutcome),
            }
          : undefined,
        observer: runtimeState
          ? {
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
            }
          : undefined,
        paths: {
          rustMuleLogPath: this.rustMuleLogPath,
          llmLogDir: this.llmLogDir,
          proposalDir: this.proposalDir,
        },
      });
      return;
    }

    if (path === "/api/logs/app") {
      const lines = clampInt(
        parseInt(url.searchParams.get("lines") ?? "", 10),
        DEFAULT_LOG_LINES,
        1,
        MAX_LOG_LINES,
      );
      sendJson(res, 200, {
        ok: true,
        lines: this.getAppLogs(lines).map(redactLine),
      });
      return;
    }

    if (path === "/api/logs/rust-mule") {
      const lines = clampInt(
        parseInt(url.searchParams.get("lines") ?? "", 10),
        DEFAULT_LOG_LINES,
        1,
        MAX_LOG_LINES,
      );
      const content = await readTailLines(this.rustMuleLogPath, lines, MAX_FILE_BYTES);
      sendJson(res, 200, { ok: true, lines: content.map(redactLine) });
      return;
    }

    if (path === "/api/llm/logs") {
      const files = await listFiles(this.llmLogDir, (name) => /^LLM_.*\.log$/i.test(name));
      sendJson(res, 200, { ok: true, files });
      return;
    }

    if (path.startsWith("/api/llm/logs/")) {
      const fileName = decodeURIComponent(path.slice("/api/llm/logs/".length));
      const content = await readFromAllowedDir(this.llmLogDir, fileName, MAX_FILE_BYTES);
      sendJson(res, 200, {
        ok: true,
        file: content.name,
        sizeBytes: content.sizeBytes,
        truncated: content.truncated,
        content: redactText(content.content),
      });
      return;
    }

    if (path === "/api/proposals") {
      const files = await listFiles(this.proposalDir, (name) => name.toLowerCase().endsWith(".patch"));
      sendJson(res, 200, { ok: true, files });
      return;
    }

    if (path.startsWith("/api/proposals/")) {
      const fileName = decodeURIComponent(path.slice("/api/proposals/".length));
      const content = await readFromAllowedDir(this.proposalDir, fileName, MAX_FILE_BYTES);
      sendJson(res, 200, {
        ok: true,
        file: content.name,
        sizeBytes: content.sizeBytes,
        truncated: content.truncated,
        content: redactText(content.content),
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  }

  private async handleObserverRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.observerControl) {
      sendJson(res, 501, { ok: false, error: "observer control unavailable" });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    const result = this.observerControl.triggerRunNow();
    if (!result.accepted) {
      sendJson(res, 409, { ok: false, error: result.reason ?? "observer run not accepted" });
      return;
    }
    let target: DiagnosticTargetRef | undefined;
    try {
      target = this.diagnosticTarget ? await this.diagnosticTarget.getActiveTarget() : undefined;
    } catch (err) {
      log("warn", "operatorConsole", `Failed to resolve active target for run-now event: ${String(err)}`);
    }
    await this.appendOperatorEvent({
      type: "observer_run_requested",
      message: `Operator triggered a scheduled observer cycle for ${describeDiagnosticTarget(target)}`,
      target,
      actor: "operator_console",
    });
    sendJson(res, 202, {
      ok: true,
      accepted: true,
      scheduler: this.observerControl.getStatus(),
    });
  }

  private async handleOperatorEvents(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.operatorEvents) {
      sendJson(res, 501, { ok: false, error: "operator event history unavailable" });
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    const limit = clampInt(
      parseInt(url.searchParams.get("limit") ?? "", 10),
      30,
      1,
      200,
    );
    const events = await this.operatorEvents.listRecent(limit);
    sendJson(res, 200, {
      ok: true,
      events: events.map((event) => ({
        ...event,
        message: redactText(event.message),
      })),
    });
  }

  private async handleInstanceComparison(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.managedInstances || !this.managedInstanceDiagnostics) {
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
      const instances = await this.managedInstances!.listInstances();
      const leftInstance = instances.find((instance) => instance.id === leftId);
      const rightInstance = instances.find((instance) => instance.id === rightId);
      if (!leftInstance) {
        throw new Error(`Managed instance not found: ${leftId}`);
      }
      if (!rightInstance) {
        throw new Error(`Managed instance not found: ${rightId}`);
      }
      const [leftSnapshot, rightSnapshot] = await Promise.all([
        this.managedInstanceDiagnostics!.getSnapshot(leftId),
        this.managedInstanceDiagnostics!.getSnapshot(rightId),
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

    sendJson(res, 200, {
      ok: true,
      comparison,
    });
  }

  private async handleDiagnosticTarget(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.diagnosticTarget) {
      sendJson(res, 501, { ok: false, error: "diagnostic target control unavailable" });
      return;
    }

    if (req.method === "GET") {
      const target = await this.diagnosticTarget.getActiveTarget();
      sendJson(res, 200, { ok: true, target });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    const payload = await readJsonBody(req);
    const target = await handleManagedInstanceErrors(() =>
      this.diagnosticTarget!.setActiveTarget({
        kind:
          (typeof payload.kind === "string" ? payload.kind : "external") as DiagnosticTargetRef["kind"],
        instanceId: typeof payload.instanceId === "string" ? payload.instanceId : undefined,
      }),
    );
    sendJson(res, 200, { ok: true, target });
  }

  private async handleInstancesCollection(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.managedInstances) {
      sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
      return;
    }

    if (req.method === "GET") {
      const instances = await this.managedInstances.listInstances();
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
      this.managedInstances!.createPlannedInstance({ id, apiPort }),
    );
    await this.appendManagedInstanceControlEvent(
      created,
      `Operator created planned managed instance ${created.id}.`,
    );
    sendJson(res, 201, { ok: true, instance: created });
  }

  private async handleInstancePresets(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.managedInstancePresets) {
      sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      presets: this.managedInstancePresets.listPresets(),
    });
  }

  private async handleApplyInstancePreset(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.managedInstancePresets) {
      sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    const payload = await readJsonBody(req);
    const applied = await handleManagedInstanceErrors(() =>
      this.managedInstancePresets!.applyPreset({
        presetId: typeof payload.presetId === "string" ? payload.presetId : "",
        prefix: typeof payload.prefix === "string" ? payload.prefix : "",
      }),
    );
    await this.appendManagedInstanceControlEvents(
      applied.instances,
      (instance) =>
        `Operator applied preset ${applied.presetId} and created planned managed instance ${instance.id}.`,
    );
    sendJson(res, 201, { ok: true, applied });
  }

  private async handleInstancePresetAction(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<void> {
    if (!this.managedInstancePresets) {
      sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
      return;
    }

    const suffix = path.slice("/api/instance-presets/".length);
    const [prefixRaw, action] = suffix.split("/");
    let prefix = "";
    try {
      prefix = decodeURIComponent(prefixRaw ?? "").trim();
    } catch {
      sendJson(res, 400, {
        ok: false,
        error: "invalid percent-encoding in preset group prefix",
      });
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
        return this.managedInstancePresets!.startPreset(prefix);
      }
      if (action === "stop") {
        return this.managedInstancePresets!.stopPreset(prefix);
      }
      return this.managedInstancePresets!.restartPreset(prefix);
    });
    await this.appendManagedInstanceControlEvents(
      result.instances,
      (instance) => `Operator ${actionVerb} managed instance ${instance.id} from preset group ${prefix}.`,
    );
    if (action === "start") {
      sendJson(res, 200, { ok: true, result, started: result });
      return;
    }
    sendJson(res, 200, { ok: true, result });
  }

  private async handleInstanceAction(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<void> {
    const suffix = path.slice("/api/instances/".length);
    const [idRaw, action, ...rest] = suffix.split("/");
    const id = decodeURIComponent(idRaw ?? "").trim();
    if (!id) {
      sendJson(res, 400, { ok: false, error: "missing instance id" });
      return;
    }

    if (!action) {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      if (!this.managedInstances) {
        sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
        return;
      }
      const instance = await this.findManagedInstance(id);
      if (!instance) {
        sendJson(res, 404, { ok: false, error: `managed instance not found: ${id}` });
        return;
      }
      sendJson(res, 200, { ok: true, instance });
      return;
    }

    if (action === "logs") {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      if (!this.managedInstances) {
        sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
        return;
      }
      const instance = await this.findManagedInstance(id);
      if (!instance) {
        sendJson(res, 404, { ok: false, error: `managed instance not found: ${id}` });
        return;
      }
      const lines = clampInt(
        parseInt(new URL(req.url ?? "/", "http://operator-console.local").searchParams.get("lines") ?? "", 10),
        DEFAULT_LOG_LINES,
        1,
        MAX_LOG_LINES,
      );
      const content = await readTailLines(instance.runtime.logPath, lines, MAX_FILE_BYTES);
      sendJson(res, 200, {
        ok: true,
        instance: {
          id: instance.id,
          status: instance.status,
        },
        lines: content.map(redactLine),
      });
      return;
    }

    if (action === "diagnostics") {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      if (!this.managedInstanceDiagnostics) {
        sendJson(res, 501, { ok: false, error: "managed instance diagnostics unavailable" });
        return;
      }
      const snapshot = await handleManagedInstanceErrors(() =>
        this.managedInstanceDiagnostics!.getSnapshot(id),
      );
      sendJson(res, 200, { ok: true, snapshot });
      return;
    }

    if (action === "analyze") {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      if (!this.managedInstanceAnalysis) {
        sendJson(res, 501, { ok: false, error: "managed instance analysis unavailable" });
        return;
      }
      const analysis = await handleManagedInstanceErrors(() =>
        this.managedInstanceAnalysis!.analyze(id),
      );
      sendJson(res, 200, { ok: true, analysis });
      return;
    }

    if (action === "shared") {
      await this.handleInstanceSharedAction(req, res, id, rest);
      return;
    }

    if (!this.managedInstances) {
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
    const lifecycleAction = action;
    const actionVerb = pastTenseVerb(lifecycleAction);

    let instance: ManagedInstanceRecord;
    if (lifecycleAction === "start") {
      instance = await handleManagedInstanceErrors(() => this.managedInstances!.startInstance(id));
    } else if (lifecycleAction === "stop") {
      instance = await handleManagedInstanceErrors(() =>
        this.managedInstances!.stopInstance(id, "stopped from operator console"),
      );
    } else {
      instance = await handleManagedInstanceErrors(() => this.managedInstances!.restartInstance(id));
    }
    await this.appendManagedInstanceControlEvent(
      instance,
      `Operator ${actionVerb} managed instance ${instance.id}.`,
    );

    sendJson(res, 200, { ok: true, instance });
  }

  private async handleInstanceSharedAction(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    actionSegments: string[],
  ): Promise<void> {
    if (!this.managedInstanceSharing) {
      sendJson(res, 501, { ok: false, error: "managed instance shared-content control unavailable" });
      return;
    }

    const [subAction] = actionSegments;
    if (!subAction) {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      const shared = await handleManagedInstanceErrors(() =>
        this.managedInstanceSharing!.getOverview(id),
      );
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
        this.managedInstanceSharing!.ensureFixture(id, {
          fixtureId: typeof payload.fixtureId === "string" ? payload.fixtureId : undefined,
        }),
      );
      await this.appendOperatorEvent({
        type: "managed_instance_control_applied",
        message: `Operator created discoverability fixture ${fixture.fileName} for managed instance ${id}.`,
        target: {
          kind: "managed_instance",
          instanceId: id,
        },
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
        return this.managedInstanceSharing!.reindex(id);
      }
      if (subAction === "republish_sources") {
        return this.managedInstanceSharing!.republishSources(id);
      }
      return this.managedInstanceSharing!.republishKeywords(id);
    });
    await this.appendOperatorEvent({
      type: "managed_instance_control_applied",
      message: `Operator triggered ${subAction} for managed instance ${id} shared content.`,
      target: {
        kind: "managed_instance",
        instanceId: id,
      },
      actor: "operator_console",
    });
    sendJson(res, 200, { ok: true, shared });
  }

  private async appendManagedInstanceControlEvent(
    instance: ManagedInstanceRecord,
    message: string,
  ): Promise<void> {
    await this.appendOperatorEvent({
      type: "managed_instance_control_applied",
      message,
      target: {
        kind: "managed_instance",
        instanceId: instance.id,
      },
      actor: "operator_console",
    });
  }

  private async appendManagedInstanceControlEvents(
    instances: ManagedInstanceRecord[],
    buildMessage: (instance: ManagedInstanceRecord) => string,
  ): Promise<void> {
    if (instances.length === 0) {
      return;
    }
    await this.appendOperatorEvents(
      instances.map((instance) => ({
        type: "managed_instance_control_applied" as const,
        message: buildMessage(instance),
        target: {
          kind: "managed_instance" as const,
          instanceId: instance.id,
        },
        actor: "operator_console",
      })),
    );
  }

  private async appendOperatorEvent(
    event: Parameters<NonNullable<OperatorEventsStore["append"]>>[0],
  ): Promise<void> {
    await this.appendOperatorEvents([event]);
  }

  private async appendOperatorEvents(
    events: Parameters<NonNullable<OperatorEventsStore["append"]>>[0][],
  ): Promise<void> {
    if (!this.operatorEvents) {
      return;
    }
    try {
      if (typeof this.operatorEvents.appendMany === "function") {
        await this.operatorEvents.appendMany(events);
      } else {
        await Promise.all(events.map((event) => this.operatorEvents!.append(event)));
      }
    } catch (err) {
      log("warn", "operatorConsole", `Failed to append operator event: ${String(err)}`);
    }
  }

  private isSameOrigin(req: IncomingMessage): boolean {
    const origin = getHeaderValue(req.headers, "origin");
    if (!origin) {
      return true;
    }
    try {
      const parsedOrigin = new URL(origin);
      const reqHost = getHeaderValue(req.headers, "host");
      if (!reqHost) return false;
      return parsedOrigin.host === reqHost;
    } catch {
      return false;
    }
  }

  private async findManagedInstance(id: string): Promise<ManagedInstanceRecord | undefined> {
    if (!this.managedInstances) {
      throw new Error("Managed instances are not configured for this server.");
    }
    return (await this.managedInstances.listInstances()).find((candidate) => candidate.id === id);
  }

  private authenticate(req: IncomingMessage): AuthState {
    if (!this.authToken) return { ok: true };

    const cookieToken = getCookie(req.headers.cookie, AUTH_COOKIE_NAME);
    const bearerToken = getBearerToken(req.headers.authorization);
    const headerToken = getHeaderValue(req.headers, "x-operator-token");
    const provided = [cookieToken, bearerToken, headerToken].find(
      (candidate) => candidate !== undefined && candidate.length > 0,
    );
    return { ok: provided === this.authToken };
  }

  private async handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    const form = await readFormBody(req);
    const token = form.get("token")?.trim();
    if (!this.authToken) {
      redirect(res, "/");
      return;
    }
    if (!token || token !== this.authToken) {
      redirect(res, "/?error=Invalid%20operator%20token.");
      return;
    }

    res.statusCode = 303;
    applySecurityHeaders(res);
    res.setHeader(
      "Set-Cookie",
      `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
    );
    res.setHeader("Location", "/");
    res.end();
  }

  private handleLogout(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    res.statusCode = 303;
    applySecurityHeaders(res);
    res.setHeader(
      "Set-Cookie",
      `${AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
    );
    res.setHeader("Location", "/");
    res.end();
  }

  private async handleAppLogStream(
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.subscribeToAppLogs) {
      throw new RequestError(501, "app log streaming unavailable");
    }

    const initialLines = clampInt(
      parseInt(url.searchParams.get("lines") ?? "", 10),
      DEFAULT_STREAM_LINES,
      1,
      MAX_STREAM_LINES,
    );
    sendSseHeaders(res);
    writeSseEvent(res, "snapshot", { lines: this.getAppLogs(initialLines).map(redactLine) });

    const unsubscribe = this.subscribeToAppLogs((line) => {
      writeSseEvent(res, "line", { line: redactLine(line) });
    });
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, DEFAULT_STREAM_HEARTBEAT_MS);

    this.registerStream(req, res, () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  private async handleRustMuleLogStream(
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const initialLines = clampInt(
      parseInt(url.searchParams.get("lines") ?? "", 10),
      DEFAULT_STREAM_LINES,
      1,
      MAX_STREAM_LINES,
    );
    sendSseHeaders(res);
    writeSseEvent(res, "snapshot", {
      lines: (await readTailLines(this.rustMuleLogPath, initialLines, MAX_FILE_BYTES)).map(redactLine),
    });

    let lastOffset = await getFileSize(this.rustMuleLogPath);
    let partial = "";
    let stopped = false;
    let pollTimer: NodeJS.Timeout | undefined;
    const runPoll = () => {
      if (stopped) return;
      void (async () => {
        const next = await readStreamChunk(this.rustMuleLogPath, lastOffset, partial, MAX_FILE_BYTES);
        lastOffset = next.nextOffset;
        partial = next.partial;
        for (const line of next.lines) {
          writeSseEvent(res, "line", { line: redactLine(line) });
        }
      })().catch(() => {
        // Keep the stream alive across transient file-read errors.
      }).finally(() => {
        if (!stopped) {
          pollTimer = setTimeout(runPoll, this.rustMuleStreamPollMs);
        }
      });
    };
    pollTimer = setTimeout(runPoll, this.rustMuleStreamPollMs);
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, DEFAULT_STREAM_HEARTBEAT_MS);

    this.registerStream(req, res, () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearInterval(heartbeat);
    });
  }

  private registerStream(
    req: IncomingMessage,
    res: ServerResponse,
    cleanup: () => void,
  ): void {
    let cleanedUp = false;
    const finalize = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.streamCleanups.delete(finalize);
      cleanup();
      if (!res.writableEnded) {
        res.end();
      }
    };
    this.streamCleanups.add(finalize);
    req.on("close", finalize);
    res.on("close", finalize);
  }
}

function pastTenseVerb(action: "start" | "stop" | "restart"): string {
  if (action === "start") return "started";
  if (action === "stop") return "stopped";
  return "restarted";
}
