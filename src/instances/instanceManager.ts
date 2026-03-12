/**
 * instanceManager.ts
 * Plans, persists, and manages mule-doctor-owned local rust-mule instances.
 */

import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { InstanceCatalog, type InstanceCatalogConfig } from "./instanceCatalog.js";
import type {
  ManagedInstanceExitState,
  ManagedInstanceRecord,
  ManagedInstancePresetMembership,
  ManagedInstanceRuntimePaths,
} from "../types/contracts.js";
import {
  NodeProcessLauncher,
  type ProcessLauncher,
} from "./processLauncher.js";
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
  preset?: ManagedInstancePresetMembership;
}

export interface InstanceManagerConfig extends InstanceCatalogConfig {
  apiHost?: string;
  apiPortStart?: number;
  apiPortEnd?: number;
  instanceRootDir?: string;
  rustMuleBinaryPath?: string;
  rustMuleConfigTemplate?: ManagedRustMuleConfigTemplate;
  processLauncher?: ProcessLauncher;
  reconcilePollMs?: number;
  stopSignal?: NodeJS.Signals;
  stopTimeoutMs?: number;
}

export class InstanceManager {
  private readonly catalog: InstanceCatalog;
  private readonly apiHost: string;
  private readonly apiPortStart: number;
  private readonly apiPortEnd: number;
  private readonly instanceRootDir: string;
  private readonly rustMuleBinaryPath: string;
  private readonly rustMuleConfigTemplate: ManagedRustMuleConfigTemplate | undefined;
  private readonly processLauncher: ProcessLauncher;
  private readonly reconcilePollMs: number;
  private readonly stopSignal: NodeJS.Signals;
  private readonly stopTimeoutMs: number;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly liveProcesses = new Map<number, Promise<ManagedInstanceRecord>>();

  constructor(config: InstanceManagerConfig = {}) {
    this.catalog = new InstanceCatalog(config);
    this.apiHost = config.apiHost?.trim() || DEFAULT_API_HOST;
    this.apiPortStart = clampPort(config.apiPortStart ?? DEFAULT_API_PORT_START);
    this.apiPortEnd = clampPort(config.apiPortEnd ?? DEFAULT_API_PORT_END);
    this.instanceRootDir = resolve(config.instanceRootDir ?? DEFAULT_INSTANCE_ROOT_DIR);
    this.rustMuleBinaryPath = config.rustMuleBinaryPath?.trim() || "rust-mule";
    this.rustMuleConfigTemplate = config.rustMuleConfigTemplate;
    this.processLauncher = config.processLauncher ?? new NodeProcessLauncher();
    this.reconcilePollMs = clampPollMs(config.reconcilePollMs ?? 1000);
    this.stopSignal = config.stopSignal ?? "SIGTERM";
    this.stopTimeoutMs = config.stopTimeoutMs ?? 5000;

    if (this.apiPortEnd < this.apiPortStart) {
      throw new Error(
        `Invalid managed instance port range: ${this.apiPortStart}-${this.apiPortEnd}`,
      );
    }
  }

  async initialize(): Promise<void> {
    await this.catalog.initialize();
    await mkdir(this.instanceRootDir, { recursive: true });
    await this.reconcileRunningInstances();
  }

  async listInstances(): Promise<ManagedInstanceRecord[]> {
    return this.catalog.list();
  }

  async getInstance(id: string): Promise<ManagedInstanceRecord | undefined> {
    return this.catalog.get(id);
  }

  async createPlannedInstance(input: CreateManagedInstanceInput): Promise<ManagedInstanceRecord> {
    const created = await this.createPlannedInstances([input]);
    return created[0];
  }

  async createPlannedInstances(
    inputs: CreateManagedInstanceInput[],
  ): Promise<ManagedInstanceRecord[]> {
    return this.enqueueOperation(async () => {
      if (!Array.isArray(inputs) || inputs.length === 0) {
        throw new Error("At least one managed instance input is required");
      }

      const current = await this.catalog.list();
      const plannedRecords = planManagedInstanceBatch(
        inputs,
        current,
        this.instanceRootDir,
        this.apiHost,
        this.apiPortStart,
        this.apiPortEnd,
      );

      const created: ManagedInstanceRecord[] = [];
      try {
        for (const record of plannedRecords) {
          await this.catalog.add(record);
          created.push(record);
          await materializeRuntimePaths(record, this.rustMuleConfigTemplate);
          await writeMetadata(record.runtime.metadataPath, record);
        }
      } catch (err) {
        await rollbackCreatedInstances(this.catalog, created);
        throw err;
      }

      return created;
    });
  }

