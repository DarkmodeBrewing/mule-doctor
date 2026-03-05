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
  matchPerSent: number;
  timeoutsPerSent: number;
  outboundShaperDelayedTotal: number;
  [key: string]: unknown;
}

interface RequestOptions {
  debug?: boolean;
}

class HttpError extends Error {
  readonly status: number;

  constructor(method: string, url: string, status: number) {
    super(`${method} ${url} failed with status ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export class RustMuleClient {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly tokenPath: string | undefined;
  private readonly debugTokenPath: string | undefined;
  private authToken: string | undefined;
  private debugToken: string | undefined;

  constructor(
    baseUrl: string,
    tokenPath?: string,
    apiPrefix = "/api/v1",
    debugTokenPath?: string
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    const trimmedPrefix = apiPrefix.trim();
    if (trimmedPrefix === "") {
      this.apiPrefix = "";
    } else {
      const withoutTrailing = trimmedPrefix.replace(/\/+$/, "");
      this.apiPrefix = withoutTrailing.startsWith("/")
        ? withoutTrailing
        : `/${withoutTrailing}`;
    }
    this.tokenPath = tokenPath;
    this.debugTokenPath = debugTokenPath;
  }

  /** Load bearer/debug tokens from disk (if configured). */
  async loadToken(): Promise<void> {
    if (this.tokenPath) {
      try {
        this.authToken = (await readFile(this.tokenPath, "utf8")).trim();
        log("info", "rustMuleClient", "Auth token loaded");
      } catch (err) {
        log("warn", "rustMuleClient", `Failed to load token: ${String(err)}`);
      }
    }

    if (this.debugTokenPath) {
      try {
        this.debugToken = (await readFile(this.debugTokenPath, "utf8")).trim();
        log("info", "rustMuleClient", "Debug token loaded");
      } catch (err) {
        log("warn", "rustMuleClient", `Failed to load debug token: ${String(err)}`);
      }
    }
  }

  private headers(options: RequestOptions = {}): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) h["Authorization"] = `Bearer ${this.authToken}`;
    if (options.debug && this.debugToken) {
      h["X-Debug-Token"] = this.debugToken;
    }
    return h;
  }

  private async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${this.apiPrefix}${path}`;
    const res = await fetch(url, { headers: this.headers(options) });
    if (!res.ok) {
      throw new HttpError("GET", url, res.status);
    }
    return res.json() as Promise<T>;
  }

  async getNodeInfo(): Promise<NodeInfo> {
    const status = await this.get<Record<string, unknown>>("/status");
    return {
      ...status,
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
    };
  }

  async getPeers(): Promise<Peer[]> {
    const payload = await this.get<{ peers?: Array<Record<string, unknown>> }>(
      "/kad/peers"
    );
    const peers = Array.isArray(payload.peers) ? payload.peers : [];
    return peers.map((p) => ({
      ...p,
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
    }));
  }

  async getRoutingBuckets(): Promise<RoutingBucket[]> {
    try {
      const payload = await this.get<{
        buckets?: Array<Record<string, unknown>>;
      }>("/debug/routing/buckets", { debug: true });
      const buckets = payload.buckets ?? [];
      return buckets.map((b) => {
        const count = typeof b["count"] === "number" ? b["count"] : 0;
        return {
          ...b,
          index: typeof b["index"] === "number" ? b["index"] : 0,
          count,
          size: count,
        };
      });
    } catch (err) {
      const unavailableDebugEndpoint =
        err instanceof HttpError &&
        (err.status === 403 || err.status === 404 || err.status === 501);
      if (!unavailableDebugEndpoint) {
        throw err;
      }
      log(
        "warn",
        "rustMuleClient",
        `Routing buckets unavailable (debug endpoint disabled or token rejected): ${String(err)}`
      );
      return [];
    }
  }

  async getLookupStats(): Promise<LookupStats> {
    const events = await this.get<Record<string, unknown>>("/events");

    const total =
      typeof events["sent_reqs_total"] === "number" ? events["sent_reqs_total"] : 0;
    const matched =
      typeof events["tracked_out_matched_total"] === "number"
        ? events["tracked_out_matched_total"]
        : 0;
    const hasMatchedField = typeof events["tracked_out_matched_total"] === "number";
    const timeouts =
      typeof events["timeouts_total"] === "number" ? events["timeouts_total"] : 0;
    const unmatched =
      typeof events["tracked_out_unmatched_total"] === "number"
        ? events["tracked_out_unmatched_total"]
        : 0;
    const expired =
      typeof events["tracked_out_expired_total"] === "number"
        ? events["tracked_out_expired_total"]
        : 0;
    const outboundShaperDelayedTotal =
      typeof events["outbound_shaper_delayed_total"] === "number"
        ? events["outbound_shaper_delayed_total"]
        : 0;

    const successful = hasMatchedField
      ? matched
      : typeof events["recv_ress_total"] === "number"
        ? events["recv_ress_total"]
        : 0;

    const failed = timeouts + unmatched + expired;

    return {
      ...events,
      total,
      successful,
      failed,
      avgDurationMs: 0,
      matchPerSent: total > 0 ? matched / total : 0,
      timeoutsPerSent: total > 0 ? timeouts / total : 0,
      outboundShaperDelayedTotal,
    };
  }
}

// Minimal structured logger shared across the module.
function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
