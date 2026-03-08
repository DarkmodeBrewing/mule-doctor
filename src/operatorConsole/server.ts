/**
 * server.ts
 * Read-only operator console for inspecting runtime health, logs, and proposals.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { open, readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Stats } from "node:fs";

const DEFAULT_UI_HOST = "127.0.0.1";
const DEFAULT_UI_PORT = 18080;
const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 2000;
const MAX_FILE_BYTES = 512 * 1024;

interface ListedFile {
  name: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface OperatorConsoleConfig {
  host?: string;
  port?: number;
  rustMuleLogPath: string;
  llmLogDir: string;
  proposalDir: string;
  getAppLogs: (n?: number) => string[];
}

export class OperatorConsoleServer {
  private readonly host: string;
  private readonly port: number;
  private readonly rustMuleLogPath: string;
  private readonly llmLogDir: string;
  private readonly proposalDir: string;
  private readonly getAppLogs: (n?: number) => string[];
  private readonly startedAt: string;

  private server: Server | undefined;
  private boundPort: number | undefined;

  constructor(config: OperatorConsoleConfig) {
    this.host = sanitizeHost(config.host);
    this.port = clampInt(config.port, DEFAULT_UI_PORT, 0, 65_535);
    this.rustMuleLogPath = config.rustMuleLogPath;
    this.llmLogDir = config.llmLogDir;
    this.proposalDir = config.proposalDir;
    this.getAppLogs = config.getAppLogs;
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
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://operator-console.local");
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      sendHtml(res, renderIndexHtml());
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
  if (!fileName || !/^[a-zA-Z0-9._:-]+$/.test(fileName)) {
    throw new RequestError(400, `invalid file name: ${fileNameRaw}`);
  }

  const base = resolve(baseDir);
  const target = resolve(baseDir, fileName);
  const rel = relative(base, target);
  if (!rel || rel.startsWith("..")) {
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

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
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
      --bg: #0f172a;
      --card: #111827;
      --line: #334155;
      --text: #e5e7eb;
      --muted: #94a3b8;
      --accent: #22d3ee;
      --warn: #f59e0b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      color: var(--text);
      background: radial-gradient(circle at top, #1e293b, #0b1220 65%);
      min-height: 100vh;
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 16px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(15,23,42,.9), rgba(2,6,23,.85));
      padding: 12px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    h1, h2 { margin: 0; font-weight: 600; }
    h1 { font-size: 1.3rem; }
    h2 { font-size: 1rem; color: var(--accent); }
    button {
      border: 1px solid var(--line);
      background: #1f2937;
      color: var(--text);
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
    }
    button:hover { border-color: var(--accent); }
    pre {
      margin: 0;
      padding: 10px;
      border-radius: 8px;
      border: 1px solid #1e293b;
      background: #020617;
      min-height: 120px;
      overflow: auto;
      white-space: pre-wrap;
      font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      font-size: 12px;
      line-height: 1.35;
    }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    li button {
      width: 100%;
      text-align: left;
    }
    .muted { color: var(--muted); font-size: 12px; }
    .warn { color: var(--warn); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="row">
        <h1>mule-doctor operator console</h1>
        <button id="refresh-all">Refresh all</button>
      </div>
      <pre id="health">Loading health...</pre>
    </div>

    <div class="grid">
      <div class="card">
        <div class="row">
          <h2>App Logs</h2>
          <button id="refresh-app">Refresh</button>
        </div>
        <pre id="app-logs"></pre>
      </div>
      <div class="card">
        <div class="row">
          <h2>rust-mule Logs</h2>
          <button id="refresh-rust">Refresh</button>
        </div>
        <pre id="rust-logs"></pre>
      </div>
      <div class="card">
        <div class="row">
          <h2>LLM Logs</h2>
          <button id="refresh-llm-list">Refresh</button>
        </div>
        <ul id="llm-files"></ul>
        <pre id="llm-content" class="muted">Select a log file.</pre>
      </div>
      <div class="card">
        <div class="row">
          <h2>Patch Proposals</h2>
          <button id="refresh-proposals">Refresh</button>
        </div>
        <ul id="proposal-files"></ul>
        <pre id="proposal-content" class="muted">Select a proposal file.</pre>
      </div>
    </div>
  </div>

  <script>
    async function fetchJson(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(url + " failed: " + res.status);
      return res.json();
    }

    function setText(id, text) {
      document.getElementById(id).textContent = text;
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
        button.textContent = file.name + " (" + file.sizeBytes + " bytes)";
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
      const data = await fetchJson("/api/logs/app?lines=250");
      setText("app-logs", data.lines.join("\\n") || "No captured lines yet.");
    }

    async function refreshRustLogs() {
      const data = await fetchJson("/api/logs/rust-mule?lines=250");
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

    refreshAll();
  </script>
</body>
</html>`;
}
