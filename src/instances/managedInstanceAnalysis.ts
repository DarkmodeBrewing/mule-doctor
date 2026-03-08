import { open, stat } from "node:fs/promises";
import { Analyzer } from "../llm/analyzer.js";
import type { UsageTracker } from "../llm/usageTracker.js";
import { ToolRegistry, type PatchProposalNotifier } from "../tools/toolRegistry.js";
import { redactLine, redactText } from "../logs/redaction.js";
import type {
  ManagedInstanceAnalysisResult,
  ManagedInstanceDiagnosticSnapshot,
} from "../types/contracts.js";
import type { InstanceManager } from "./instanceManager.js";
import { ManagedInstanceDiagnosticsService } from "./managedInstanceDiagnostics.js";

const MAX_LOG_BYTES = 256 * 1024;
const DEFAULT_LOG_LINES = 200;

export interface ManagedInstanceAnalysisServiceConfig {
  apiKey: string;
  instanceManager: InstanceManager;
  diagnostics: ManagedInstanceDiagnosticsService;
  model?: string;
  usageTracker?: UsageTracker;
  sourcePath?: string;
  proposalDir?: string;
  patchProposalNotifier?: PatchProposalNotifier;
}

export class ManagedInstanceAnalysisService {
  private readonly apiKey: string;
  private readonly instanceManager: InstanceManager;
  private readonly diagnostics: ManagedInstanceDiagnosticsService;
  private readonly model: string | undefined;
  private readonly usageTracker: UsageTracker | undefined;
  private readonly sourcePath: string | undefined;
  private readonly proposalDir: string | undefined;
  private readonly patchProposalNotifier: PatchProposalNotifier | undefined;

  constructor(config: ManagedInstanceAnalysisServiceConfig) {
    this.apiKey = config.apiKey;
    this.instanceManager = config.instanceManager;
    this.diagnostics = config.diagnostics;
    this.model = config.model;
    this.usageTracker = config.usageTracker;
    this.sourcePath = config.sourcePath;
    this.proposalDir = config.proposalDir;
    this.patchProposalNotifier = config.patchProposalNotifier;
  }

  async analyze(instanceId: string): Promise<ManagedInstanceAnalysisResult> {
    const snapshot = await this.diagnostics.getSnapshot(instanceId);
    if (!snapshot.available) {
      return {
        instanceId,
        analyzedAt: new Date().toISOString(),
        available: false,
        reason: snapshot.reason,
        summary: snapshot.reason ?? "managed instance is unavailable for analysis",
        snapshot,
      };
    }

    const record = await this.instanceManager.getInstance(instanceId);
    if (!record) {
      throw new Error(`Managed instance not found: ${instanceId}`);
    }

    const logSource = new StaticLogSource(await readTailLines(record.runtime.logPath, DEFAULT_LOG_LINES));
    const client = this.diagnostics.getClientForInstance(record);
    const tools = new ToolRegistry(client, logSource, undefined, {
      sourcePath: this.sourcePath,
      proposalDir: this.proposalDir,
      patchProposalNotifier: this.patchProposalNotifier,
    });
    const analyzer = new Analyzer(this.apiKey, tools, {
      model: this.model,
      usageTracker: this.usageTracker,
    });

    const summary = await analyzer.analyze(buildPrompt(snapshot));
    return {
      instanceId,
      analyzedAt: new Date().toISOString(),
      available: true,
      summary: redactText(summary),
      snapshot,
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
      .map((line) => redactLine(line.trimEnd()))
      .filter((line) => line.length > 0)
      .slice(-lineLimit);
  } finally {
    await file.close();
  }
}

function buildPrompt(snapshot: ManagedInstanceDiagnosticSnapshot): string {
  return (
    `Analyze managed rust-mule instance ${snapshot.instanceId}. ` +
    "Use the available tools to verify the current state, review recent logs, and produce a concise diagnostic summary.\n\n" +
    JSON.stringify(snapshot)
  );
}
