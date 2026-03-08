import { open, stat } from "node:fs/promises";
import type { RustMuleClient } from "./api/rustMuleClient.js";
import type { RecentLogSource } from "./tools/toolRegistry.js";
import type { DiagnosticTargetRef } from "./types/contracts.js";
import { DiagnosticTargetService } from "./instances/diagnosticTargetService.js";
import { ManagedInstanceDiagnosticsService } from "./instances/managedInstanceDiagnostics.js";

const MAX_LOG_BYTES = 256 * 1024;
const DEFAULT_LOG_LINES = 200;

export interface ObserverTargetRuntime {
  target: DiagnosticTargetRef;
  label: string;
  client: RustMuleClient;
  logSource: RecentLogSource;
  logOffset?: number;
}

export class ObserverTargetResolver {
  private readonly targetService: DiagnosticTargetService;
  private readonly externalClient: RustMuleClient;
  private readonly externalLogSource: RecentLogSource & { getOffset?: () => number };
  private readonly managedDiagnostics: ManagedInstanceDiagnosticsService | undefined;

  constructor(config: {
    targetService: DiagnosticTargetService;
    externalClient: RustMuleClient;
    externalLogSource: RecentLogSource & { getOffset?: () => number };
    managedDiagnostics?: ManagedInstanceDiagnosticsService;
  }) {
    this.targetService = config.targetService;
    this.externalClient = config.externalClient;
    this.externalLogSource = config.externalLogSource;
    this.managedDiagnostics = config.managedDiagnostics;
  }

  async resolve(): Promise<ObserverTargetRuntime> {
    const target = await this.targetService.getActiveTarget();
    if (target.kind === "external") {
      return {
        target,
        label: "external configured rust-mule client",
        client: this.externalClient,
        logSource: this.externalLogSource,
        logOffset: this.externalLogSource.getOffset?.(),
      };
    }

    if (!this.managedDiagnostics) {
      throw new Error("managed instance diagnostics unavailable for observer targeting");
    }

    const instanceId = target.instanceId;
    if (!instanceId) {
      throw new Error("managed instance target requires an instanceId");
    }
    const record = await this.managedDiagnostics.getInstanceRecord(instanceId);
    if (record.status !== "running") {
      throw new Error(`Managed instance ${record.id} is ${record.status}`);
    }

    return {
      target,
      label: `managed instance ${record.id}`,
      client: this.managedDiagnostics.getClientForInstance(record),
      logSource: new StaticLogSource(await readTailLines(record.runtime.logPath, DEFAULT_LOG_LINES)),
    };
  }
}

class StaticLogSource {
  private readonly lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  getRecentLines(n?: number): string[] {
    if (n === undefined) {
      return [...this.lines];
    }
    return this.lines.slice(-n);
  }
}

async function readTailLines(filePath: string, lineLimit: number): Promise<string[]> {
  let fileSize: number;
  try {
    fileSize = (await stat(filePath)).size;
  } catch {
    return [];
  }

  const readStart = Math.max(0, fileSize - MAX_LOG_BYTES);
  const file = await open(filePath, "r");
  try {
    const bytesToRead = fileSize - readStart;
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, readStart);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (readStart > 0) {
      const firstNewline = text.indexOf("\n");
      if (firstNewline >= 0) {
        text = text.slice(firstNewline + 1);
      }
    }
    return text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-lineLimit);
  } finally {
    await file.close();
  }
}