  async startInstance(id: string): Promise<ManagedInstanceRecord> {
    return this.enqueueOperation(async () => {
      const record = await this.requireInstance(id);
      const current = await this.refreshRecordIfProcessMissing(record);
      if (current.status === "running" && current.currentProcess) {
        return current;
      }

      const command = this.buildCommand(current);
      const handle = await this.processLauncher.launch({
        command: command[0],
        args: command.slice(1),
        cwd: current.runtime.rootDir,
        logPath: current.runtime.logPath,
      });
      const now = new Date().toISOString();
      const started = await this.persistRecord({
        ...current,
        status: "running",
        updatedAt: now,
        currentProcess: {
          pid: handle.pid,
          command,
          cwd: current.runtime.rootDir,
          startedAt: now,
        },
        lastError: undefined,
      });
      this.trackLiveProcess(started.id, handle.pid, handle.exit);
      return started;
    });
  }

  async stopInstance(id: string, reason = "stopped by mule-doctor"): Promise<ManagedInstanceRecord> {
    return this.enqueueOperation(async () => {
      const record = await this.requireInstance(id);
      const current = await this.refreshRecordIfProcessMissing(record);
      if (!current.currentProcess) {
        if (current.status === "planned") {
          return current;
        }
        return this.persistRecord({
          ...current,
          status: "stopped",
          updatedAt: new Date().toISOString(),
          lastExit: {
            at: new Date().toISOString(),
            exitCode: null,
            signal: null,
            reason,
          },
          lastError: undefined,
        });
      }

      const pid = current.currentProcess.pid;
      await this.processLauncher.stop(pid, this.stopSignal);
      await waitForProcessExit(pid, this.processLauncher, this.stopTimeoutMs);
      const refreshed = await this.catalog.get(current.id);
      if (refreshed && refreshed.status !== "running") {
        return refreshed;
      }
      return this.persistRecord({
        ...current,
        status: "stopped",
        updatedAt: new Date().toISOString(),
        currentProcess: undefined,
        lastExit: {
          at: new Date().toISOString(),
          exitCode: null,
          signal: this.stopSignal,
          reason,
        },
        lastError: undefined,
      });
    });
  }

  async restartInstance(id: string): Promise<ManagedInstanceRecord> {
    await this.stopInstance(id, "restarted by mule-doctor");
    return this.startInstance(id);
  }

  private async reconcileRunningInstances(): Promise<void> {
    const records = await this.catalog.list();
    for (const record of records) {
      if (record.status !== "running") {
        continue;
      }
      const pid = record.currentProcess?.pid;
      if (!pid) {
        await this.persistRecord({
          ...record,
          status: "failed",
          updatedAt: new Date().toISOString(),
          lastError: "Managed instance was marked running without process state during startup",
          lastExit: {
            at: new Date().toISOString(),
            exitCode: null,
            signal: null,
            reason: "mule-doctor restarted without recoverable process state",
          },
        });
        continue;
      }
      const alive = await this.processLauncher.isRunning(pid);
      if (!alive) {
        await this.persistRecord({
          ...record,
          status: "failed",
          updatedAt: new Date().toISOString(),
          currentProcess: undefined,
          lastError: "Managed process was not running during startup reconciliation",
          lastExit: {
            at: new Date().toISOString(),
            exitCode: null,
            signal: null,
            reason: "process missing during mule-doctor startup reconciliation",
          },
        });
        continue;
      }
      this.trackReconciledProcess(record.id, pid);
    }
  }

