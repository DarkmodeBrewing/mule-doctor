import type { SearchHealthLog } from "../searchHealth/searchHealthLog.js";
import type {
  RustMuleKeywordSearchInfo,
  RustMuleReadiness,
  RustMuleSearchDetailResponse,
} from "../api/rustMuleClient.js";
import { ManagedInstanceDiagnosticsService } from "./managedInstanceDiagnostics.js";
import { ManagedInstanceObservedSearchRecorder } from "./managedInstanceObservedSearchRecorder.js";
import {
  buildManagedInstanceSurfaceSnapshot,
} from "./managedInstanceSurfaceDiagnosticsView.js";
import type {
  ManagedInstanceSurfaceDiagnosticsSnapshot,
  ManagedInstanceSurfaceDiagnosticsSummary,
} from "./managedInstanceSurfaceDiagnosticsTypes.js";

export type {
  ManagedInstanceSurfaceDiagnosticsSnapshot,
  ManagedInstanceSurfaceDiagnosticsSummary,
} from "./managedInstanceSurfaceDiagnosticsTypes.js";

export class ManagedInstanceSurfaceDiagnosticsService {
  private readonly diagnostics: ManagedInstanceDiagnosticsService;
  private readonly observedSearchRecorder: ManagedInstanceObservedSearchRecorder;

  constructor(
    diagnostics: ManagedInstanceDiagnosticsService,
    config: {
      searchHealthLog?: SearchHealthLog;
    } = {},
  ) {
    this.diagnostics = diagnostics;
    this.observedSearchRecorder = new ManagedInstanceObservedSearchRecorder(
      config.searchHealthLog,
    );
  }

  async getSummary(instanceId: string): Promise<ManagedInstanceSurfaceDiagnosticsSummary> {
    const snapshot = await this.getSnapshot(instanceId);
    return {
      instanceId: snapshot.instanceId,
      observedAt: snapshot.observedAt,
      summary: snapshot.summary,
      highlights: snapshot.highlights,
    };
  }

  async getSnapshot(instanceId: string): Promise<ManagedInstanceSurfaceDiagnosticsSnapshot> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    const [status, searches, shared, actions, downloads, peers] = await Promise.all([
      client.getStatus(),
      client.getSearches(),
      client.getSharedFiles(),
      client.getSharedActions(),
      client.getDownloads(),
      client.getPeers(),
    ]);
    const readiness: RustMuleReadiness = {
      statusReady: status.ready === true,
      searchesReady: searches.ready === true,
      ready: status.ready === true && searches.ready === true,
      status,
      searches,
    };
    await this.observedSearchRecorder.record({
      instanceId: record.id,
      readiness,
      peerCount: peers.length,
      client: client as {
        getSearchDetail(searchId: string): Promise<RustMuleSearchDetailResponse>;
      },
      searches: searches.searches as RustMuleKeywordSearchInfo[],
    });
    return buildManagedInstanceSurfaceSnapshot({
      instanceId: record.id,
      observedAt: new Date().toISOString(),
      searches,
      shared,
      actions,
      downloads,
    });
  }
}
