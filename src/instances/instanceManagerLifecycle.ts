import type {
  ManagedInstanceExitState,
  ManagedInstanceRecord,
} from "../types/contracts.js";
import { buildRuntimePaths } from "./instanceManagerPlanning.js";
import type { InstanceCatalog } from "./instanceCatalog.js";
import type { ProcessLauncher } from "./processLauncher.js";

export interface InstanceManagerLifecycleDeps {
  catalog: InstanceCatalog;
  apiHost: string;
  instanceRootDir: string;
  rustMuleBinaryPath: string;
  processLauncher: ProcessLauncher;
  reconcilePollMs: number;
  stopSignal: NodeJS.Signals;
  stopTimeoutMs: number;
  persistRecord: (record: ManagedInstanceRecord) => Promise<ManagedInstanceRecord>;
  requireInstance: (id: string) => Promise<ManagedInstanceRecord>;
  enqueueOperation: <T>(op: () => Promise<T>) => Promise<T>;
}

export async function startManagedInstance(
  deps: InstanceManagerLifecycleDeps,
  id: string,
  trackLiveProcess: (
    id: string,
    pid: number,
    exitPromise: Promise<ManagedInstanceExitState>,
  ) => void,
): Promise<ManagedInstanceRecord> {
  return deps.enqueueOperation(async () => {
    const record = await deps.requireInstance(id);
    const current = await refreshRecordIfProcessMissing(deps, record);
    if (current.status === "running" && current.currentProcess) {
      return current;
    }

    const command = [deps.rustMuleBinaryPath, "--config", current.runtime.configPath];
    const handle = await deps.processLauncher.launch({
      command: command[0],
      args: command.slice(1),
      cwd: current.runtime.rootDir,
      logPath: current.runtime.logPath,
    });
    const now = new Date().toISOString();
    const started = await deps.persistRecord({
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
    trackLiveProcess(started.id, handle.pid, handle.exit);
    return started;
  });
}

export async function stopManagedInstance(
  deps: InstanceManagerLifecycleDeps,
  id: string,
  reason: string,
): Promise<ManagedInstanceRecord> {
  return deps.enqueueOperation(async () => {
    const record = await deps.requireInstance(id);
    const current = await refreshRecordIfProcessMissing(deps, record);
    if (!current.currentProcess) {
      if (current.status === "planned") {
        return current;
      }
      return deps.persistRecord({
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
    await deps.processLauncher.stop(pid, deps.stopSignal);
    await waitForProcessExit(pid, deps.processLauncher, deps.stopTimeoutMs);
    const refreshed = await deps.catalog.get(current.id);
    if (refreshed && refreshed.status !== "running") {
      return refreshed;
    }
    return deps.persistRecord({
      ...current,
      status: "stopped",
      updatedAt: new Date().toISOString(),
      currentProcess: undefined,
      lastExit: {
        at: new Date().toISOString(),
        exitCode: null,
        signal: deps.stopSignal,
        reason,
      },
      lastError: undefined,
    });
  });
}

export async function reconcileRunningInstances(
  deps: InstanceManagerLifecycleDeps,
  trackReconciledProcess: (id: string, pid: number) => void,
): Promise<void> {
  const records = await deps.catalog.list();
  for (const record of records) {
    if (record.status !== "running") {
      continue;
    }
    const pid = record.currentProcess?.pid;
    if (!pid) {
      await deps.persistRecord({
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
    const alive = await deps.processLauncher.isRunning(pid);
    if (!alive) {
      await deps.persistRecord({
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
    trackReconciledProcess(record.id, pid);
  }
}

export async function refreshRecordIfProcessMissing(
  deps: InstanceManagerLifecycleDeps,
  record: ManagedInstanceRecord,
): Promise<ManagedInstanceRecord> {
  if (record.status !== "running" || !record.currentProcess) {
    return record;
  }
  const alive = await deps.processLauncher.isRunning(record.currentProcess.pid);
  if (alive) {
    return record;
  }
  return deps.persistRecord({
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

export async function handleManagedProcessExit(
  deps: InstanceManagerLifecycleDeps,
  id: string,
  pid: number,
  exit: ManagedInstanceExitState,
): Promise<ManagedInstanceRecord> {
  return deps.enqueueOperation(async () => {
    const current = await deps.catalog.get(id);
    if (!current || current.currentProcess?.pid !== pid) {
      return (
        current ?? {
          id,
          status: "failed",
          createdAt: exit.at,
          updatedAt: exit.at,
          apiHost: deps.apiHost,
          apiPort: 0,
          runtime: buildRuntimePaths(deps.instanceRootDir, id),
        }
      );
    }
    return deps.persistRecord({
      ...current,
      status: exit.error ? "failed" : "stopped",
      updatedAt: exit.at,
      currentProcess: undefined,
      lastExit: exit,
      lastError: exit.error,
    });
  });
}

export async function monitorManagedProcessLiveness(
  deps: InstanceManagerLifecycleDeps,
  id: string,
  pid: number,
  handleProcessExit: (
    id: string,
    pid: number,
    exit: ManagedInstanceExitState,
  ) => Promise<ManagedInstanceRecord>,
): Promise<ManagedInstanceRecord> {
  while (await deps.processLauncher.isRunning(pid)) {
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, deps.reconcilePollMs));
  }
  return handleProcessExit(id, pid, {
    at: new Date().toISOString(),
    exitCode: null,
    signal: null,
    reason: "process exited after mule-doctor startup reconciliation",
  });
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
