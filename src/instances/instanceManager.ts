/**
 * instanceManager.ts
 * Plans and persists mule-doctor-managed local rust-mule instances without launching them.
 */

import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { InstanceCatalog, type InstanceCatalogConfig } from "./instanceCatalog.js";
import type { ManagedInstanceRecord, ManagedInstanceRuntimePaths } from "../types/contracts.js";
import {
  renderManagedRustMuleConfig,
  type ManagedRustMuleConfigTemplate,
} from "./rustMuleConfig.js";

const DEFAULT_INSTANCE_ROOT_DIR = "/data/instances";
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT_START = 19000;
const DEFAULT_API_PORT_END = 19999;

export interface CreateManagedInstanceInput {
  id: string;
  apiPort?: number;
}

export interface InstanceManagerConfig extends InstanceCatalogConfig {
  apiHost?: string;
  apiPortStart?: number;
  apiPortEnd?: number;
  instanceRootDir?: string;
  rustMuleConfigTemplate?: ManagedRustMuleConfigTemplate;
}

export class InstanceManager {
  private readonly catalog: InstanceCatalog;
  private readonly apiHost: string;
  private readonly apiPortStart: number;
  private readonly apiPortEnd: number;
  private readonly instanceRootDir: string;
  private readonly rustMuleConfigTemplate: ManagedRustMuleConfigTemplate | undefined;
  private creationQueue: Promise<void> = Promise.resolve();

  constructor(config: InstanceManagerConfig = {}) {
    this.catalog = new InstanceCatalog(config);
    this.apiHost = config.apiHost?.trim() || DEFAULT_API_HOST;
    this.apiPortStart = clampPort(config.apiPortStart ?? DEFAULT_API_PORT_START);
    this.apiPortEnd = clampPort(config.apiPortEnd ?? DEFAULT_API_PORT_END);
    this.instanceRootDir = resolve(config.instanceRootDir ?? DEFAULT_INSTANCE_ROOT_DIR);
    this.rustMuleConfigTemplate = config.rustMuleConfigTemplate;

    if (this.apiPortEnd < this.apiPortStart) {
      throw new Error(
        `Invalid managed instance port range: ${this.apiPortStart}-${this.apiPortEnd}`,
      );
    }
  }

  async initialize(): Promise<void> {
    await this.catalog.initialize();
    await mkdir(this.instanceRootDir, { recursive: true });
  }

  async listInstances(): Promise<ManagedInstanceRecord[]> {
    return this.catalog.list();
  }

  async getInstance(id: string): Promise<ManagedInstanceRecord | undefined> {
    return this.catalog.get(id);
  }

  async createPlannedInstance(input: CreateManagedInstanceInput): Promise<ManagedInstanceRecord> {
    return this.enqueueCreation(async () => {
      const id = normalizeInstanceId(input.id);
      const existing = await this.catalog.get(id);
      if (existing) {
        throw new Error(`Managed instance already exists: ${id}`);
      }

      const current = await this.catalog.list();
      const apiPort =
        input.apiPort === undefined
          ? pickAvailablePort(current, this.apiPortStart, this.apiPortEnd)
          : normalizeRequestedPort(input.apiPort, this.apiPortStart, this.apiPortEnd);
      if (current.some((record) => record.apiPort === apiPort)) {
        throw new Error(`Managed instance API port already reserved: ${apiPort}`);
      }

      const runtime = buildRuntimePaths(this.instanceRootDir, id);
      const now = new Date().toISOString();
      const record: ManagedInstanceRecord = {
        id,
        status: "planned",
        createdAt: now,
        updatedAt: now,
        apiHost: this.apiHost,
        apiPort,
        runtime,
      };
      await this.catalog.add(record);
      try {
        await materializeRuntimePaths(record, this.rustMuleConfigTemplate);
        await writeMetadata(runtime.metadataPath, record);
      } catch (err) {
        await this.catalog.remove(id);
        await cleanupRuntimePaths(runtime);
        throw err;
      }
      return record;
    });
  }

  private async enqueueCreation<T>(op: () => Promise<T>): Promise<T> {
    const run = this.creationQueue.then(op, op);
    this.creationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function buildRuntimePaths(
  instanceRootDir: string,
  id: string,
): ManagedInstanceRuntimePaths {
  const rootDir = resolve(instanceRootDir, id);
  const stateDir = `${rootDir}/state`;
  const logDir = `${stateDir}/logs`;
  return {
    rootDir,
    configPath: `${rootDir}/config.toml`,
    tokenPath: `${stateDir}/api.token`,
    debugTokenPath: `${stateDir}/debug.token`,
    logDir,
    logPath: `${logDir}/rust-mule.log`,
    stateDir,
    metadataPath: `${rootDir}/instance.json`,
  };
}

function normalizeInstanceId(rawId: string): string {
  const id = rawId.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(id)) {
    throw new Error(`Invalid managed instance id: ${rawId}`);
  }
  return id;
}

function pickAvailablePort(
  instances: ManagedInstanceRecord[],
  start: number,
  end: number,
): number {
  const used = new Set(instances.map((instance) => instance.apiPort));
  for (let port = start; port <= end; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new Error(`No managed instance API ports available in range ${start}-${end}`);
}

function clampPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return value;
}

function normalizeRequestedPort(value: number, start: number, end: number): number {
  const port = clampPort(value);
  if (port < start || port > end) {
    throw new Error(
      `Managed instance API port ${value} is outside the allowed range ${start}-${end}`,
    );
  }
  return port;
}

async function materializeRuntimePaths(
  record: ManagedInstanceRecord,
  template?: ManagedRustMuleConfigTemplate,
): Promise<void> {
  await mkdir(record.runtime.rootDir, { recursive: true });
  await mkdir(record.runtime.logDir, { recursive: true });
  await mkdir(record.runtime.stateDir, { recursive: true });
  await writeFile(
    record.runtime.configPath,
    renderManagedRustMuleConfig({
      instanceId: record.id,
      apiPort: record.apiPort,
      runtime: record.runtime,
      template,
    }),
    "utf8",
  );
}

async function writeMetadata(path: string, record: ManagedInstanceRecord): Promise<void> {
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
}

async function cleanupRuntimePaths(runtime: ManagedInstanceRuntimePaths): Promise<void> {
  await rm(runtime.rootDir, { recursive: true, force: true });
}
