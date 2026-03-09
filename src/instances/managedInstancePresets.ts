import type {
  AppliedManagedInstancePreset,
  ApplyManagedInstancePresetInput,
  ManagedInstancePresetDefinition,
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
      })),
    );

    return {
      presetId: preset.id,
      prefix,
      instances: created,
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
