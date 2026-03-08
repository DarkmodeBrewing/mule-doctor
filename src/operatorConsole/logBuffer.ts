/**
 * logBuffer.ts
 * Captures newline-delimited stdout log lines for in-process inspection.
 */

const DEFAULT_MAX_LINES = 2000;

export interface AppLogBuffer {
  getRecentLines(n?: number): string[];
  subscribe(listener: (line: string) => void): () => void;
  restore(): void;
}

export function installStdoutLogBuffer(maxLinesRaw?: number): AppLogBuffer {
  const maxLines = clampInt(maxLinesRaw, DEFAULT_MAX_LINES, 100, 20_000);
  const lines: string[] = [];
  const listeners = new Set<(line: string) => void>();
  let partial = "";

  const originalWrite = process.stdout.write.bind(process.stdout);

  const captureChunk = (chunk: unknown): void => {
    const text = normalizeChunk(chunk);
    if (!text) return;

    partial += text;
    while (true) {
      const newlineIndex = partial.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }
      const line = partial.slice(0, newlineIndex).replace(/\r$/, "");
      partial = partial.slice(newlineIndex + 1);
      if (!line) continue;
      lines.push(line);
      for (const listener of listeners) {
        listener(line);
      }
      if (lines.length > maxLines) {
        lines.splice(0, lines.length - maxLines);
      }
    }
  };

  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    captureChunk(chunk);
    const [encodingOrCallback, callback] = args;
    if (typeof encodingOrCallback === "function") {
      return originalWrite(chunk as never, encodingOrCallback as never);
    }
    if (typeof callback === "function") {
      return originalWrite(chunk as never, encodingOrCallback as never, callback as never);
    }
    if (typeof encodingOrCallback === "string") {
      return originalWrite(chunk as never, encodingOrCallback as never);
    }
    return originalWrite(chunk as never);
  }) as typeof process.stdout.write;

  return {
    getRecentLines(n?: number): string[] {
      if (n === undefined) return [...lines];
      const bounded = clampInt(n, 200, 1, maxLines);
      return lines.slice(-bounded);
    },
    subscribe(listener: (line: string) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore(): void {
      listeners.clear();
      process.stdout.write = originalWrite as typeof process.stdout.write;
    },
  };
}

function normalizeChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return String(chunk ?? "");
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
