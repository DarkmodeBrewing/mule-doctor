/**
 * rustMuleClient.ts
 * HTTP client for the rust-mule control plane API.
 * Polls endpoints periodically and exposes typed response helpers.
 */

import { readFile } from "fs/promises";

export interface NodeInfo {
  nodeId: string;
  version: string;
  uptime: number;
  [key: string]: unknown;
}

export interface Peer {
  id: string;
  address: string;
  latencyMs?: number;
  [key: string]: unknown;
}

export interface RoutingBucket {
  index: number;
  count: number;
  size: number;
  [key: string]: unknown;
}

export interface LookupStats {
  total: number;
  successful: number;
  failed: number;
  avgDurationMs: number;
  [key: string]: unknown;
}

export class RustMuleClient {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly tokenPath: string | undefined;
  private authToken: string | undefined;

  constructor(baseUrl: string, tokenPath?: string, apiPrefix = "/api/v1") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiPrefix = apiPrefix.startsWith("/") ? apiPrefix : `/${apiPrefix}`;
    this.tokenPath = tokenPath;
  }

  /** Load bearer token from disk (if configured). */
  async loadToken(): Promise<void> {
    if (!this.tokenPath) return;
    try {
      this.authToken = (await readFile(this.tokenPath, "utf8")).trim();
      log("info", "rustMuleClient", "Auth token loaded");
    } catch (err) {
      log("warn", "rustMuleClient", `Failed to load token: ${String(err)}`);
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) h["Authorization"] = `Bearer ${this.authToken}`;
    return h;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${this.apiPrefix}${path}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`GET ${url} failed with status ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async getNodeInfo(): Promise<NodeInfo> {
    const status = await this.get<Record<string, unknown>>("/status");
    return {
      nodeId:
        typeof status["node_id_hex"] === "string"
          ? status["node_id_hex"]
          : "unknown",
      version:
        typeof status["version"] === "string"
          ? status["version"]
          : "unknown",
      uptime:
        typeof status["uptime_secs"] === "number"
          ? status["uptime_secs"]
          : 0,
      ...status,
    };
  }

  async getPeers(): Promise<Peer[]> {
    const payload = await this.get<{ peers?: Array<Record<string, unknown>> }>(
      "/kad/peers"
    );
    const peers = payload.peers ?? [];
    return peers.map((p) => ({
      id:
        typeof p["kad_id_hex"] === "string"
          ? p["kad_id_hex"]
          : typeof p["source_id_hex"] === "string"
            ? p["source_id_hex"]
            : "unknown",
      address:
        typeof p["udp_dest_short"] === "string"
          ? p["udp_dest_short"]
          : typeof p["udp_dest_b64"] === "string"
            ? p["udp_dest_b64"]
            : "unknown",
      ...p,
    }));
  }

  async getRoutingBuckets(): Promise<RoutingBucket[]> {
    try {
      const payload = await this.get<{
        buckets?: Array<Record<string, unknown>>;
      }>("/debug/routing/buckets");
      const buckets = payload.buckets ?? [];
      return buckets.map((b) => {
        const count = typeof b["count"] === "number" ? b["count"] : 0;
        return {
          index: typeof b["index"] === "number" ? b["index"] : 0,
          count,
          size: count,
          ...b,
        };
      });
    } catch (err) {
      log(
        "warn",
        "rustMuleClient",
        `Routing buckets unavailable (debug endpoints disabled?): ${String(err)}`
      );
      return [];
    }
  }

  async getLookupStats(): Promise<LookupStats> {
    const status = await this.get<Record<string, unknown>>("/status");
    const total =
      typeof status["sent_reqs_total"] === "number"
        ? status["sent_reqs_total"]
        : 0;
    const successful =
      typeof status["tracked_out_matched_total"] === "number"
        ? status["tracked_out_matched_total"]
        : typeof status["recv_ress_total"] === "number"
          ? status["recv_ress_total"]
          : 0;
    const failed =
      (typeof status["timeouts_total"] === "number"
        ? status["timeouts_total"]
        : 0) +
      (typeof status["tracked_out_unmatched_total"] === "number"
        ? status["tracked_out_unmatched_total"]
        : 0) +
      (typeof status["tracked_out_expired_total"] === "number"
        ? status["tracked_out_expired_total"]
        : 0);
    return {
      total,
      successful,
      failed,
      avgDurationMs: 0,
      ...status,
    };
  }
}

// Minimal structured logger shared across the module.
function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
