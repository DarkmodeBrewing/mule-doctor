/**
 * instanceManager.ts
 * Plans and persists mule-doctor-managed local rust-mule instances without launching them.
 */

import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import { InstanceCatalog, type InstanceCatalogConfig } from "./instanceCatalog.js";
import type { ManagedInstanceRecord, ManagedInstanceRuntimePaths } from "../types/contracts.js";

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
}

export class InstanceManager {
  private readonly catalog: InstanceCatalog;
  private readonly apiHost: string;
  private readonly apiPortStart: number;
  private readonly apiPortEnd: number;
  private readonly instanceRootDir: string;

  constructor(config: InstanceManagerConfig = {}) {
    this.catalog = new InstanceCatalog(config);
    this.apiHost = config.apiHost?.trim() || DEFAULT_API_HOST;
    this.apiPortStart = clampPort(config.apiPortStart ?? DEFAULT_API_PORT_START);
    this.apiPortEnd = clampPort(config.apiPortEnd ?? DEFAULT_API_PORT_END);
    this.instanceRootDir = resolve(config.instanceRootDir ?? DEFAULT_INSTANCE_ROOT_DIR);

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
    const id = normalizeInstanceId(input.id);
    const existing = await this.catalog.get(id);
    if (existing) {
      throw new Error(`Managed instance already exists: ${id}`);
    }

    const current = await this.catalog.list();
    const apiPort = input.apiPort ?? pickAvailablePort(current, this.apiPortStart, this.apiPortEnd);
    if (current.some((record) => record.apiPort === apiPort)) {
      throw new Error(`Managed instance API port already reserved: ${apiPort}`);
    }

    const runtime = buildRuntimePaths(this.instanceRootDir, id);
    await materializeRuntimePaths(runtime, id);

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
    await writeMetadata(runtime.metadataPath, record);
    return record;
  }
}

export function buildRuntimePaths(
  instanceRootDir: string,
  id: string,
): ManagedInstanceRuntimePaths {
  const rootDir = resolve(instanceRootDir, id);
  return {
    rootDir,
    configPath: `${rootDir}/config.toml`,
    tokenPath: `${rootDir}/token`,
    debugTokenPath: `${rootDir}/debug.token`,
    logDir: `${rootDir}/logs`,
    logPath: `${rootDir}/logs/rust-mule.log`,
    stateDir: `${rootDir}/state`,
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

async function materializeRuntimePaths(
  runtime: ManagedInstanceRuntimePaths,
  id: string,
): Promise<void> {
  await mkdir(runtime.rootDir, { recursive: true });
  await mkdir(runtime.logDir, { recursive: true });
  await mkdir(runtime.stateDir, { recursive: true });
  await writeFile(runtime.configPath, buildConfigPlaceholder(id), "utf8");
}

async function writeMetadata(path: string, record: ManagedInstanceRecord): Promise<void> {
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
}

function buildConfigPlaceholder(id: string): string {
  return [
    "# Placeholder config for mule-doctor-managed rust-mule instance.",
    "# Fill in required rust-mule settings before process launch is implemented.",
    `# instance_id = "${id}"`,
    "",
  ].join("\n");
}
