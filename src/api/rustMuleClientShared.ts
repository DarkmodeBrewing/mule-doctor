import type {
  BootstrapJobResult,
  LookupStats,
  PollOptions,
  RoutingBucket,
  RustMuleDownloadEntry,
  RustMuleDownloadsResponse,
  RustMuleKeywordHit,
  RustMuleKeywordSearchInfo,
  RustMuleSearchDetailResponse,
  RustMuleSearchesResponse,
  RustMuleSharedActionStatus,
  RustMuleSharedActionsResponse,
  RustMuleSharedFileEntry,
  RustMuleSharedFilesResponse,
  RustMuleStatus,
  TraceLookupHop,
  TraceLookupResult,
} from "./rustMuleClientTypes.js";

export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(method: string, url: string, timeoutMs: number) {
    super(`${method} ${url} timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class HttpError extends Error {
  readonly status: number;

  constructor(method: string, url: string, status: number) {
    super(`${method} ${url} failed with status ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export const DEFAULT_POLL_INTERVAL_MS = 500;
export const DEFAULT_MAX_WAIT_MS = 15_000;
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

export function normalizeStatus(status: Record<string, unknown>): RustMuleStatus {
  return {
    ...status,
    ready: status["ready"] === true,
  };
}

export function normalizeSearches(payload: Record<string, unknown>): RustMuleSearchesResponse {
  return {
    ...payload,
    ready: payload["ready"] === true,
    searches: Array.isArray(payload["searches"])
      ? (payload["searches"] as RustMuleKeywordSearchInfo[])
      : [],
  };
}

export function normalizeSearchDetail(
  payload: Record<string, unknown>,
): RustMuleSearchDetailResponse {
  const search =
    typeof payload["search"] === "object" &&
    payload["search"] !== null &&
    !Array.isArray(payload["search"])
      ? (payload["search"] as RustMuleKeywordSearchInfo)
      : {};
  return {
    ...payload,
    search,
    hits: Array.isArray(payload["hits"]) ? (payload["hits"] as RustMuleKeywordHit[]) : [],
  };
}

export function normalizeSharedFiles(
  payload: Record<string, unknown>,
): RustMuleSharedFilesResponse {
  return {
    ...payload,
    files: Array.isArray(payload["files"]) ? (payload["files"] as RustMuleSharedFileEntry[]) : [],
  };
}

export function normalizeSharedActions(
  payload: Record<string, unknown>,
): RustMuleSharedActionsResponse {
  return {
    ...payload,
    actions: Array.isArray(payload["actions"])
      ? (payload["actions"] as RustMuleSharedActionStatus[])
      : [],
  };
}

export function normalizeDownloads(
  payload: Record<string, unknown>,
): RustMuleDownloadsResponse {
  return {
    ...payload,
    downloads: Array.isArray(payload["downloads"])
      ? (payload["downloads"] as RustMuleDownloadEntry[])
      : [],
  };
}

export function normalizeRoutingBuckets(payload: {
  buckets?: Array<Record<string, unknown>>;
}): RoutingBucket[] {
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
}

export function normalizeLookupStats(events: Record<string, unknown>): LookupStats {
  const total = typeof events["sent_reqs_total"] === "number" ? events["sent_reqs_total"] : 0;
  const matched =
    typeof events["tracked_out_matched_total"] === "number"
      ? events["tracked_out_matched_total"]
      : 0;
  const hasMatchedField = typeof events["tracked_out_matched_total"] === "number";
  const timeouts = typeof events["timeouts_total"] === "number" ? events["timeouts_total"] : 0;
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

export function normalizeTraceHops(raw: unknown): TraceLookupHop[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((hop) => {
    const payload = typeof hop === "object" && hop !== null ? (hop as Record<string, unknown>) : {};
    return {
      ...payload,
      peerQueried:
        readString(payload, ["peer_queried", "peerQueried", "peer", "node_id"]) ?? "unknown",
      distance: readNumber(payload, ["distance", "distance_to_target"]),
      rttMs: readNumber(payload, ["rtt_ms", "rttMs", "latency_ms"]),
      contactsReturned: readNumber(payload, ["contacts_returned", "contactsReturned"]),
      error: readString(payload, ["error", "err"]),
    };
  });
}

export function normalizeBootstrapResult(
  result: Record<string, unknown>,
  jobId: string,
): BootstrapJobResult {
  return {
    ...result,
    jobId,
    status: inferStatus(result),
  };
}

export function normalizeTraceLookupResult(
  result: Record<string, unknown>,
  traceId: string,
): TraceLookupResult {
  return {
    ...result,
    traceId,
    status: inferStatus(result),
    hops: normalizeTraceHops(result["hops"]),
  };
}

export function isTerminalDebugResult(payload: Record<string, unknown>): boolean {
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

export function inferStatus(payload: Record<string, unknown>): string {
  return readString(payload, ["status", "state"]) ?? "completed";
}

export function readString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

export function readNumber(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    typeof err["name"] === "string" &&
    err["name"] === "AbortError"
  );
}

export function isRecoverableReadError(err: unknown): boolean {
  if (err instanceof RequestTimeoutError) {
    return true;
  }
  if (!(err instanceof HttpError)) {
    return false;
  }
  return (
    err.status === 404 ||
    err.status === 429 ||
    err.status === 500 ||
    err.status === 502 ||
    err.status === 503 ||
    err.status === 504
  );
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolvePollOptions(options: PollOptions = {}): Required<PollOptions> {
  return {
    pollIntervalMs: clampInt(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 10, 30_000),
    maxWaitMs: clampInt(options.maxWaitMs, DEFAULT_MAX_WAIT_MS, 100, 300_000),
  };
}

export function log(level: string, module: string, msg: string): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, module, msg }) + "\n");
}
