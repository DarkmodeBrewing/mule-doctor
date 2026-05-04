import type { RustMuleClient } from "../api/rustMuleClient.js";
import type { RuntimeStore } from "../storage/runtimeStore.js";
import type { ToolResult } from "../types/contracts.js";
import { buildCoreTools } from "./toolRegistryCoreTools.js";
import { buildRuntimeTools } from "./toolRegistryRuntimeTools.js";
import {
  getAllowedToolNames,
  type PatchProposalNotifier,
  type RecentLogSource,
  type ToolDefinition,
  type ToolHandler,
  type ToolProfile,
  type ToolRegistryOptions,
} from "./toolRegistryShared.js";
import { buildSourceTools } from "./toolRegistrySourceTools.js";
import { buildSurfaceTools } from "./toolRegistrySurfaceTools.js";

export type {
  PatchProposalEvent,
  PatchProposalNotifier,
  RecentLogSource,
  ToolDefinition,
  ToolHandler,
  ToolProfile,
  ToolRegistryOptions,
} from "./toolRegistryShared.js";

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();
  private readonly definitions: ToolDefinition[] = [];
  private patchProposalNotifier: PatchProposalNotifier | undefined;

  constructor(
    client: RustMuleClient,
    logWatcher: RecentLogSource,
    runtimeStore?: RuntimeStore,
    options: ToolRegistryOptions = {},
  ) {
    this.patchProposalNotifier = options.patchProposalNotifier;
    for (const tool of buildCoreTools(client, logWatcher)) {
      this.register(tool.definition, tool.handler);
    }
    for (const tool of buildRuntimeTools(runtimeStore)) {
      this.register(tool.definition, tool.handler);
    }
    for (const tool of buildSurfaceTools(client)) {
      this.register(tool.definition, tool.handler);
    }
    for (const tool of buildSourceTools(options, () => this.patchProposalNotifier)) {
      this.register(tool.definition, tool.handler);
    }

    this.applyToolProfile(options.toolProfile ?? "observer_cycle");
  }

  private register(def: ToolDefinition, handler: ToolHandler): void {
    this.definitions.push(def);
    this.handlers.set(def.function.name, handler);
  }

  private applyToolProfile(profile: ToolProfile): void {
    const allowed = getAllowedToolNames(profile);
    if (!allowed) {
      return;
    }

    const filteredDefinitions = this.definitions.filter((definition) =>
      allowed.has(definition.function.name),
    );
    this.definitions.length = 0;
    this.definitions.push(...filteredDefinitions);

    for (const name of Array.from(this.handlers.keys())) {
      if (!allowed.has(name)) {
        this.handlers.delete(name);
      }
    }
  }

  /** All tool definitions to send to the OpenAI API. */
  getDefinitions(): ToolDefinition[] {
    return [...this.definitions];
  }

  setPatchProposalNotifier(notifier: PatchProposalNotifier | undefined): void {
    this.patchProposalNotifier = notifier;
  }

  /** Invoke a tool by name with parsed arguments and return a structured result envelope. */
  async invoke(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        tool: name,
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }
    try {
      const data = await handler(args);
      return {
        tool: name,
        success: true,
        data,
      };
    } catch (err) {
      return {
        tool: name,
        success: false,
        error: String(err),
      };
    }
  }
}
