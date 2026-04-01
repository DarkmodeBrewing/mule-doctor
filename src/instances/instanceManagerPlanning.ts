import { constants } from "fs";
import { access, mkdir, rm, writeFile } from "fs/promises";
import { delimiter, resolve } from "path";
import { type InstanceCatalog } from "./instanceCatalog.js";
import {
  renderManagedRustMuleConfig,
  type ManagedRustMuleConfigTemplate,
} from "./rustMuleConfig.js";
import type {
  ManagedInstanceRecord,
  ManagedInstancePresetMembership,
  ManagedInstanceRuntimePaths,
} from "../types/contracts.js";

export interface CreateManagedInstanceInput {
  id: string;
  apiPort?: number;
  preset?: ManagedInstancePresetMembership;
}

export async function ensureBinaryAvailable(command: string): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Managed rust-mule binary path must not be empty");
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    const resolved = resolve(trimmed);
    await access(resolved, constants.X_OK);
    return;
  }

  const pathValue = process.env.PATH ?? "";
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = resolve(entry, trimmed);
    try {
      await access(candidate, constants.X_OK);
      return;
    } catch {
      // continue scanning PATH entries
    }
  }

  throw new Error(`Managed rust-mule binary not found on PATH: ${trimmed}`);
}

export function buildRuntimePaths(
  instanceRootDir: string,
  id: string,
): ManagedInstanceRuntimePaths {
  const rootDir = resolve(instanceRootDir, id);
  const stateDir = `${rootDir}/state`;
  const logDir = `${stateDir}/logs`;
  const sharedDir = `${rootDir}/shared`;
  return {
    rootDir,
    configPath: `${rootDir}/config.toml`,
    tokenPath: `${stateDir}/api.token`,
    debugTokenPath: `${stateDir}/debug.token`,
    logDir,
    logPath: `${logDir}/rust-mule.log`,
    stateDir,
    sharedDir,
    metadataPath: `${rootDir}/instance.json`,
  };
}

export function normalizeInstanceId(rawId: string): string {
  const id = rawId.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(id)) {
    throw new Error(`Invalid managed instance id: ${rawId}`);
  }
  return id;
}

export function clampPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return value;
}

export function clampPollMs(value: number): number {
  if (!Number.isInteger(value) || value < 50 || value > 60_000) {
    throw new Error(`Invalid reconcile poll interval: ${value}`);
  }
  return value;
}

export function planManagedInstanceBatch(
  inputs: CreateManagedInstanceInput[],
  existing: ManagedInstanceRecord[],
  instanceRootDir: string,
  apiHost: string,
  apiPortStart: number,
  apiPortEnd: number,
): ManagedInstanceRecord[] {
  const planned: ManagedInstanceRecord[] = [];
  const usedIds = new Set(existing.map((record) => record.id));
  const usedPorts = new Set(existing.map((record) => record.apiPort));
  const now = new Date().toISOString();

  for (const input of inputs) {
    const id = normalizeInstanceId(input.id);
    if (usedIds.has(id)) {
      throw new Error(`Managed instance already exists: ${id}`);
    }

    const apiPort =
      input.apiPort === undefined
        ? pickAvailablePort(existing.concat(planned), apiPortStart, apiPortEnd)
        : normalizeRequestedPort(input.apiPort, apiPortStart, apiPortEnd);
    if (usedPorts.has(apiPort)) {
      throw new Error(`Managed instance API port already reserved: ${apiPort}`);
    }

    usedIds.add(id);
    usedPorts.add(apiPort);
    planned.push({
      id,
      status: "planned",
      createdAt: now,
      updatedAt: now,
      apiHost,
      apiPort,
      runtime: buildRuntimePaths(instanceRootDir, id),
      preset: input.preset,
    });
  }

  return planned;
}

export async function materializeRuntimePaths(
  record: ManagedInstanceRecord,
  template?: ManagedRustMuleConfigTemplate,
): Promise<void> {
  await mkdir(record.runtime.rootDir, { recursive: true });
  await mkdir(record.runtime.logDir, { recursive: true });
  await mkdir(record.runtime.stateDir, { recursive: true });
  await mkdir(record.runtime.sharedDir, { recursive: true });
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

export async function writeMetadata(
  path: string,
  record: ManagedInstanceRecord,
): Promise<void> {
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
}

export async function rollbackCreatedInstances(
  catalog: InstanceCatalog,
  created: ManagedInstanceRecord[],
): Promise<void> {
  for (const record of created.reverse()) {
    try {
      await catalog.remove(record.id);
    } catch {
      // best-effort rollback
    }
    try {
      await cleanupRuntimePaths(record.runtime);
    } catch {
      // best-effort rollback
    }
  }
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

function normalizeRequestedPort(value: number, start: number, end: number): number {
  const port = clampPort(value);
  if (port < start || port > end) {
    throw new Error(
      `Managed instance API port ${value} is outside the allowed range ${start}-${end}`,
    );
  }
  return port;
}

async function cleanupRuntimePaths(runtime: ManagedInstanceRuntimePaths): Promise<void> {
  await rm(runtime.rootDir, { recursive: true, force: true });
}
