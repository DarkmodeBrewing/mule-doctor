/**
 * rustMuleClient.ts
 * HTTP client for the rust-mule control plane API.
 * Polls endpoints periodically and exposes typed response helpers.
 */

import { readFile } from "fs/promises";
import {
  clampInt,
  DEFAULT_HTTP_TIMEOUT_MS,
  HttpError,
  inferStatus,
  isAbortError,
  isRecoverableReadError,
  isTerminalDebugResult,
  log,
  normalizeDownloads,
  normalizeLookupStats,
  normalizeRoutingBuckets,
  normalizeSearchDetail,
  normalizeSearches,
  normalizeSharedActions,
  normalizeSharedFiles,
  normalizeStatus,
  normalizeTraceHops,
  readString,
  RequestTimeoutError,
  resolvePollOptions,
  sleep,
} from "./rustMuleClientShared.js";
import type {
  BootstrapJobResult,
  LookupStats,
  NodeInfo,
  Peer,
  PollOptions,
  RequestOptions,
  RoutingBucket,
  RustMuleDownloadsResponse,
  RustMuleKeywordSearchResponse,
  RustMuleReadiness,
  RustMuleSearchDetailResponse,
  RustMuleSearchesResponse,
  RustMuleSharedActionsResponse,
  RustMuleSharedFilesResponse,
  RustMuleStatus,
  TraceLookupResult,
} from "./rustMuleClientTypes.js";

export type {
  BootstrapJobResult,
  LookupStats,
  NodeInfo,
  Peer,
  RoutingBucket,
  RustMuleDownloadEntry,
  RustMuleDownloadsResponse,
  RustMuleKeywordHit,
  RustMuleKeywordSearchInfo,
  RustMuleKeywordSearchResponse,
  RustMuleReadiness,
  RustMuleSearchDetailResponse,
  RustMuleSearchesResponse,
  RustMuleSharedActionsResponse,
  RustMuleSharedActionStatus,
  RustMuleSharedFileEntry,
  RustMuleSharedFilesResponse,
  RustMuleStatus,
  TraceLookupHop,
  TraceLookupResult,
} from "./rustMuleClientTypes.js";

export class RustMuleClient {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly tokenPath: string | undefined;
  private readonly debugTokenPath: string | undefined;
  private readonly httpTimeoutMs: number;
  private authToken: string | undefined;
  private debugToken: string | undefined;

  constructor(
    baseUrl: string,
    tokenPath?: string,
    apiPrefix = "/api/v1",
    debugTokenPath?: string,
    httpTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    const trimmedPrefix = apiPrefix.trim();
    if (trimmedPrefix === "") {
      this.apiPrefix = "";
    } else {
      const withoutTrailing = trimmedPrefix.replace(/\/+$/, "");
      this.apiPrefix = withoutTrailing.startsWith("/") ? withoutTrailing : `/${withoutTrailing}`;
    }
    this.tokenPath = tokenPath;
    this.debugTokenPath = debugTokenPath;
    this.httpTimeoutMs = clampInt(httpTimeoutMs, DEFAULT_HTTP_TIMEOUT_MS, 100, 120_000);
  }

