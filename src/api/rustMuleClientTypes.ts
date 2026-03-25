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

export interface RustMuleStatus {
  ready: boolean;
  [key: string]: unknown;
}

export interface RustMuleKeywordSearchInfo {
  search_id_hex?: string;
  keyword_id_hex?: string;
  keyword_label?: string;
  state?: string;
  created_secs_ago?: number;
  hits?: number;
  want_search?: boolean;
  publish_enabled?: boolean;
  got_publish_ack?: boolean;
  [key: string]: unknown;
}

export interface RustMuleSearchesResponse {
  ready: boolean;
  searches: RustMuleKeywordSearchInfo[];
  [key: string]: unknown;
}

export interface RustMuleKeywordHit {
  file_id_hex?: string;
  filename?: string;
  file_size?: number;
  file_type?: string;
  publish_info?: Record<string, unknown>;
  origin?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RustMuleSearchDetailResponse {
  search: RustMuleKeywordSearchInfo;
  hits: RustMuleKeywordHit[];
  [key: string]: unknown;
}

export interface RustMuleKeywordSearchResponse {
  keyword_id_hex?: string;
  search_id_hex?: string;
  [key: string]: unknown;
}

export interface RustMuleSharedFileEntry {
  identity?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RustMuleSharedFilesResponse {
  files: RustMuleSharedFileEntry[];
  [key: string]: unknown;
}

export interface RustMuleSharedActionStatus {
  [key: string]: unknown;
}

export interface RustMuleSharedActionsResponse {
  actions: RustMuleSharedActionStatus[];
  [key: string]: unknown;
}

export interface RustMuleDownloadEntry {
  [key: string]: unknown;
}

export interface RustMuleDownloadsResponse {
  downloads: RustMuleDownloadEntry[];
  [key: string]: unknown;
}

export interface RustMuleReadiness {
  statusReady: boolean;
  searchesReady: boolean;
  ready: boolean;
  status: RustMuleStatus;
  searches: RustMuleSearchesResponse;
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

export interface PollOptions {
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

export interface RequestOptions {
  debug?: boolean;
}
