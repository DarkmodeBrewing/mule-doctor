/**
 * logWatcher.ts
 * Tails a log file from rust-mule and exposes recent lines to callers.
 */

import { createReadStream, watch, type FSWatcher } from "fs";
import { stat } from "fs/promises";
import { createInterface } from "readline";

const DEFAULT_BUFFER_LINES = 200;

export class LogWatcher {
  private readonly filePath: string;
  private readonly maxLines: number;
  private buffer: string[] = [];
  private watcher: FSWatcher | undefined;
  private lastSize = 0;

  constructor(filePath: string, maxLines = DEFAULT_BUFFER_LINES) {
    this.filePath = filePath;
    this.maxLines = maxLines;
  }

  /** Start watching the log file. Resolves once the initial tail is complete. */
  async start(): Promise<void> {
    await this.tail();
    this.watcher = watch(this.filePath, { persistent: false }, (event) => {
      if (event === "change") {
        this.tail().catch((err) => log("warn", "logWatcher", `Tail error: ${String(err)}`));
      }
    });
    log("info", "logWatcher", `Watching ${this.filePath}`);
  }

  /** Stop watching the log file. */
  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    log("info", "logWatcher", "Stopped");
  }

  /** Return the most recent `n` log lines (default: all buffered). */
  getRecentLines(n?: number): string[] {
    if (n === undefined) return [...this.buffer];
    return this.buffer.slice(-n);
  }

  /** Current byte offset tracked in the log file. */
  getOffset(): number {
    return this.lastSize;
  }

  /**
   * Read any new bytes appended to the file since the last read.
   * On the first call the last `maxLines` lines are ingested.
   */
  private async tail(): Promise<void> {
    let fileSize: number;
    try {
      const info = await stat(this.filePath);
      fileSize = info.size;
    } catch {
      log("warn", "logWatcher", `Cannot stat ${this.filePath}`);
      return;
    }

    if (fileSize === this.lastSize) return;

    // If the file was truncated or never read, re-seed from the beginning.
    const start = fileSize < this.lastSize ? 0 : this.lastSize;

    const stream = createReadStream(this.filePath, {
      start,
      encoding: "utf8",
    });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        this.buffer.push(line);
        if (this.buffer.length > this.maxLines) {
          this.buffer.shift();
        }
      }
      // Only advance offset after a successful stream read to avoid skipping bytes.
      this.lastSize = start + stream.bytesRead;
    } catch (err) {
      log("warn", "logWatcher", `Failed to read ${this.filePath}: ${String(err)}`);
    } finally {
      rl.close();
      stream.destroy();
    }
  }
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}
