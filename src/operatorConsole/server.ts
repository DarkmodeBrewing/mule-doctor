/**
 * server.ts
 * Read-only operator console for inspecting runtime health, logs, and proposals.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { redactLine } from "../logs/redaction.js";
import type {
  DiagnosticTargetRef,
  ManagedInstanceRecord,
  RuntimeState,
} from "../types/contracts.js";
import {
  AUTH_COOKIE_NAME,
  DEFAULT_STREAM_HEARTBEAT_MS,
  DEFAULT_STREAM_LINES,
  DEFAULT_STREAM_POLL_MS,
  DEFAULT_UI_PORT,
  MAX_FILE_BYTES,
  MAX_STREAM_LINES,
  PUBLIC_UNAUTHENTICATED_ASSETS,
} from "./constants.js";
import {
  applySecurityHeaders,
  getBearerToken,
  getCookie,
  getHeaderValue,
  readFormBody,
  redirect,
  RequestError,
  sendJson,
  sendSseHeaders,
  writeSseEvent,
} from "./http.js";
import { handleGeneralApiRoute } from "./serverGeneralRoutes.js";
import { handleManagedInstanceApiRoute } from "./serverManagedInstanceRoutes.js";
import {
  getFileSize,
  readStreamChunk,
  readTailLines,
  sendStaticAsset,
  sendStaticHtml,
} from "./files.js";
import {
  clampInt,
  log,
  sanitizeHost,
} from "./serverUtils.js";
import type {
  AuthState,
  DiagnosticTargetControl,
  ManagedInstanceAnalysis,
  ManagedInstanceControl,
  ManagedInstanceDiscoverability,
  ManagedInstanceDiagnostics,
  ManagedInstanceSurfaceDiagnostics,
  ManagedInstancePresets,
  ManagedInstanceSharing,
  OperatorSearches,
  OperatorConsoleConfig,
  OperatorEventsStore,
  ObserverControl,
} from "./types.js";
import type { LlmInvocationGate } from "../llm/invocationGate.js";

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
  private readonly managedInstanceSurfaceDiagnostics: ManagedInstanceSurfaceDiagnostics | undefined;
  private readonly managedInstanceAnalysis: ManagedInstanceAnalysis | undefined;
  private readonly managedInstanceSharing: ManagedInstanceSharing | undefined;
  private readonly managedInstanceDiscoverability: ManagedInstanceDiscoverability | undefined;
  private readonly operatorSearches: OperatorSearches | undefined;
  private readonly managedInstancePresets: ManagedInstancePresets | undefined;
  private readonly diagnosticTarget: DiagnosticTargetControl | undefined;
  private readonly observerControl: ObserverControl | undefined;
  private readonly operatorEvents:
    | OperatorConsoleConfig["operatorEvents"]
    | undefined;
  private readonly discoverabilityResults:
    | OperatorConsoleConfig["discoverabilityResults"]
    | undefined;
  private readonly searchHealthResults:
    | OperatorConsoleConfig["searchHealthResults"]
    | undefined;
  private readonly llmInvocationResults:
    | OperatorConsoleConfig["llmInvocationResults"]
    | undefined;
  private readonly humanInvocationGate: LlmInvocationGate | undefined;
  private readonly invocationAudit: OperatorConsoleConfig["invocationAudit"] | undefined;
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
    this.managedInstanceSurfaceDiagnostics = config.managedInstanceSurfaceDiagnostics;
    this.managedInstanceAnalysis = config.managedInstanceAnalysis;
    this.managedInstanceSharing = config.managedInstanceSharing;
    this.managedInstanceDiscoverability = config.managedInstanceDiscoverability;
    this.operatorSearches = config.operatorSearches;
    this.managedInstancePresets = config.managedInstancePresets;
    this.diagnosticTarget = config.diagnosticTarget;
    this.observerControl = config.observerControl;
    this.operatorEvents = config.operatorEvents;
    this.discoverabilityResults = config.discoverabilityResults;
    this.searchHealthResults = config.searchHealthResults;
    this.llmInvocationResults = config.llmInvocationResults;
    this.humanInvocationGate = config.humanInvocationGate;
    this.invocationAudit = config.invocationAudit;
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

    if (await handleGeneralApiRoute(this.generalRouteContext(), req, res, url, path)) {
      return;
    }
    if (await handleManagedInstanceApiRoute(this.managedInstanceRouteContext(), req, res, path)) {
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
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

  private async appendInvocationAudit(record: {
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
  }): Promise<void> {
    if (!this.invocationAudit) {
      return;
    }
    try {
      await this.invocationAudit.append({
        recordedAt: record.completedAt,
        surface: record.surface,
        trigger: record.trigger,
        target: record.target,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        durationMs: record.durationMs,
        toolCalls: record.toolCalls,
        toolRounds: record.toolRounds,
        finishReason: record.finishReason,
        rateLimitReason: record.rateLimitReason,
        retryAfterSec: record.retryAfterSec,
      });
    } catch (err) {
      log("warn", "operatorConsole", `Failed to append invocation audit: ${String(err)}`);
    }
  }

  private generalRouteContext() {
    return {
      startedAt: this.startedAt,
      rustMuleLogPath: this.rustMuleLogPath,
      llmLogDir: this.llmLogDir,
      proposalDir: this.proposalDir,
      getAppLogs: this.getAppLogs,
      getRuntimeState: this.getRuntimeState,
      managedInstances: this.managedInstances,
      managedInstanceDiagnostics: this.managedInstanceDiagnostics,
      diagnosticTarget: this.diagnosticTarget,
      observerControl: this.observerControl,
      operatorEvents: this.operatorEvents,
      discoverabilityResults: this.discoverabilityResults,
      searchHealthResults: this.searchHealthResults,
      llmInvocationResults: this.llmInvocationResults,
      humanInvocationGate: this.humanInvocationGate,
      appendOperatorEvent: this.appendOperatorEvent.bind(this),
      appendInvocationAudit: this.appendInvocationAudit.bind(this),
    };
  }

  private managedInstanceRouteContext() {
    return {
      managedInstances: this.managedInstances,
      managedInstanceDiagnostics: this.managedInstanceDiagnostics,
      managedInstanceSurfaceDiagnostics: this.managedInstanceSurfaceDiagnostics,
      managedInstanceAnalysis: this.managedInstanceAnalysis,
      managedInstanceSharing: this.managedInstanceSharing,
      managedInstanceDiscoverability: this.managedInstanceDiscoverability,
      operatorSearches: this.operatorSearches,
      managedInstancePresets: this.managedInstancePresets,
      diagnosticTarget: this.diagnosticTarget,
      discoverabilityResults: this.discoverabilityResults,
      searchHealthResults: this.searchHealthResults,
      humanInvocationGate: this.humanInvocationGate,
      appendManagedInstanceControlEvent: this.appendManagedInstanceControlEvent.bind(this),
      appendManagedInstanceControlEvents: this.appendManagedInstanceControlEvents.bind(this),
      appendOperatorEvent: this.appendOperatorEvent.bind(this),
      appendInvocationAudit: this.appendInvocationAudit.bind(this),
      findManagedInstance: this.findManagedInstance.bind(this),
    };
  }
}
