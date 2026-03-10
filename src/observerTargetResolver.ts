import type { RustMuleClient } from "./api/rustMuleClient.js";
import type { RecentLogSource } from "./tools/toolRegistry.js";
import type { DiagnosticTargetRef } from "./types/contracts.js";
import { DiagnosticTargetService } from "./instances/diagnosticTargetService.js";
import { ManagedInstanceDiagnosticsService } from "./instances/managedInstanceDiagnostics.js";
import { RecentFileLogSource } from "./logs/recentFileLogSource.js";

export interface ObserverTargetRuntime {
  target: DiagnosticTargetRef;
  label: string;
  client: RustMuleClient;
  logSource: RecentLogSource;
  logOffset?: number;
}

export interface ObserverTargetDescriptor {
  target: DiagnosticTargetRef;
  label: string;
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
    const descriptor = await this.describeActiveTarget();
    const target = descriptor.target;
    if (target.kind === "external") {
      return {
        target,
        label: descriptor.label,
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
      label: descriptor.label,
      client: this.managedDiagnostics.getClientForInstance(record),
      logSource: new RecentFileLogSource(record.runtime.logPath),
    };
  }

  async describeActiveTarget(): Promise<ObserverTargetDescriptor> {
    const target = await this.targetService.getActiveTarget();
    return {
      target,
      label:
        target.kind === "external"
          ? "external configured rust-mule client"
          : `managed instance ${target.instanceId}`,
    };
  }
}
