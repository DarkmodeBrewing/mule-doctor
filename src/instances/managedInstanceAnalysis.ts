import { Analyzer } from "../llm/analyzer.js";
import type { LlmInvocationAuditSink } from "../llm/invocationAuditLog.js";
import type { UsageTracker } from "../llm/usageTracker.js";
import { ToolRegistry, type PatchProposalNotifier } from "../tools/toolRegistry.js";
import { redactText } from "../logs/redaction.js";
import { RecentFileLogSource } from "../logs/recentFileLogSource.js";
import type {
  ManagedInstanceAnalysisResult,
  ManagedInstanceDiagnosticSnapshot,
} from "../types/contracts.js";
import type { InstanceManager } from "./instanceManager.js";
import { ManagedInstanceDiagnosticsService } from "./managedInstanceDiagnostics.js";

export interface ManagedInstanceAnalysisServiceConfig {
  apiKey: string;
  instanceManager: InstanceManager;
  diagnostics: ManagedInstanceDiagnosticsService;
  model?: string;
  usageTracker?: UsageTracker;
  invocationAudit?: LlmInvocationAuditSink;
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
  private readonly invocationAudit: LlmInvocationAuditSink | undefined;
  private readonly sourcePath: string | undefined;
  private readonly proposalDir: string | undefined;
  private readonly patchProposalNotifier: PatchProposalNotifier | undefined;

  constructor(config: ManagedInstanceAnalysisServiceConfig) {
    this.apiKey = config.apiKey;
    this.instanceManager = config.instanceManager;
    this.diagnostics = config.diagnostics;
    this.model = config.model;
    this.usageTracker = config.usageTracker;
    this.invocationAudit = config.invocationAudit;
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

    const logSource = new RecentFileLogSource(record.runtime.logPath, { redact: true });
    const client = this.diagnostics.getClientForInstance(record);
    const tools = new ToolRegistry(client, logSource, undefined, {
      sourcePath: this.sourcePath,
      proposalDir: this.proposalDir,
      patchProposalNotifier: this.patchProposalNotifier,
    });
    const analyzer = new Analyzer(this.apiKey, tools, {
      model: this.model,
      usageTracker: this.usageTracker,
      invocationAudit: this.invocationAudit,
    });

    const summary = await analyzer.analyze(buildManagedInstanceAnalysisPrompt(snapshot), {
      surface: "managed_instance_analysis",
      trigger: "human",
      target: { kind: "managed_instance", instanceId },
    });
    return {
      instanceId,
      analyzedAt: new Date().toISOString(),
      available: true,
      summary: redactText(summary),
      snapshot,
    };
  }
}

export function buildManagedInstanceAnalysisPrompt(
  snapshot: ManagedInstanceDiagnosticSnapshot,
): string {
  return [
    `Analyze managed rust-mule instance ${snapshot.instanceId}.`,
    "Use the provided managed-instance snapshot as baseline context.",
    "Inspect the snapshot first and only call tools if the snapshot or recent logs leave an important uncertainty.",
    "Do not perform redundant tool calls. Keep tool use bounded and evidence-based.",
    "Return:",
    "1. Instance status",
    "2. Confirmed issues",
    "3. Probable issues or risks",
    "4. Hypotheses or unknowns",
    "5. Supporting evidence",
    "6. Recommended next steps",
    "",
    "Managed-instance snapshot:",
    JSON.stringify(snapshot),
  ].join("\n");
}