  private async refreshRecordIfProcessMissing(record: ManagedInstanceRecord): Promise<ManagedInstanceRecord> {
    if (record.status !== "running" || !record.currentProcess) {
      return record;
    }
    const alive = await this.processLauncher.isRunning(record.currentProcess.pid);
    if (alive) {
      return record;
    }
    return this.persistRecord({
      ...record,
      status: "failed",
      updatedAt: new Date().toISOString(),
      currentProcess: undefined,
      lastError: "Managed process was not running when lifecycle state was refreshed",
      lastExit: {
        at: new Date().toISOString(),
        exitCode: null,
        signal: null,
        reason: "process missing during lifecycle refresh",
      },
    });
  }

  private trackLiveProcess(
    id: string,
    pid: number,
    exitPromise: Promise<ManagedInstanceExitState>,
  ): void {
    const tracked = exitPromise
      .then((exit) => this.handleProcessExit(id, pid, exit))
      .catch((err) =>
        this.handleProcessExit(id, pid, {
          at: new Date().toISOString(),
          exitCode: null,
          signal: null,
          error: String(err),
        }),
      )
      .finally(() => {
        this.liveProcesses.delete(pid);
      });
    this.liveProcesses.set(pid, tracked);
  }

  private trackReconciledProcess(id: string, pid: number): void {
    if (this.liveProcesses.has(pid)) {
      return;
    }
    const tracked = this.monitorProcessLiveness(id, pid)
      .then((record) => record)
      .finally(() => {
        this.liveProcesses.delete(pid);
      });
    this.liveProcesses.set(pid, tracked);
  }

  private async handleProcessExit(
    id: string,
    pid: number,
    exit: ManagedInstanceExitState,
  ): Promise<ManagedInstanceRecord> {
    return this.enqueueOperation(async () => {
      const current = await this.catalog.get(id);
      if (!current || current.currentProcess?.pid !== pid) {
        return (
          current ?? {
            id,
            status: "failed",
            createdAt: exit.at,
            updatedAt: exit.at,
            apiHost: this.apiHost,
            apiPort: 0,
            runtime: buildRuntimePaths(this.instanceRootDir, id),
          }
        );
      }
      return this.persistRecord({
        ...current,
        status: exit.error ? "failed" : "stopped",
        updatedAt: exit.at,
        currentProcess: undefined,
        lastExit: exit,
        lastError: exit.error,
      });
    });
  }

  private buildCommand(record: ManagedInstanceRecord): string[] {
    return [this.rustMuleBinaryPath, "--config", record.runtime.configPath];
  }

  private async monitorProcessLiveness(
    id: string,
    pid: number,
  ): Promise<ManagedInstanceRecord> {
    while (await this.processLauncher.isRunning(pid)) {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, this.reconcilePollMs));
    }
    return this.handleProcessExit(id, pid, {
      at: new Date().toISOString(),
      exitCode: null,
      signal: null,
      reason: "process exited after mule-doctor startup reconciliation",
    });
  }

  private async requireInstance(id: string): Promise<ManagedInstanceRecord> {
    const normalizedId = normalizeInstanceId(id);
    const record = await this.catalog.get(normalizedId);
    if (!record) {
      throw new Error(`Managed instance not found: ${normalizedId}`);
    }
    return record;
  }

  private async persistRecord(record: ManagedInstanceRecord): Promise<ManagedInstanceRecord> {
    const updated = await this.catalog.update(record.id, () => record);
    await writeMetadata(updated.runtime.metadataPath, updated);
    return updated;
  }

  private async enqueueOperation<T>(op: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(op, op);
    this.operationQueue = run.then(
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

function planManagedInstanceBatch(
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
        ? pickAvailablePort(
            existing.concat(planned),
            apiPortStart,
            apiPortEnd,
          )
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

function clampPollMs(value: number): number {
  if (!Number.isInteger(value) || value < 50 || value > 60_000) {
    throw new Error(`Invalid reconcile poll interval: ${value}`);
  }
  return value;
}

async function materializeRuntimePaths(
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

async function writeMetadata(path: string, record: ManagedInstanceRecord): Promise<void> {
  await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
}

async function cleanupRuntimePaths(runtime: ManagedInstanceRuntimePaths): Promise<void> {
  await rm(runtime.rootDir, { recursive: true, force: true });
}

async function rollbackCreatedInstances(
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

async function waitForProcessExit(
  pid: number,
  processLauncher: ProcessLauncher,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await processLauncher.isRunning(pid))) {
      return;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for managed process ${pid} to exit`);
}
