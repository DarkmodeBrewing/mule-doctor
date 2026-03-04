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
  private readonly tokenPath: string | undefined;
  private authToken: string | undefined;

  constructor(baseUrl: string, tokenPath?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
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
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`GET ${url} failed with status ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async getNodeInfo(): Promise<NodeInfo> {
    return this.get<NodeInfo>("/node/info");
  }

  async getPeers(): Promise<Peer[]> {
    return this.get<Peer[]>("/peers");
  }

  async getRoutingBuckets(): Promise<RoutingBucket[]> {
    return this.get<RoutingBucket[]>("/routing/buckets");
  }

  async getLookupStats(): Promise<LookupStats> {
    return this.get<LookupStats>("/lookups/stats");
  }
}

// Minimal structured logger shared across the module.
function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
