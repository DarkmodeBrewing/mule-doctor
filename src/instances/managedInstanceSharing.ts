import { mkdir, stat, writeFile } from "fs/promises";
import { basename, join } from "path";
import type {
  RustMuleClient,
} from "../api/rustMuleClient.js";
import type {
  ManagedInstanceRecord,
  ManagedInstanceSharedOverview,
  ManagedSharedFixture,
} from "../types/contracts.js";
import { ManagedInstanceDiagnosticsService } from "./managedInstanceDiagnostics.js";

export interface EnsureManagedSharedFixtureInput {
  fixtureId?: string;
}

export class ManagedInstanceSharingService {
  private readonly diagnostics: ManagedInstanceDiagnosticsService;

  constructor(diagnostics: ManagedInstanceDiagnosticsService) {
    this.diagnostics = diagnostics;
  }

  async getOverview(instanceId: string): Promise<ManagedInstanceSharedOverview> {
    const { record, client } = await this.resolveClient(instanceId);
    return this.fetchOverview(record, client);
  }

  async ensureFixture(
    instanceId: string,
    input: EnsureManagedSharedFixtureInput = {},
  ): Promise<ManagedSharedFixture> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const sharedDir = resolveSharedDir(record);
    await mkdir(sharedDir, { recursive: true });

    const fixtureId = normalizeFixtureId(input.fixtureId);
    const token = `mule-doctor-${record.id}-${fixtureId}`;
    const fileName = `${token}.txt`;
    const absolutePath = join(sharedDir, fileName);
    const relativePath = basename(absolutePath);
    const content = buildFixtureContent(record, fixtureId, token);

    await writeFile(absolutePath, content, "utf8");
    const fileStat = await stat(absolutePath);

    return {
      fixtureId,
      token,
      fileName,
      relativePath,
      absolutePath,
      sizeBytes: fileStat.size,
    };
  }

  async reindex(instanceId: string): Promise<ManagedInstanceSharedOverview> {
    const { record, client } = await this.resolveClient(instanceId);
    await client.reindexShared();
    return this.fetchOverview(record, client);
  }

  async republishSources(instanceId: string): Promise<ManagedInstanceSharedOverview> {
    const { record, client } = await this.resolveClient(instanceId);
    await client.republishSources();
    return this.fetchOverview(record, client);
  }

  async republishKeywords(instanceId: string): Promise<ManagedInstanceSharedOverview> {
    const { record, client } = await this.resolveClient(instanceId);
    await client.republishKeywords();
    return this.fetchOverview(record, client);
  }

  async triggerReindex(instanceId: string): Promise<void> {
    const { client } = await this.resolveClient(instanceId);
    await client.reindexShared();
  }

  async triggerRepublishSources(instanceId: string): Promise<void> {
    const { client } = await this.resolveClient(instanceId);
    await client.republishSources();
  }

  async triggerRepublishKeywords(instanceId: string): Promise<void> {
    const { client } = await this.resolveClient(instanceId);
    await client.republishKeywords();
  }

  private async resolveClient(
    instanceId: string,
  ): Promise<{ record: ManagedInstanceRecord; client: RustMuleClient }> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    return { record, client };
  }

  private async fetchOverview(
    record: ManagedInstanceRecord,
    client: RustMuleClient,
  ): Promise<ManagedInstanceSharedOverview> {
    const sharedDir = resolveSharedDir(record);
    const [files, actions, downloads] = await Promise.all([
      client.getSharedFiles(),
      client.getSharedActions(),
      client.getDownloads(),
    ]);
    return {
      instanceId: record.id,
      sharedDir,
      files: files.files,
      actions: actions.actions,
      downloads: downloads.downloads,
    };
  }
}

function resolveSharedDir(record: ManagedInstanceRecord): string {
  const sharedDir = record.runtime.sharedDir?.trim();
  if (sharedDir) {
    return sharedDir;
  }
  return join(record.runtime.rootDir, "shared");
}

function normalizeFixtureId(fixtureId: string | undefined): string {
  const trimmed = fixtureId?.trim();
  if (!trimmed) {
    return "discoverability";
  }
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "discoverability";
}

function buildFixtureContent(
  record: ManagedInstanceRecord,
  fixtureId: string,
  token: string,
): string {
  return [
    `fixture_id=${fixtureId}`,
    `instance_id=${record.id}`,
    `search_token=${token}`,
    "",
    "Managed discoverability fixture for mule-doctor.",
  ].join("\n");
}
