import { closeSync, openSync, readSync, statSync } from "node:fs";

import { redactLine } from "./redaction.js";
import type { RecentLogSource } from "../tools/toolRegistry.js";

const MAX_LOG_BYTES = 256 * 1024;
const DEFAULT_LOG_LINES = 200;

export class RecentFileLogSource implements RecentLogSource {
  private readonly filePath: string;
  private readonly lineLimit: number;
  private readonly redact: boolean;

  constructor(filePath: string, options: { lineLimit?: number; redact?: boolean } = {}) {
    this.filePath = filePath;
    this.lineLimit = options.lineLimit ?? DEFAULT_LOG_LINES;
    this.redact = options.redact === true;
  }

  getRecentLines(n?: number): string[] {
    const lineLimit = clampLineLimit(n ?? this.lineLimit);
    return readTailLinesSync(this.filePath, lineLimit, { redact: this.redact });
  }
}

function clampLineLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LOG_LINES;
  }
  return Math.max(1, Math.min(1000, Math.trunc(value)));
}

function readTailLinesSync(
  filePath: string,
  lineLimit: number,
  options: { redact?: boolean } = {},
): string[] {
  let fileSize: number;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    return [];
  }

  const readStart = Math.max(0, fileSize - MAX_LOG_BYTES);
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const bytesToRead = fileSize - readStart;
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, readStart);
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
      .map((line) => (options.redact ? redactLine(line) : line))
      .slice(-lineLimit);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}
