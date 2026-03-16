import type { SearchPublishDiagnosticsSummary } from "../diagnostics/rustMuleSurfaceSummaries.js";
import { summarizeSearchPublishDiagnostics } from "../diagnostics/rustMuleSurfaceSummaries.js";
import { ManagedInstanceDiagnosticsService } from "./managedInstanceDiagnostics.js";

export interface ManagedInstanceSurfaceDiagnosticsSummary {
  instanceId: string;
  observedAt: string;
  summary: SearchPublishDiagnosticsSummary;
}

export class ManagedInstanceSurfaceDiagnosticsService {
  private readonly diagnostics: ManagedInstanceDiagnosticsService;

  constructor(diagnostics: ManagedInstanceDiagnosticsService) {
    this.diagnostics = diagnostics;
  }

  async getSummary(instanceId: string): Promise<ManagedInstanceSurfaceDiagnosticsSummary> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    const [searches, shared, actions, downloads] = await Promise.all([
      client.getSearches(),
      client.getSharedFiles(),
      client.getSharedActions(),
      client.getDownloads(),
    ]);
    return {
      instanceId: record.id,
      observedAt: new Date().toISOString(),
      summary: summarizeSearchPublishDiagnostics({
        searches,
        shared,
        actions,
        downloads,
      }),
    };
  }
}
