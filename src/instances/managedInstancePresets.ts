import type {
  AppliedManagedInstancePreset,
  ApplyManagedInstancePresetInput,
  ManagedInstancePresetDefinition,
  StartedManagedInstancePreset,
} from "../types/contracts.js";
import type { InstanceManager } from "./instanceManager.js";

const DEFAULT_PRESETS: ManagedInstancePresetDefinition[] = [
  {
    id: "pair",
    name: "Pair",
    description: "Create two local rust-mule instances for direct side-by-side testing.",
    nodes: [
      { suffix: "a" },
      { suffix: "b" },
    ],
  },
  {
    id: "trio",
    name: "Trio",
    description: "Create three local rust-mule instances for small-cluster testing.",
    nodes: [
      { suffix: "a" },
      { suffix: "b" },
      { suffix: "c" },
    ],
  },
];

export class ManagedInstancePresetService {
  private readonly instanceManager: InstanceManager;
  private readonly presets: ManagedInstancePresetDefinition[];

  constructor(
    instanceManager: InstanceManager,
    presets: ManagedInstancePresetDefinition[] = DEFAULT_PRESETS,
  ) {
    this.instanceManager = instanceManager;
    this.presets = presets.slice();
  }

  listPresets(): ManagedInstancePresetDefinition[] {
    return this.presets.slice();
  }

  async applyPreset(
    input: ApplyManagedInstancePresetInput,
  ): Promise<AppliedManagedInstancePreset> {
    const preset = this.presets.find((candidate) => candidate.id === input.presetId);
    if (!preset) {
      throw new Error(`Managed instance preset not found: ${input.presetId}`);
    }

    const prefix = normalizePresetPrefix(input.prefix);
    const created = await this.instanceManager.createPlannedInstances(
      preset.nodes.map((node) => ({
        id: `${prefix}-${node.suffix}`,
        preset: {
          presetId: preset.id,
          prefix,
        },
      })),
    );

    return {
      presetId: preset.id,
      prefix,
      instances: created,
    };
  }

  async startPreset(prefixRaw: string): Promise<StartedManagedInstancePreset> {
    const prefix = normalizePresetPrefix(prefixRaw);
    const instances = (await this.instanceManager.listInstances()).filter(
      (instance) => instance.preset?.prefix === prefix,
    );
    if (instances.length === 0) {
      throw new Error(`Managed instance preset group not found: ${prefix}`);
    }

    const presetId = instances[0].preset?.presetId ?? "unknown";
    const failures: StartedManagedInstancePreset["failures"] = [];
    const started: StartedManagedInstancePreset["instances"] = [];

    for (const instance of instances) {
      try {
        started.push(await this.instanceManager.startInstance(instance.id));
      } catch (err) {
        failures.push({
          instanceId: instance.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      presetId,
      prefix,
      instances: started,
      failures,
    };
  }
}

function normalizePresetPrefix(raw: string): string {
  const prefix = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,20}$/.test(prefix)) {
    throw new Error(`Invalid managed instance preset prefix: ${raw}`);
  }
  return prefix;
}
