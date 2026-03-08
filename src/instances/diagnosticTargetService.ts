import type { RuntimeStore } from "../storage/runtimeStore.js";
import type { DiagnosticTargetRef } from "../types/contracts.js";
import type { InstanceManager } from "./instanceManager.js";

const EXTERNAL_TARGET: DiagnosticTargetRef = { kind: "external" };

export class DiagnosticTargetService {
  private readonly runtimeStore: RuntimeStore | undefined;
  private readonly instanceManager: InstanceManager | undefined;

  constructor(config: {
    runtimeStore?: RuntimeStore;
    instanceManager?: InstanceManager;
  }) {
    this.runtimeStore = config.runtimeStore;
    this.instanceManager = config.instanceManager;
  }

  async getActiveTarget(): Promise<DiagnosticTargetRef> {
    if (!this.runtimeStore) {
      return EXTERNAL_TARGET;
    }

    const state = await this.runtimeStore.loadState();
    return normalizeTarget(state.activeDiagnosticTarget);
  }

  async setActiveTarget(input: DiagnosticTargetRef): Promise<DiagnosticTargetRef> {
    const target = normalizeTarget(input);
    await this.validateTarget(target);

    if (this.runtimeStore) {
      await this.runtimeStore.updateState({ activeDiagnosticTarget: target });
    }

    return target;
  }

  private async validateTarget(target: DiagnosticTargetRef): Promise<void> {
    if (target.kind === "external") {
      return;
    }

    if (!this.instanceManager) {
      throw new Error("managed instance targeting is unavailable");
    }

    const instanceId = target.instanceId;
    if (!instanceId) {
      throw new Error("managed instance target requires an instanceId");
    }
    const instance = await this.instanceManager.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Managed instance not found: ${instanceId}`);
    }
  }
}

function normalizeTarget(input: DiagnosticTargetRef | undefined): DiagnosticTargetRef {
  if (!input || input.kind === "external") {
    return EXTERNAL_TARGET;
  }

  if (input.kind !== "managed_instance") {
    throw new Error(`Unsupported diagnostic target kind: ${String(input.kind)}`);
  }

  const instanceId = input.instanceId?.trim();
  if (!instanceId) {
    throw new Error("managed instance target requires an instanceId");
  }

  return {
    kind: "managed_instance",
    instanceId,
  };
}
