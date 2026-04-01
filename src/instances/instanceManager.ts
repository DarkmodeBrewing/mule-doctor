/**
 * instanceManager.ts
 * Plans, persists, and manages mule-doctor-owned local rust-mule instances.
 */

import { mkdir } from "fs/promises";
import { resolve } from "path";
import { InstanceCatalog, type InstanceCatalogConfig } from "./instanceCatalog.js";
import type {
  ManagedInstanceExitState,
  ManagedInstanceRecord,
} from "../types/contracts.js";
import {
  NodeProcessLauncher,
  type ProcessLauncher,
} from "./processLauncher.js";
import {
  clampPollMs,
  clampPort,
  type CreateManagedInstanceInput,
  ensureBinaryAvailable,
  materializeRuntimePaths,
  normalizeInstanceId,
  planManagedInstanceBatch,
  rollbackCreatedInstances,
  writeMetadata,
} from "./instanceManagerPlanning.js";
import {
  handleManagedProcessExit,
  monitorManagedProcessLiveness,
  reconcileRunningInstances,
  startManagedInstance,
  stopManagedInstance,
  type InstanceManagerLifecycleDeps,
} from "./instanceManagerLifecycle.js";
import type { ManagedRustMuleConfigTemplate } from "./rustMuleConfig.js";

const DEFAULT_INSTANCE_ROOT_DIR = "/data/instances";
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT_START = 19000;
const DEFAULT_API_PORT_END = 19999;

export type { CreateManagedInstanceInput } from "./instanceManagerPlanning.js";

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
    await ensureBinaryAvailable(this.rustMuleBinaryPath);
    await mkdir(this.instanceRootDir, { recursive: true });
    await reconcileRunningInstances(this.lifecycleDeps(), this.trackReconciledProcess.bind(this));
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
    return startManagedInstance(this.lifecycleDeps(), id, this.trackLiveProcess.bind(this));
  }

  async stopInstance(id: string, reason = "stopped by mule-doctor"): Promise<ManagedInstanceRecord> {
    return stopManagedInstance(this.lifecycleDeps(), id, reason);
  }

  async restartInstance(id: string): Promise<ManagedInstanceRecord> {
    await this.stopInstance(id, "restarted by mule-doctor");
    return this.startInstance(id);
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
    const tracked = monitorManagedProcessLiveness(
      this.lifecycleDeps(),
      id,
      pid,
      this.handleProcessExit.bind(this),
    )
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
    return handleManagedProcessExit(this.lifecycleDeps(), id, pid, exit);
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

  private lifecycleDeps(): InstanceManagerLifecycleDeps {
    return {
      catalog: this.catalog,
      apiHost: this.apiHost,
      instanceRootDir: this.instanceRootDir,
      rustMuleBinaryPath: this.rustMuleBinaryPath,
      processLauncher: this.processLauncher,
      reconcilePollMs: this.reconcilePollMs,
      stopSignal: this.stopSignal,
      stopTimeoutMs: this.stopTimeoutMs,
      persistRecord: this.persistRecord.bind(this),
      requireInstance: this.requireInstance.bind(this),
      enqueueOperation: this.enqueueOperation.bind(this),
    };
  }
}

export { buildRuntimePaths } from "./instanceManagerPlanning.js";
