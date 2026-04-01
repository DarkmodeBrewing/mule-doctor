import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-instance-manager-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function writeFakeRustMuleBinary(dir) {
  const rustMuleBinaryPath = join(dir, "fake-rust-mule");
  await writeFile(rustMuleBinaryPath, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  return rustMuleBinaryPath;
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class FakeProcessLauncher {
  nextPid = 5000;
  running = new Set();
  handles = new Map();
  launches = [];
  stopCalls = [];

  async launch(spec) {
    const pid = this.nextPid++;
    let resolveExit;
    const exit = new Promise((resolve) => {
      resolveExit = resolve;
    });
    this.running.add(pid);
    this.handles.set(pid, { resolveExit });
    this.launches.push(spec);
    return { pid, exit };
  }

  async stop(pid, signal = "SIGTERM") {
    this.stopCalls.push({ pid, signal });
    this.exitProcess(pid, { exitCode: 0, signal });
  }

  async isRunning(pid) {
    return this.running.has(pid);
  }

  exitProcess(pid, exit = {}) {
    if (!this.running.has(pid)) {
      return;
    }
    this.running.delete(pid);
    const handle = this.handles.get(pid);
    if (!handle) {
      return;
    }
    this.handles.delete(pid);
    handle.resolveExit({
      at: new Date().toISOString(),
      exitCode: exit.exitCode ?? 0,
      signal: exit.signal ?? null,
      reason: exit.reason,
      error: exit.error,
    });
  }
}
