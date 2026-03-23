import { ObserverTargetResolver } from "../observerTargetResolver.js";
import type { RustMuleClient } from "../api/rustMuleClient.js";
import type { SearchHealthLog } from "../searchHealth/searchHealthLog.js";
import type { DiagnosticTargetRef } from "../types/contracts.js";
import { ManagedInstanceDiagnosticsService } from "../instances/managedInstanceDiagnostics.js";
import { describeDiagnosticTarget } from "../targets/describeTarget.js";

export interface OperatorSearchDispatchResult {
  source: "operator_triggered_search";
  target: DiagnosticTargetRef;
  targetLabel: string;
  query: string;
  keywordIdHex?: string;
  searchId: string;
  dispatchedAt: string;
}

export class OperatorSearchService {
  private readonly managedDiagnostics: ManagedInstanceDiagnosticsService | undefined;
  private readonly observerTargetResolver: ObserverTargetResolver;
  private readonly searchHealthLog: SearchHealthLog | undefined;

  constructor(config: {
    managedDiagnostics?: ManagedInstanceDiagnosticsService;
    observerTargetResolver: ObserverTargetResolver;
    searchHealthLog?: SearchHealthLog;
  }) {
    this.managedDiagnostics = config.managedDiagnostics;
    this.observerTargetResolver = config.observerTargetResolver;
    this.searchHealthLog = config.searchHealthLog;
  }

  async startSearch(input: {
    mode: "managed_instance" | "active_target";
    instanceId?: string;
    query?: string;
    keywordIdHex?: string;
  }): Promise<OperatorSearchDispatchResult> {
    const query = input.query?.trim();
    const keywordIdHex = input.keywordIdHex?.trim();
    if (!query && !keywordIdHex) {
      throw new Error("manual search requires query or keywordIdHex");
    }
    if (query && keywordIdHex) {
      throw new Error("manual search requires either query or keywordIdHex, not both");
    }

    const runtime =
      input.mode === "managed_instance"
        ? await this.resolveManagedInstanceTarget(input.instanceId)
        : await this.observerTargetResolver.resolve();
    await this.loadClientToken(runtime.client);
    const [readiness, peers, dispatch] = await Promise.all([
      runtime.client.getReadiness(),
      runtime.client.getPeers(),
      runtime.client.startKeywordSearch({ query, keywordIdHex }),
    ]);
    const dispatchedAt = new Date().toISOString();
    const searchId = dispatch.search_id_hex ?? dispatch.keyword_id_hex;
    if (!searchId) {
      throw new Error(`search dispatch did not return a search identifier: ${JSON.stringify(dispatch)}`);
    }

    await this.searchHealthLog?.appendOperatorTriggeredDispatch({
      query,
      keywordIdHex,
      readiness,
      peerCount: peers.length,
      dispatch,
      dispatchedAt,
      instanceId: input.mode === "managed_instance" ? runtime.target.instanceId : undefined,
      target: input.mode === "active_target" ? runtime.target : undefined,
      targetLabel: input.mode === "active_target" ? runtime.label : undefined,
    });

    return {
      source: "operator_triggered_search",
      target: runtime.target,
      targetLabel: runtime.label,
      query: query ?? keywordIdHex ?? "keyword search",
      keywordIdHex,
      searchId,
      dispatchedAt,
    };
  }

  private async resolveManagedInstanceTarget(instanceId: string | undefined): Promise<{
    target: DiagnosticTargetRef;
    label: string;
    client: RustMuleClient;
  }> {
    if (!this.managedDiagnostics) {
      throw new Error("managed instance diagnostics unavailable for manual search");
    }
    if (!instanceId) {
      throw new Error("managed instance manual search requires an instanceId");
    }
    const record = await this.managedDiagnostics.getInstanceRecord(instanceId);
    if (record.status !== "running") {
      throw new Error(`Managed instance ${record.id} is ${record.status}`);
    }
    const target: DiagnosticTargetRef = {
      kind: "managed_instance",
      instanceId: record.id,
    };
    return {
      target,
      label: describeDiagnosticTarget(target),
      client: this.managedDiagnostics.getClientForInstance(record),
    };
  }

  private async loadClientToken(client: RustMuleClient): Promise<void> {
    if (typeof client.loadToken === "function") {
      await client.loadToken();
    }
  }
}
