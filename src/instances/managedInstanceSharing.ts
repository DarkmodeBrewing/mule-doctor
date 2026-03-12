import { mkdir, stat, writeFile } from "fs/promises";
import { basename, join } from "path";
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
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    const [files, actions, downloads] = await Promise.all([
      client.getSharedFiles(),
      client.getSharedActions(),
      client.getDownloads(),
    ]);
    return {
      instanceId: record.id,
      sharedDir: record.runtime.sharedDir,
      files: files.files,
      actions: actions.actions,
      downloads: downloads.downloads,
    };
  }

  async ensureFixture(
    instanceId: string,
    input: EnsureManagedSharedFixtureInput = {},
  ): Promise<ManagedSharedFixture> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    await mkdir(record.runtime.sharedDir, { recursive: true });

    const fixtureId = normalizeFixtureId(input.fixtureId);
    const token = `mule-doctor-${record.id}-${fixtureId}`;
    const fileName = `${token}.txt`;
    const absolutePath = join(record.runtime.sharedDir, fileName);
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
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    await client.reindexShared();
    return this.getOverview(instanceId);
  }

  async republishSources(instanceId: string): Promise<ManagedInstanceSharedOverview> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    await client.republishSources();
    return this.getOverview(instanceId);
  }

  async republishKeywords(instanceId: string): Promise<ManagedInstanceSharedOverview> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    await client.republishKeywords();
    return this.getOverview(instanceId);
  }
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
