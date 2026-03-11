import { open, readFile, readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { STATIC_DIR } from "./constants.js";
import { applySecurityHeaders, RequestError } from "./http.js";
import type { ListedFile, SafeReadResult, StreamChunk } from "./types.js";
import type { ServerResponse } from "node:http";

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof err["code"] === "string" &&
    err["code"] === "ENOENT"
  );
}

export async function listFiles(
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

export async function readTailLines(
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

export async function readStreamChunk(
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

export async function readFromAllowedDir(
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

export async function getFileSize(filePath: string): Promise<number> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size;
  } catch (err) {
    if (isNotFound(err)) return 0;
    throw err;
  }
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

export async function sendStaticHtml(res: ServerResponse, fileName: string): Promise<void> {
  const content = await readStaticAsset(fileName);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  applySecurityHeaders(res);
  res.end(content);
}

export async function sendStaticAsset(res: ServerResponse, fileNameRaw: string): Promise<void> {
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
