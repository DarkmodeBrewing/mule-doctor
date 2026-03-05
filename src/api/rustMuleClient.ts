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

export interface BootstrapJobResult {
  jobId: string;
  status: string;
  [key: string]: unknown;
}

export interface TraceLookupHop {
  peerQueried: string;
  distance?: number;
  rttMs?: number;
  contactsReturned?: number;
  error?: string;
  [key: string]: unknown;
}

export interface TraceLookupResult {
  traceId: string;
  status: string;
  hops: TraceLookupHop[];
  [key: string]: unknown;
}

interface RequestOptions {
  debug?: boolean;
}

interface PollOptions {
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

class HttpError extends Error {
  readonly status: number;

  constructor(method: string, url: string, status: number) {
    super(`${method} ${url} failed with status ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_WAIT_MS = 15_000;

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

  private async post<T>(
    path: string,
    body: Record<string, unknown> = {},
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${this.apiPrefix}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(options),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new HttpError("POST", url, res.status);
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

  async triggerBootstrap(options: PollOptions = {}): Promise<BootstrapJobResult> {
    const started = await this.post<Record<string, unknown>>(
      "/debug/bootstrap/restart",
      {},
      { debug: true }
    );
    const jobId = readString(started, ["job_id", "jobId"]);
    if (!jobId) {
      throw new Error(`Bootstrap restart response missing job_id: ${JSON.stringify(started)}`);
    }

    const result = await this.pollDebugResult<Record<string, unknown>>(
      `/debug/bootstrap/jobs/${encodeURIComponent(jobId)}`,
      options
    );

    return {
      ...result,
      jobId,
      status: readString(result, ["status", "state"]) ?? inferStatus(result),
    };
  }

  async traceLookup(targetId?: string, options: PollOptions = {}): Promise<TraceLookupResult> {
    const body: Record<string, unknown> = {};
    if (typeof targetId === "string" && targetId.trim().length > 0) {
      body["target_id"] = targetId.trim();
    }

    const started = await this.post<Record<string, unknown>>(
      "/debug/trace_lookup",
      body,
      { debug: true }
    );
    const traceId = readString(started, ["trace_id", "traceId"]);
    if (!traceId) {
      throw new Error(`Trace lookup response missing trace_id: ${JSON.stringify(started)}`);
    }

    const result = await this.pollDebugResult<Record<string, unknown>>(
      `/debug/trace_lookup/${encodeURIComponent(traceId)}`,
      options
    );

    return {
      ...result,
      traceId,
      status: readString(result, ["status", "state"]) ?? inferStatus(result),
      hops: normalizeTraceHops(result["hops"]),
    };
  }

  private async pollDebugResult<T extends Record<string, unknown>>(
    path: string,
    options: PollOptions = {}
  ): Promise<T> {
    const pollIntervalMs = clampInt(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 10, 30_000);
    const maxWaitMs = clampInt(options.maxWaitMs, DEFAULT_MAX_WAIT_MS, 100, 300_000);

    const deadline = Date.now() + maxWaitMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.get<Record<string, unknown>>(path, { debug: true });
      if (isTerminalDebugResult(result)) {
        return result as T;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out polling ${path} after ${maxWaitMs}ms`);
      }
      await sleep(pollIntervalMs);
    }
  }
}

function normalizeTraceHops(raw: unknown): TraceLookupHop[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((hop) => {
    const payload = typeof hop === "object" && hop !== null ? (hop as Record<string, unknown>) : {};
    return {
      ...payload,
      peerQueried: readString(payload, ["peer_queried", "peerQueried", "peer", "node_id"]) ?? "unknown",
      distance: readNumber(payload, ["distance", "distance_to_target"]),
      rttMs: readNumber(payload, ["rtt_ms", "rttMs", "latency_ms"]),
      contactsReturned: readNumber(payload, ["contacts_returned", "contactsReturned"]),
      error: readString(payload, ["error", "err"]),
    };
  });
}

function isTerminalDebugResult(payload: Record<string, unknown>): boolean {
  const status = readString(payload, ["status", "state"]);
  if (status) {
    const normalized = status.toLowerCase();
    if (
      normalized === "completed" ||
      normalized === "succeeded" ||
      normalized === "failed" ||
      normalized === "error" ||
      normalized === "done"
    ) {
      return true;
    }
  }

  if (typeof payload["completed"] === "boolean") return payload["completed"];
  if (typeof payload["done"] === "boolean") return payload["done"];
  if (typeof payload["success"] === "boolean" && payload["success"] === true) return true;
  if (typeof payload["finished_at"] === "string") return true;
  return false;
}

function inferStatus(payload: Record<string, unknown>): string {
  return readString(payload, ["status", "state"]) ?? "completed";
}

function readString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function readNumber(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal structured logger shared across the module.
function log(level: string, module: string, msg: string): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n"
  );
}
