/**
 * instanceCatalog.ts
 * Persistent metadata store for mule-doctor-managed local rust-mule instances.
 */

import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import type { ManagedInstanceRecord } from "../types/contracts.js";

const DEFAULT_DATA_DIR = "/data/mule-doctor";
const DEFAULT_CATALOG_FILE = "instances.json";

export interface InstanceCatalogConfig {
  dataDir?: string;
  catalogPath?: string;
}

export class InstanceCatalog {
  private readonly catalogPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(config: InstanceCatalogConfig = {}) {
    const dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
    this.catalogPath = config.catalogPath ?? `${dataDir}/${DEFAULT_CATALOG_FILE}`;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.catalogPath), { recursive: true });
    try {
      await readFile(this.catalogPath, "utf8");
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        await writeFile(this.catalogPath, "[]\n", "utf8");
        return;
      }
      throw err;
    }
  }

  async list(): Promise<ManagedInstanceRecord[]> {
    return this.readCatalogOrThrow();
  }

  async get(id: string): Promise<ManagedInstanceRecord | undefined> {
    const records = await this.list();
    return records.find((record) => record.id === id);
  }

  async add(record: ManagedInstanceRecord): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = await this.readCatalogOrThrow();
      if (records.some((existing) => existing.id === record.id)) {
        throw new Error(`Managed instance already exists: ${record.id}`);
      }
      if (records.some((existing) => existing.apiPort === record.apiPort)) {
        throw new Error(`Managed instance API port already in use: ${record.apiPort}`);
      }
      records.push(record);
      await this.writeCatalog(records);
    });
  }

  async remove(id: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const records = await this.readCatalogOrThrow();
      const next = records.filter((record) => record.id !== id);
      if (next.length === records.length) {
        return;
      }
      await this.writeCatalog(next);
    });
  }

  async update(
    id: string,
    updater: (record: ManagedInstanceRecord) => ManagedInstanceRecord,
  ): Promise<ManagedInstanceRecord> {
    return this.enqueueMutation(async () => {
      const records = await this.readCatalogOrThrow();
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) {
        throw new Error(`Managed instance not found: ${id}`);
      }
      const nextRecord = updater(records[index]);
      if (
        records.some(
          (existing, existingIndex) =>
            existingIndex !== index && existing.apiPort === nextRecord.apiPort,
        )
      ) {
        throw new Error(`Managed instance API port already in use: ${nextRecord.apiPort}`);
      }
      records[index] = nextRecord;
      await this.writeCatalog(records);
      return nextRecord;
    });
  }

  private async readCatalogOrThrow(): Promise<ManagedInstanceRecord[]> {
    try {
      const raw = await readFile(this.catalogPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error(`Invalid managed instance catalog payload in ${this.catalogPath}`);
      }
      return parsed as ManagedInstanceRecord[];
    } catch (err) {
      log("warn", "instanceCatalog", `Failed to read/parse ${this.catalogPath}: ${String(err)}`);
      throw err;
    }
  }

  private async writeCatalog(records: ManagedInstanceRecord[]): Promise<void> {
    const serialized = JSON.stringify(records, null, 2) + "\n";
    const tmpPath = `${this.catalogPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    await writeFile(tmpPath, serialized, "utf8");
    try {
      await rename(tmpPath, this.catalogPath);
    } catch (err) {
      try {
        await unlink(tmpPath);
      } catch {
        // best-effort cleanup
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
