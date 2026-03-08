/**
 * server.ts
 * Read-only operator console for inspecting runtime health, logs, and proposals.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { open, readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Stats } from "node:fs";

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

    if (path === "/" || path === "/index.html") {
      if (!auth.ok) {
        sendHtml(res, renderLoginHtml());
        return;
      }
      sendHtml(res, renderIndexHtml());
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
      sendHtml(res, renderLoginHtml("Invalid operator token."));
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

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  applySecurityHeaders(res);
  res.end(html);
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

function renderLoginHtml(errorMessage?: string): string {
  const errorBanner = errorMessage
    ? `<p class="status error">${escapeHtml(errorMessage)}</p>`
    : `<p class="status">Authentication required to access the operator console.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>mule-doctor operator console login</title>
  <style>
    :root {
      --bg: #131112;
      --panel: rgba(28, 20, 18, 0.88);
      --line: #614338;
      --text: #f4ece8;
      --muted: #d0b4a8;
      --accent: #ff9b54;
      --error: #ff6b6b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      color: var(--text);
      font-family: "Azeret Mono", "IBM Plex Sans", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(255,155,84,.24), transparent 34%),
        radial-gradient(circle at bottom right, rgba(255,107,107,.2), transparent 32%),
        linear-gradient(160deg, #0f0b0d, #1f1512 60%, #120f14);
    }
    .panel {
      width: min(100%, 440px);
      padding: 28px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(18px);
      box-shadow: 0 18px 60px rgba(0,0,0,.35);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 1.4rem;
    }
    p {
      margin: 0 0 18px;
      color: var(--muted);
      line-height: 1.45;
    }
    .status.error {
      color: var(--error);
    }
    label {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 0.9rem;
    }
    input {
      width: 100%;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: rgba(12, 10, 11, 0.85);
      color: var(--text);
      margin-bottom: 14px;
      font: inherit;
    }
    button {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--accent);
      border-radius: 999px;
      background: linear-gradient(90deg, #ff9b54, #ff6b6b);
      color: #1d0f0d;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <form class="panel" method="POST" action="/auth/login">
    <h1>mule-doctor operator console</h1>
    ${errorBanner}
    <label for="token">Operator token</label>
    <input id="token" name="token" type="password" autocomplete="current-password" required />
    <button type="submit">Unlock console</button>
  </form>
</body>
</html>`;
}

function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>mule-doctor operator console</title>
  <style>
    :root {
      --bg: #11151d;
      --panel: rgba(17, 22, 31, 0.92);
      --line: #304358;
      --text: #edf4fb;
      --muted: #92a9bf;
      --accent: #8cf0c6;
      --accent-strong: #38bdf8;
      --warn: #fbbf24;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Space Grotesk", "IBM Plex Sans", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top, rgba(56,189,248,.18), transparent 32%),
        linear-gradient(180deg, #0b1018, #131a24 58%, #0e131a);
      min-height: 100vh;
    }
    .wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 16px;
    }
    .hero, .card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--panel);
      box-shadow: 0 18px 40px rgba(0,0,0,.18);
    }
    .hero {
      padding: 20px;
      position: relative;
      overflow: hidden;
    }
    .hero::after {
      content: "";
      position: absolute;
      inset: auto -40px -40px auto;
      width: 180px;
      height: 180px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(140,240,198,.24), transparent 70%);
      pointer-events: none;
    }
    .hero-top, .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .hero h1, .card h2 {
      margin: 0;
    }
    .hero h1 {
      font-size: 1.35rem;
    }
    .hero p, .muted {
      color: var(--muted);
    }
    .hero p {
      margin: 10px 0 0;
      max-width: 64ch;
      line-height: 1.5;
    }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    }
    .card {
      padding: 14px;
    }
    .card h2 {
      font-size: 1rem;
      color: var(--accent);
    }
    .controls {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button, .ghost {
      border: 1px solid var(--line);
      background: rgba(11, 16, 24, 0.8);
      color: var(--text);
      border-radius: 999px;
      padding: 8px 12px;
      cursor: pointer;
      text-decoration: none;
      font: inherit;
    }
    button:hover, .ghost:hover {
      border-color: var(--accent-strong);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .status::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--warn);
    }
    .status.live::before {
      background: var(--accent);
      box-shadow: 0 0 14px rgba(140,240,198,.6);
    }
    pre {
      margin: 0;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid rgba(48,67,88,.8);
      background: #08111a;
      min-height: 150px;
      max-height: 360px;
      overflow: auto;
      white-space: pre-wrap;
      font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      font-size: 12px;
      line-height: 1.38;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    li button {
      width: 100%;
      text-align: left;
      border-radius: 12px;
    }
    .file-meta {
      display: block;
      color: var(--muted);
      font-size: 0.78rem;
      margin-top: 4px;
    }
    @media (max-width: 720px) {
      .wrap {
        padding: 14px;
      }
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="hero-top">
        <div>
          <h1>mule-doctor operator console</h1>
          <p>Observe process health, stream logs live, and inspect proposed patches without leaving the browser. This view is read-only and secured by an operator token.</p>
        </div>
        <div class="controls">
          <button id="refresh-all">Refresh all</button>
          <form method="POST" action="/auth/logout">
            <button class="ghost" type="submit">Log out</button>
          </form>
        </div>
      </div>
      <pre id="health">Loading health...</pre>
    </section>

    <section class="grid">
      <article class="card">
        <div class="row">
          <h2>App Logs</h2>
          <div class="controls">
            <span id="app-stream-status" class="status">connecting</span>
            <button id="refresh-app">Refresh</button>
          </div>
        </div>
        <pre id="app-logs"></pre>
      </article>
      <article class="card">
        <div class="row">
          <h2>rust-mule Logs</h2>
          <div class="controls">
            <span id="rust-stream-status" class="status">connecting</span>
            <button id="refresh-rust">Refresh</button>
          </div>
        </div>
        <pre id="rust-logs"></pre>
      </article>
      <article class="card">
        <div class="row">
          <h2>LLM Logs</h2>
          <button id="refresh-llm-list">Refresh</button>
        </div>
        <ul id="llm-files"></ul>
        <pre id="llm-content" class="muted">Select a log file.</pre>
      </article>
      <article class="card">
        <div class="row">
          <h2>Patch Proposals</h2>
          <button id="refresh-proposals">Refresh</button>
        </div>
        <ul id="proposal-files"></ul>
        <pre id="proposal-content" class="muted">Select a proposal file.</pre>
      </article>
    </section>
  </div>

  <script>
    const LOG_LINE_LIMIT = 250;

    async function fetchJson(url) {
      const res = await fetch(url, { credentials: "same-origin" });
      if (res.status === 401) {
        window.location.href = "/";
        throw new Error("authentication required");
      }
      if (!res.ok) throw new Error(url + " failed: " + res.status);
      return res.json();
    }

    function setText(id, text) {
      document.getElementById(id).textContent = text;
    }

    function appendLine(id, line) {
      const element = document.getElementById(id);
      const lines = element.textContent ? element.textContent.split("\\n") : [];
      lines.push(line);
      element.textContent = lines.slice(-LOG_LINE_LIMIT).join("\\n");
      element.scrollTop = element.scrollHeight;
    }

    function setStreamStatus(id, isLive, text) {
      const element = document.getElementById(id);
      element.textContent = text;
      element.className = isLive ? "status live" : "status";
    }

    function renderFileList(targetId, files, onClick) {
      const ul = document.getElementById(targetId);
      ul.innerHTML = "";
      if (!files.length) {
        const li = document.createElement("li");
        li.textContent = "No files found.";
        li.className = "muted";
        ul.appendChild(li);
        return;
      }
      for (const file of files) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        const title = document.createElement("strong");
        const meta = document.createElement("span");
        const updated = file.updatedAt ? new Date(file.updatedAt).toLocaleString() : "unknown";
        title.textContent = file.name;
        meta.className = "file-meta";
        meta.textContent = file.sizeBytes + " bytes • " + updated;
        button.appendChild(title);
        button.appendChild(meta);
        button.onclick = () => onClick(file.name);
        li.appendChild(button);
        ul.appendChild(li);
      }
    }

    async function refreshHealth() {
      const data = await fetchJson("/api/health");
      setText("health", JSON.stringify(data, null, 2));
    }

    async function refreshAppLogs() {
      const data = await fetchJson("/api/logs/app?lines=" + LOG_LINE_LIMIT);
      setText("app-logs", data.lines.join("\\n") || "No captured lines yet.");
    }

    async function refreshRustLogs() {
      const data = await fetchJson("/api/logs/rust-mule?lines=" + LOG_LINE_LIMIT);
      setText("rust-logs", data.lines.join("\\n") || "No rust-mule lines available.");
    }

    async function refreshLlmList() {
      const data = await fetchJson("/api/llm/logs");
      renderFileList("llm-files", data.files, async (name) => {
        const detail = await fetchJson("/api/llm/logs/" + encodeURIComponent(name));
        const suffix = detail.truncated ? "\\n\\n[truncated]" : "";
        setText("llm-content", detail.content + suffix);
      });
    }

    async function refreshProposalList() {
      const data = await fetchJson("/api/proposals");
      renderFileList("proposal-files", data.files, async (name) => {
        const detail = await fetchJson("/api/proposals/" + encodeURIComponent(name));
        const suffix = detail.truncated ? "\\n\\n[truncated]" : "";
        setText("proposal-content", detail.content + suffix);
      });
    }

    function connectStream(url, targetId, statusId) {
      const stream = new EventSource(url, { withCredentials: true });
      stream.addEventListener("open", () => setStreamStatus(statusId, true, "live"));
      stream.addEventListener("snapshot", (event) => {
        const payload = JSON.parse(event.data);
        setText(targetId, payload.lines.join("\\n"));
      });
      stream.addEventListener("line", (event) => {
        const payload = JSON.parse(event.data);
        appendLine(targetId, payload.line);
      });
      stream.addEventListener("error", () => {
        setStreamStatus(statusId, false, "reconnecting");
      });
      return stream;
    }

    async function refreshAll() {
      try {
        await Promise.all([refreshHealth(), refreshAppLogs(), refreshRustLogs(), refreshLlmList(), refreshProposalList()]);
      } catch (err) {
        setText("health", "Refresh failed: " + err);
      }
    }

    document.getElementById("refresh-all").onclick = refreshAll;
    document.getElementById("refresh-app").onclick = refreshAppLogs;
    document.getElementById("refresh-rust").onclick = refreshRustLogs;
    document.getElementById("refresh-llm-list").onclick = refreshLlmList;
    document.getElementById("refresh-proposals").onclick = refreshProposalList;

    refreshAll().finally(() => {
      connectStream("/api/stream/app?lines=" + LOG_LINE_LIMIT, "app-logs", "app-stream-status");
      connectStream("/api/stream/rust-mule?lines=" + LOG_LINE_LIMIT, "rust-logs", "rust-stream-status");
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
