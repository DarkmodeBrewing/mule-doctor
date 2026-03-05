/**
 * runtimeStore.ts
 * Persistent runtime state/history storage for mule-doctor.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import type { HistoryEntry, RuntimeState } from "../types/contracts.js";

const DEFAULT_DATA_DIR = "/data/mule-doctor";
const DEFAULT_STATE_FILE = "state.json";
const DEFAULT_HISTORY_FILE = "history.json";
const DEFAULT_HISTORY_LIMIT = 500;

export interface RuntimeStoreConfig {
  dataDir?: string;
  statePath?: string;
  historyPath?: string;
  historyLimit?: number;
}

export class RuntimeStore {
  private readonly statePath: string;
  private readonly historyPath: string;
  private readonly historyLimit: number;

  constructor(config: RuntimeStoreConfig = {}) {
    const dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
    this.statePath = config.statePath ?? `${dataDir}/${DEFAULT_STATE_FILE}`;
    this.historyPath = config.historyPath ?? `${dataDir}/${DEFAULT_HISTORY_FILE}`;
    this.historyLimit = config.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  async initialize(): Promise<void> {
    await this.ensureJsonFile(this.statePath, "{}\n");
    await this.ensureJsonFile(this.historyPath, "[]\n");
  }

  async loadState(): Promise<RuntimeState> {
    const state = await this.readJsonFile<RuntimeState>(this.statePath);
    return state ?? {};
  }

  async saveState(state: RuntimeState): Promise<void> {
    await this.writeJsonFile(this.statePath, state);
  }

  async updateState(patch: RuntimeState): Promise<RuntimeState> {
    const current = await this.loadState();
    const next: RuntimeState = { ...current, ...patch };
    await this.saveState(next);
    return next;
  }

  async loadHistory(): Promise<HistoryEntry[]> {
    const history = await this.readJsonFile<HistoryEntry[]>(this.historyPath);
    return Array.isArray(history) ? history : [];
  }

  async appendHistory(entry: HistoryEntry): Promise<void> {
    const history = await this.loadHistory();
    history.push(entry);
    if (history.length > this.historyLimit) {
      history.splice(0, history.length - this.historyLimit);
    }
    await this.writeJsonFile(this.historyPath, history);
  }

  async getRecentHistory(n = 10): Promise<HistoryEntry[]> {
    const history = await this.loadHistory();
    if (n <= 0) return [];
    return history.slice(-n);
  }

  private async ensureJsonFile(path: string, defaultContent: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    try {
      await readFile(path, "utf8");
    } catch {
      await writeFile(path, defaultContent, "utf8");
    }
  }

  private async readJsonFile<T>(path: string): Promise<T | null> {
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as T;
    } catch (err) {
      log("warn", "runtimeStore", `Failed to read/parse ${path}: ${String(err)}`);
      return null;
    }
  }

  private async writeJsonFile(path: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value, null, 2) + "\n";
    await writeFile(path, serialized, "utf8");
  }
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