  /** Load bearer/debug tokens from disk (if configured). */
  async loadToken(): Promise<void> {
    if (this.tokenPath) {
      try {
        const token = (await readFile(this.tokenPath, "utf8")).trim();
        if (!token) {
          throw new Error("Auth token file is empty");
        }
        this.authToken = token;
        log("info", "rustMuleClient", "Auth token loaded");
      } catch (err) {
        throw new Error(`Failed to load auth token from ${this.tokenPath}: ${String(err)}`, {
          cause: err,
        });
      }
    }

    if (this.debugTokenPath) {
      try {
        const token = (await readFile(this.debugTokenPath, "utf8")).trim();
        if (!token) {
          throw new Error("Debug token file is empty");
        }
        this.debugToken = token;
        log("info", "rustMuleClient", "Debug token loaded");
      } catch (err) {
        throw new Error(`Failed to load debug token from ${this.debugTokenPath}: ${String(err)}`, {
          cause: err,
        });
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
    const res = await this.fetchWithTimeout("GET", url, { headers: this.headers(options) });
    if (!res.ok) {
      throw new HttpError("GET", url, res.status);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown> = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${this.apiPrefix}${path}`;
    const res = await this.fetchWithTimeout("POST", url, {
      method: "POST",
      headers: this.headers(options),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new HttpError("POST", url, res.status);
    }
    return res.json() as Promise<T>;
  }

  private async fetchWithTimeout(
    method: string,
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.httpTimeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (isAbortError(err)) {
        throw new RequestTimeoutError(method, url, this.httpTimeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getNodeInfo(): Promise<NodeInfo> {
    try {
      const status = await this.getStatus();
      return {
        ...status,
        nodeId: typeof status["node_id_hex"] === "string" ? status["node_id_hex"] : "unknown",
        version: typeof status["version"] === "string" ? status["version"] : "unknown",
        uptime: typeof status["uptime_secs"] === "number" ? status["uptime_secs"] : 0,
      };
    } catch (err) {
      if (!isRecoverableReadError(err)) {
        throw err;
      }
      log("warn", "rustMuleClient", `Node info unavailable, using fallback: ${String(err)}`);
      return {
        nodeId: "unknown",
        version: "unknown",
        uptime: 0,
      };
    }
  }

  async getStatus(): Promise<RustMuleStatus> {
    const status = await this.get<Record<string, unknown>>("/status");
    return normalizeStatus(status);
  }

  async getSearches(): Promise<RustMuleSearchesResponse> {
    const payload = await this.get<Record<string, unknown>>("/searches");
    return normalizeSearches(payload);
  }

  async getSearchDetail(searchId: string): Promise<RustMuleSearchDetailResponse> {
    const payload = await this.get<Record<string, unknown>>(
      `/searches/${encodeURIComponent(searchId)}`,
    );
    return normalizeSearchDetail(payload);
  }

  async getSharedFiles(): Promise<RustMuleSharedFilesResponse> {
    const payload = await this.get<Record<string, unknown>>("/shared");
    return normalizeSharedFiles(payload);
  }

  async getSharedActions(): Promise<RustMuleSharedActionsResponse> {
    const payload = await this.get<Record<string, unknown>>("/shared/actions");
    return normalizeSharedActions(payload);
  }

  async reindexShared(): Promise<RustMuleSharedActionsResponse> {
    return this.postSharedAction("/shared/actions/reindex");
  }

  async republishSources(): Promise<RustMuleSharedActionsResponse> {
    return this.postSharedAction("/shared/actions/republish_sources");
  }

  async republishKeywords(): Promise<RustMuleSharedActionsResponse> {
    return this.postSharedAction("/shared/actions/republish_keywords");
  }

  async getDownloads(): Promise<RustMuleDownloadsResponse> {
    const payload = await this.get<Record<string, unknown>>("/downloads");
    return normalizeDownloads(payload);
  }

  async startKeywordSearch(input: {
    query?: string;
    keywordIdHex?: string;
  }): Promise<RustMuleKeywordSearchResponse> {
    const query = input.query?.trim();
    const keywordIdHex = input.keywordIdHex?.trim();
    if (!query && !keywordIdHex) {
      throw new Error("startKeywordSearch requires query or keywordIdHex");
    }
    const payload: Record<string, unknown> = {};
    if (keywordIdHex) {
      payload["keyword_id_hex"] = keywordIdHex;
    } else if (query) {
      payload["query"] = query;
    }
    const response = await this.post<Record<string, unknown>>("/kad/search_keyword", payload);
    return {
      ...response,
      keyword_id_hex:
        typeof response["keyword_id_hex"] === "string" ? response["keyword_id_hex"] : undefined,
      search_id_hex:
        typeof response["search_id_hex"] === "string" ? response["search_id_hex"] : undefined,
    };
  }

  async getReadiness(): Promise<RustMuleReadiness> {
    const [status, searches] = await Promise.all([this.getStatus(), this.getSearches()]);
    const statusReady = status.ready === true;
    const searchesReady = searches.ready === true;
    return {
      statusReady,
      searchesReady,
      ready: statusReady && searchesReady,
      status,
      searches,
    };
  }

  async getPeers(): Promise<Peer[]> {
    try {
      const payload = await this.get<{ peers?: Array<Record<string, unknown>> }>("/kad/peers");
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
    } catch (err) {
      if (!isRecoverableReadError(err)) {
        throw err;
      }
      log("warn", "rustMuleClient", `Peer list unavailable, using fallback: ${String(err)}`);
      return [];
    }
  }

  async getRoutingBuckets(): Promise<RoutingBucket[]> {
    try {
      const payload = await this.get<{
        buckets?: Array<Record<string, unknown>>;
      }>("/debug/routing/buckets", { debug: true });
      return normalizeRoutingBuckets(payload);
    } catch (err) {
      const unavailableDebugEndpoint =
        err instanceof HttpError &&
        (err.status === 403 || err.status === 404 || err.status === 501);
      const recoverableTransient = isRecoverableReadError(err);
      if (err instanceof RequestTimeoutError) {
        log(
          "warn",
          "rustMuleClient",
          `Routing buckets unavailable (debug endpoint timeout): ${String(err)}`,
        );
        return [];
      }
      if (!unavailableDebugEndpoint && !recoverableTransient) {
        throw err;
      }
      log(
        "warn",
        "rustMuleClient",
        `Routing buckets unavailable (debug endpoint disabled/rejected/transient): ${String(err)}`,
      );
      return [];
    }
  }

  async getLookupStats(): Promise<LookupStats> {
    let events: Record<string, unknown>;
    try {
      events = await this.get<Record<string, unknown>>("/events");
    } catch (err) {
      if (!isRecoverableReadError(err)) {
        throw err;
      }
      log("warn", "rustMuleClient", `Lookup stats unavailable, using fallback: ${String(err)}`);
      events = {};
    }

    return normalizeLookupStats(events);
  }

  async triggerBootstrap(options: PollOptions = {}): Promise<BootstrapJobResult> {
    const started = await this.post<Record<string, unknown>>(
      "/debug/bootstrap/restart",
      {},
      { debug: true },
    );
    const jobId = readString(started, ["job_id", "jobId"]);
    if (!jobId) {
      throw new Error(`Bootstrap restart response missing job_id: ${JSON.stringify(started)}`);
    }

    const result = await this.pollDebugResult<Record<string, unknown>>(
      `/debug/bootstrap/jobs/${encodeURIComponent(jobId)}`,
      options,
    );

    return {
      ...result,
      jobId,
      status: inferStatus(result),
    };
  }

  async traceLookup(targetId?: string, options: PollOptions = {}): Promise<TraceLookupResult> {
    const body: Record<string, unknown> = {};
    if (typeof targetId === "string" && targetId.trim().length > 0) {
      body["target_id"] = targetId.trim();
    }

    const started = await this.post<Record<string, unknown>>("/debug/trace_lookup", body, {
      debug: true,
    });
    const traceId = readString(started, ["trace_id", "traceId"]);
    if (!traceId) {
      throw new Error(`Trace lookup response missing trace_id: ${JSON.stringify(started)}`);
    }

    const result = await this.pollDebugResult<Record<string, unknown>>(
      `/debug/trace_lookup/${encodeURIComponent(traceId)}`,
      options,
    );

    return {
      ...result,
      traceId,
      status: inferStatus(result),
      hops: normalizeTraceHops(result["hops"]),
    };
  }

  private async pollDebugResult<T extends Record<string, unknown>>(
    path: string,
    options: PollOptions = {},
  ): Promise<T> {
    const { pollIntervalMs, maxWaitMs } = resolvePollOptions(options);

    const deadline = Date.now() + maxWaitMs;
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

  private async postSharedAction(path: string): Promise<RustMuleSharedActionsResponse> {
    const payload = await this.post<Record<string, unknown>>(path, { confirm: true });
    return normalizeSharedActions(payload);
  }
}
