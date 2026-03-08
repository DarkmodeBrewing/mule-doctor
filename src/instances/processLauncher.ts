import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ManagedInstanceExitState } from "../types/contracts.js";

export interface LaunchProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
}

export interface ManagedProcessHandle {
  pid: number;
  exit: Promise<ManagedInstanceExitState>;
}

export interface ProcessLauncher {
  launch(spec: LaunchProcessSpec): Promise<ManagedProcessHandle>;
  stop(pid: number, signal?: NodeJS.Signals): Promise<void>;
  isRunning(pid: number): Promise<boolean>;
}

export class NodeProcessLauncher implements ProcessLauncher {
  async launch(spec: LaunchProcessSpec): Promise<ManagedProcessHandle> {
    await mkdir(dirname(spec.logPath), { recursive: true });
    const logFile = await open(spec.logPath, "a");
    let child: ChildProcess | undefined;

    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env ?? process.env,
        stdio: ["ignore", logFile.fd, logFile.fd],
      });

      await new Promise<void>((resolveLaunch, rejectLaunch) => {
        child?.once("spawn", () => resolveLaunch());
        child?.once("error", (err) => rejectLaunch(err));
      });
    } catch (err) {
      await logFile.close().catch(() => undefined);
      throw err;
    }

    const pid = child.pid;
    if (!pid) {
      await logFile.close().catch(() => undefined);
      throw new Error(`Process launcher did not receive a child pid for ${spec.command}`);
    }

    const exit = new Promise<ManagedInstanceExitState>((resolveExit) => {
      const closeLogFile = async () => {
        await logFile.close().catch(() => undefined);
      };

      child.once("exit", (code, signal) => {
        void closeLogFile();
        resolveExit({
          at: new Date().toISOString(),
          exitCode: code,
          signal,
        });
      });

      child.once("error", (err) => {
        void closeLogFile();
        resolveExit({
          at: new Date().toISOString(),
          exitCode: null,
          signal: null,
          error: String(err),
        });
      });
    });

    return { pid, exit };
  }

  async stop(pid: number, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    try {
      process.kill(pid, signal);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ESRCH") {
        return;
      }
      throw err;
    }
  }

  async isRunning(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ESRCH") {
        return false;
      }
      if (error.code === "EPERM") {
        return true;
      }
      throw err;
    }
  }
}
