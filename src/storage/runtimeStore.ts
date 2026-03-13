/**
 * runtimeStore.ts
 * Persistent runtime state/history storage for mule-doctor.
 */

import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import type {
  HistoryEntry,
  ManagedDiscoverabilityRecord,
  OperatorEventEntry,
  RuntimeState,
  SearchHealthRecord,
} from "../types/contracts.js";

const DEFAULT_DATA_DIR = "/data/mule-doctor";
const DEFAULT_STATE_FILE = "state.json";
const DEFAULT_HISTORY_FILE = "history.json";
const DEFAULT_EVENTS_FILE = "operator-events.json";
const DEFAULT_DISCOVERABILITY_FILE = "discoverability-results.json";
const DEFAULT_SEARCH_HEALTH_FILE = "search-health-results.json";
const DEFAULT_HISTORY_LIMIT = 500;
const DEFAULT_EVENTS_LIMIT = 200;
const DEFAULT_DISCOVERABILITY_LIMIT = 100;

export interface RuntimeStoreConfig {
  dataDir?: string;
  statePath?: string;
  historyPath?: string;
  eventsPath?: string;
  discoverabilityPath?: string;
  searchHealthPath?: string;
  historyLimit?: number;
  eventsLimit?: number;
  discoverabilityLimit?: number;
  searchHealthLimit?: number;
}

export class RuntimeStore {
  private readonly statePath: string;
  private readonly historyPath: string;
  private readonly eventsPath: string;
  private readonly discoverabilityPath: string;
  private readonly searchHealthPath: string;
  private readonly historyLimit: number;
  private readonly eventsLimit: number;
  private readonly discoverabilityLimit: number;
  private readonly searchHealthLimit: number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(config: RuntimeStoreConfig = {}) {
    const dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
    this.statePath = config.statePath ?? `${dataDir}/${DEFAULT_STATE_FILE}`;
    this.historyPath = config.historyPath ?? `${dataDir}/${DEFAULT_HISTORY_FILE}`;
    this.eventsPath = config.eventsPath ?? `${dataDir}/${DEFAULT_EVENTS_FILE}`;
    this.discoverabilityPath =
      config.discoverabilityPath ?? `${dataDir}/${DEFAULT_DISCOVERABILITY_FILE}`;
    this.searchHealthPath = config.searchHealthPath ?? `${dataDir}/${DEFAULT_SEARCH_HEALTH_FILE}`;
    this.historyLimit = config.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.eventsLimit = config.eventsLimit ?? DEFAULT_EVENTS_LIMIT;
    this.discoverabilityLimit = config.discoverabilityLimit ?? DEFAULT_DISCOVERABILITY_LIMIT;
    this.searchHealthLimit = config.searchHealthLimit ?? DEFAULT_DISCOVERABILITY_LIMIT;
  }

  async initialize(): Promise<void> {
    await this.ensureJsonFile(this.statePath, "{}\n");
    await this.ensureJsonFile(this.historyPath, "[]\n");
    await this.ensureJsonFile(this.eventsPath, "[]\n");
    await this.ensureJsonFile(this.discoverabilityPath, "[]\n");
    await this.ensureJsonFile(this.searchHealthPath, "[]\n");
  }

  async loadState(): Promise<RuntimeState> {
    const state = await this.readJsonFile<RuntimeState>(this.statePath);
    return state ?? {};
  }

  async saveState(state: RuntimeState): Promise<void> {
    await this.enqueueMutation(async () => {
      await this.writeJsonFile(this.statePath, state);
    });
  }

  async updateState(patch: RuntimeState): Promise<RuntimeState> {
    return this.enqueueMutation(async () => {
      const current = await this.loadState();
      const next: RuntimeState = { ...current, ...patch };
      await this.writeJsonFile(this.statePath, next);
      return next;
    });
  }

  async loadHistory(): Promise<HistoryEntry[]> {
    const history = await this.readJsonFile<HistoryEntry[]>(this.historyPath);
    return Array.isArray(history) ? history : [];
  }

  async appendHistory(entry: HistoryEntry): Promise<void> {
    await this.enqueueMutation(async () => {
      const history = await this.loadHistory();
      history.push(entry);
      if (history.length > this.historyLimit) {
        history.splice(0, history.length - this.historyLimit);
      }
      await this.writeJsonFile(this.historyPath, history);
    });
  }

  async getRecentHistory(n = 10): Promise<HistoryEntry[]> {
    const history = await this.loadHistory();
    if (n <= 0) return [];
    return history.slice(-n);
  }

  async loadEvents(): Promise<OperatorEventEntry[]> {
    const events = await this.readJsonFile<OperatorEventEntry[]>(this.eventsPath);
    return Array.isArray(events) ? events : [];
  }

  async appendEvent(entry: OperatorEventEntry): Promise<void> {
    await this.appendEvents([entry]);
  }

  async appendEvents(entries: OperatorEventEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.enqueueMutation(async () => {
      const events = await this.loadEvents();
      events.push(...entries);
      if (events.length > this.eventsLimit) {
        events.splice(0, events.length - this.eventsLimit);
      }
      await this.writeJsonFile(this.eventsPath, events);
    });
  }

  async getRecentEvents(n = 20): Promise<OperatorEventEntry[]> {
    const events = await this.loadEvents();
    if (n <= 0) return [];
    return events.slice(-n);
  }

  async loadDiscoverabilityResults(): Promise<ManagedDiscoverabilityRecord[]> {
    const results = await this.readJsonFile<ManagedDiscoverabilityRecord[]>(this.discoverabilityPath);
    return Array.isArray(results) ? results : [];
  }

  async appendDiscoverabilityResult(entry: ManagedDiscoverabilityRecord): Promise<void> {
    await this.enqueueMutation(async () => {
      const results = await this.loadDiscoverabilityResults();
      results.push(entry);
      if (results.length > this.discoverabilityLimit) {
        results.splice(0, results.length - this.discoverabilityLimit);
      }
      await this.writeJsonFile(this.discoverabilityPath, results);
    });
  }

  async getRecentDiscoverabilityResults(n = 20): Promise<ManagedDiscoverabilityRecord[]> {
    const results = await this.loadDiscoverabilityResults();
    if (n <= 0) return [];
    return results.slice(-n);
  }

  async loadSearchHealthResults(): Promise<SearchHealthRecord[]> {
    const results = await this.readJsonFile<SearchHealthRecord[]>(this.searchHealthPath);
    return Array.isArray(results) ? results : [];
  }

  async appendSearchHealthResult(entry: SearchHealthRecord): Promise<void> {
    await this.enqueueMutation(async () => {
      const results = await this.loadSearchHealthResults();
      results.push(entry);
      if (results.length > this.searchHealthLimit) {
        results.splice(0, results.length - this.searchHealthLimit);
      }
      await this.writeJsonFile(this.searchHealthPath, results);
    });
  }

  async getRecentSearchHealthResults(n = 20): Promise<SearchHealthRecord[]> {
    const results = await this.loadSearchHealthResults();
    if (n <= 0) return [];
    return results.slice(-n);
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
    const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    await writeFile(tmpPath, serialized, "utf8");
    try {
      await rename(tmpPath, path);
    } catch (err) {
      try {
        await unlink(tmpPath);
      } catch {
        // no-op cleanup best effort
      }
      throw err;
    }
  }

  private async enqueueMutation<T>(op: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(op, op);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}
