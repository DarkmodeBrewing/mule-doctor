import { RustMuleClient } from "../api/rustMuleClient.js";
import { getNetworkHealth } from "../health/healthScore.js";
import type {
  ManagedInstanceDiagnosticSnapshot,
  ManagedInstanceRecord,
} from "../types/contracts.js";
import type { InstanceManager } from "./instanceManager.js";

export class ManagedInstanceDiagnosticsService {
  private readonly instanceManager: InstanceManager;
  private readonly clients = new Map<string, RustMuleClient>();
  private readonly apiPrefix: string;
  private readonly httpTimeoutMs: number;

  constructor(
    instanceManager: InstanceManager,
    options: { apiPrefix?: string; httpTimeoutMs?: number } = {},
  ) {
    this.instanceManager = instanceManager;
    this.apiPrefix = options.apiPrefix ?? "/api/v1";
    this.httpTimeoutMs = options.httpTimeoutMs ?? 5000;
  }

  async getSnapshot(instanceId: string): Promise<ManagedInstanceDiagnosticSnapshot> {
    const record = await this.instanceManager.getInstance(instanceId);
    if (!record) {
      throw new Error(`Managed instance not found: ${instanceId}`);
    }
    if (record.status !== "running") {
      return unavailableSnapshot(record, `instance is ${record.status}`);
    }

    const client = this.getClientForInstance(record);
    try {
      await client.loadToken();
      const [nodeInfo, peers, routingBuckets, lookupStats] = await Promise.all([
        client.getNodeInfo(),
        client.getPeers(),
        client.getRoutingBuckets(),
        client.getLookupStats(),
      ]);
      const networkHealth = getNetworkHealth({
        peerCount: peers.length,
        routingBuckets,
        lookupStats,
      });
      return {
        instanceId: record.id,
        observedAt: new Date().toISOString(),
        available: true,
        nodeInfo,
        peerCount: peers.length,
        routingBucketCount: routingBuckets.length,
        lookupStats,
        networkHealth: {
          score: networkHealth.score,
          components: { ...networkHealth.components },
        },
      };
    } catch (err) {
      return unavailableSnapshot(record, `diagnostics unavailable: ${String(err)}`);
    }
  }

  getClientForInstance(record: ManagedInstanceRecord): RustMuleClient {
    const existing = this.clients.get(record.id);
    if (existing) {
      return existing;
    }
    const client = new RustMuleClient(
      `http://${record.apiHost}:${record.apiPort}`,
      record.runtime.tokenPath,
      this.apiPrefix,
      record.runtime.debugTokenPath,
      this.httpTimeoutMs,
    );
    this.clients.set(record.id, client);
    return client;
  }
}

function unavailableSnapshot(
  record: ManagedInstanceRecord,
  reason: string,
): ManagedInstanceDiagnosticSnapshot {
  return {
    instanceId: record.id,
    observedAt: new Date().toISOString(),
    available: false,
    reason,
  };
}
