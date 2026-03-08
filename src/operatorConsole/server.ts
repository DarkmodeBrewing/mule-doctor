/**
 * server.ts
 * Read-only operator console for inspecting runtime health, logs, and proposals.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Stats } from "node:fs";
import type { ManagedInstanceRecord } from "../types/contracts.js";

const AUTH_COOKIE_NAME = "mule_doctor_ui_token";
const DEFAULT_UI_HOST = "127.0.0.1";
const DEFAULT_UI_PORT = 18080;
const DEFAULT_LOG_LINES = 200;
const DEFAULT_STREAM_LINES = 50;
const DEFAULT_STREAM_POLL_MS = 1000;
const DEFAULT_STREAM_HEARTBEAT_MS = 15000;
const MAX_LOG_LINES = 2000;
const MAX_STREAM_LINES = 500;
const MAX_FILE_BYTES = 512 * 1024;
const PUBLIC_UNAUTHENTICATED_ASSETS = new Set(["login.js", "styles.css"]);
const STATIC_DIR = resolve(__dirname, "public");

interface ListedFile {
  name: string;
  sizeBytes: number;
  updatedAt: string;
}

interface AuthState {
  ok: boolean;
}

interface StreamChunk {
  nextOffset: number;
  lines: string[];
  partial: string;
}

export interface ManagedInstanceControl {
  listInstances(): Promise<ManagedInstanceRecord[]>;
  createPlannedInstance(input: { id: string; apiPort?: number }): Promise<ManagedInstanceRecord>;
  startInstance(id: string): Promise<ManagedInstanceRecord>;
  stopInstance(id: string, reason?: string): Promise<ManagedInstanceRecord>;
  restartInstance(id: string): Promise<ManagedInstanceRecord>;
}

export interface OperatorConsoleConfig {
  authToken?: string;
  host?: string;
  port?: number;
  rustMuleLogPath: string;
  llmLogDir: string;
  proposalDir: string;
  getAppLogs: (n?: number) => string[];
  subscribeToAppLogs?: (listener: (line: string) => void) => () => void;
  rustMuleStreamPollMs?: number;
  managedInstances?: ManagedInstanceControl;
}

export class OperatorConsoleServer {
  private readonly authToken: string | undefined;
  private readonly host: string;
  private readonly port: number;
  private readonly rustMuleLogPath: string;
  private readonly llmLogDir: string;
  private readonly proposalDir: string;
  private readonly getAppLogs: (n?: number) => string[];
  private readonly subscribeToAppLogs: ((listener: (line: string) => void) => () => void) | undefined;
  private readonly rustMuleStreamPollMs: number;
  private readonly managedInstances: ManagedInstanceControl | undefined;
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
    this.subscribeToAppLogs = config.subscribeToAppLogs;
    this.rustMuleStreamPollMs = clampInt(
      config.rustMuleStreamPollMs,
      DEFAULT_STREAM_POLL_MS,
      100,
      60_000,
    );
    this.managedInstances = config.managedInstances;
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

    if (path.startsWith("/api/instances/")) {
      await this.handleInstanceAction(req, res, path);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    if (path === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        startedAt: this.startedAt,
        now: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
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
    const created = await this.managedInstances.createPlannedInstance({ id, apiPort });
    sendJson(res, 201, { ok: true, instance: created });
  }

  private async handleInstanceAction(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<void> {
    if (!this.managedInstances) {
      sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
      return;
    }

    const suffix = path.slice("/api/instances/".length);
    const [idRaw, action] = suffix.split("/");
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
      const instance = (await this.managedInstances.listInstances()).find((candidate) => candidate.id === id);
      if (!instance) {
        sendJson(res, 404, { ok: false, error: `managed instance not found: ${id}` });
        return;
      }
      sendJson(res, 200, { ok: true, instance });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    let instance: ManagedInstanceRecord;
    if (action === "start") {
      instance = await this.managedInstances.startInstance(id);
    } else if (action === "stop") {
      instance = await this.managedInstances.stopInstance(id, "stopped from operator console");
    } else if (action === "restart") {
      instance = await this.managedInstances.restartInstance(id);
    } else {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }

    sendJson(res, 200, { ok: true, instance });
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

async function listFiles(
  dirPath: string,
  include: (fileName: string) => boolean,
): Promise<ListedFile[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const output: ListedFile[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!include(entry.name)) continue;

      const absPath = resolve(dirPath, entry.name);
      const fileStat = await stat(absPath);
      output.push({
        name: entry.name,
        sizeBytes: fileStat.size,
        updatedAt: fileStat.mtime.toISOString(),
      });
    }

    output.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return output;
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

async function readTailLines(
  filePath: string,
  lineLimit: number,
  maxBytes: number,
): Promise<string[]> {
  let fileStat: Stats;
  try {
    fileStat = await stat(filePath);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }

  const readStart = Math.max(0, fileStat.size - maxBytes);
  const file = await open(filePath, "r");
  try {
    const bytesToRead = fileStat.size - readStart;
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, readStart);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (readStart > 0) {
      const firstNewline = text.indexOf("\n");
      if (firstNewline >= 0) {
        text = text.slice(firstNewline + 1);
      }
    }
    return text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-lineLimit);
  } finally {
    await file.close();
  }
}

async function readStreamChunk(
  filePath: string,
  offset: number,
  priorPartial: string,
  maxBytes: number,
): Promise<StreamChunk> {
  let fileStat: Stats;
  try {
    fileStat = await stat(filePath);
  } catch (err) {
    if (isNotFound(err)) {
      return { nextOffset: 0, lines: [], partial: "" };
    }
    throw err;
  }

  let start = offset;
  let partial = priorPartial;
  if (fileStat.size < offset) {
    start = 0;
    partial = "";
  }
  if (fileStat.size === start) {
    return { nextOffset: fileStat.size, lines: [], partial };
  }

  const desiredBytes = fileStat.size - start;
  if (desiredBytes > maxBytes) {
    start = fileStat.size - maxBytes;
    partial = "";
  }

  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(fileStat.size - start > maxBytes ? maxBytes : fileStat.size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const combined = partial + buffer.subarray(0, bytesRead).toString("utf8");
    const rawLines = combined.split(/\r?\n/);
    const nextPartial = combined.endsWith("\n") ? "" : rawLines.pop() ?? "";
    return {
      nextOffset: start + bytesRead,
      lines: rawLines.map((line) => line.trimEnd()).filter((line) => line.length > 0),
      partial: nextPartial,
    };
  } finally {
    await file.close();
  }
}

interface SafeReadResult {
  name: string;
  sizeBytes: number;
  truncated: boolean;
  content: string;
}

class RequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "RequestError";
  }
}

async function readFromAllowedDir(
  baseDir: string,
  fileNameRaw: string,
  maxBytes: number,
): Promise<SafeReadResult> {
  const fileName = fileNameRaw.trim();
  if (!fileName || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    throw new RequestError(400, `invalid file name: ${fileNameRaw}`);
  }

  const base = resolve(baseDir);
  const target = resolve(baseDir, fileName);
  const rel = relative(base, target);
  if (rel.startsWith("..") || isAbsolute(rel) || (!target.startsWith(base + sep) && target !== base)) {
    throw new RequestError(400, "path escapes allowed directory");
  }

  let fileStat: Stats;
  try {
    fileStat = await stat(target);
  } catch (err) {
    if (isNotFound(err)) {
      throw new RequestError(404, `file not found: ${fileName}`);
    }
    throw err;
  }
  if (!fileStat.isFile()) {
    throw new RequestError(404, `not a regular file: ${fileName}`);
  }

  const file = await open(target, "r");
  try {
    const bytes = Math.min(fileStat.size, maxBytes);
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return {
      name: fileName,
      sizeBytes: fileStat.size,
      truncated: fileStat.size > maxBytes,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
    };
  } finally {
    await file.close();
  }
}

function sanitizeHost(rawHost: string | undefined): string {
  const host = rawHost?.trim();
  if (!host) return DEFAULT_UI_HOST;
  return host;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof err["code"] === "string" &&
    err["code"] === "ENOENT"
  );
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size;
  } catch (err) {
    if (isNotFound(err)) return 0;
    throw err;
  }
}

function redactLine(line: string): string {
  return redactText(line);
}

function redactText(text: string): string {
  return text
    .replace(/(authorization"\s*:\s*"bearer\s+)[^"]+/gi, "$1[redacted]")
    .replace(/(x-debug-token"\s*:\s*")[^"]+/gi, '$1[redacted]')
    .replace(/(openai_api_key\s*=\s*)\S+/gi, "$1[redacted]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/gi, "$1[redacted]")
    .replace(/(token\s*[=:]\s*)\S+/gi, "$1[redacted]");
}

function getCookie(rawCookieHeader: string | undefined, cookieName: string): string | undefined {
  if (!rawCookieHeader) return undefined;
  const cookies = rawCookieHeader.split(";");
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function getBearerToken(rawHeader: string | undefined): string | undefined {
  if (!rawHeader) return undefined;
  const trimmed = rawHeader.trim();
  if (trimmed.length < 8) return undefined;
  const prefix = trimmed.slice(0, 7);
  if (prefix.toLowerCase() !== "bearer ") return undefined;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

function getHeaderValue(
  headers: IncomingMessage["headers"],
  name: string,
): string | undefined {
  const rawValue = headers[name];
  if (typeof rawValue === "string") return rawValue;
  return Array.isArray(rawValue) ? rawValue[0] : undefined;
}

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON body must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new RequestError(400, `invalid JSON body: ${String(err)}`);
  }
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  applySecurityHeaders(res);
  res.end(JSON.stringify(payload));
}

async function sendStaticHtml(res: ServerResponse, fileName: string): Promise<void> {
  const content = await readStaticAsset(fileName);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  applySecurityHeaders(res);
  res.end(content);
}

async function sendStaticAsset(res: ServerResponse, fileNameRaw: string): Promise<void> {
  const fileName = fileNameRaw.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName) || fileName.startsWith(".")) {
    throw new RequestError(404, "not found");
  }
  if (fileName.toLowerCase().endsWith(".html")) {
    throw new RequestError(404, "not found");
  }
  const content = await readStaticAsset(fileName);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypeForStaticAsset(fileName));
  applySecurityHeaders(res);
  res.end(content);
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 303;
  applySecurityHeaders(res);
  res.setHeader("Location", location);
  res.end();
}

function sendSseHeaders(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Connection", "keep-alive");
  applySecurityHeaders(res);
  res.flushHeaders?.();
}

function writeSseEvent(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readStaticAsset(fileName: string): Promise<Buffer> {
  const filePath = resolve(STATIC_DIR, fileName);
  const rel = relative(STATIC_DIR, filePath);
  if (
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    (!filePath.startsWith(STATIC_DIR + sep) && filePath !== STATIC_DIR)
  ) {
    throw new RequestError(404, "not found");
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new RequestError(404, "not found");
    }
    return await readFile(filePath);
  } catch (err) {
    if (err instanceof RequestError) {
      throw err;
    }
    if (isNotFound(err)) {
      throw new RequestError(404, "not found");
    }
    throw err;
  }
}

function contentTypeForStaticAsset(fileName: string): string {
  if (fileName.endsWith(".css")) return "text/css; charset=utf-8";
  if (fileName.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (fileName.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}
