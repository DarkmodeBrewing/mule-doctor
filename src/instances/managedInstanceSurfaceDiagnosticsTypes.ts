import type { SearchPublishDiagnosticsSummary } from "../diagnostics/rustMuleSurfaceSummaries.js";

export interface ManagedInstanceSurfaceDiagnosticsSummary {
  instanceId: string;
  observedAt: string;
  summary: SearchPublishDiagnosticsSummary;
  highlights: {
    searches: string[];
    sharedActions: string[];
    downloads: string[];
  };
}

export interface ManagedKeywordSearchThreadDetail {
  searchId: string;
  keywordIdHex?: string;
  label: string;
  state: string;
  ageSecs?: number;
  hits: number;
  wantSearch: boolean;
  publishEnabled: boolean;
  publishAcked: boolean;
}

export interface ManagedSharedFileDetail {
  fileName: string;
  fileIdHex?: string;
  sizeBytes?: number;
  localSourceCached: boolean;
  keywordPublishQueued: boolean;
  keywordPublishFailed: boolean;
  keywordPublishAckedCount: number;
  sourcePublishResponseReceived: boolean;
  queuedDownloads: number;
  inflightDownloads: number;
  queuedUploads: number;
  inflightUploads: number;
}

export interface ManagedSharedActionDetail {
  kind: string;
  state: string;
  fileName?: string;
  fileIdHex?: string;
  error?: string;
}

export interface ManagedDownloadDetail {
  fileName: string;
  fileHashMd4Hex?: string;
  state: string;
  progressPct?: number;
  sourceCount: number;
  lastError?: string;
}

export interface ManagedInstanceSurfaceDiagnosticsSnapshot
  extends ManagedInstanceSurfaceDiagnosticsSummary {
  detail: {
    searches: ManagedKeywordSearchThreadDetail[];
    sharedFiles: ManagedSharedFileDetail[];
    sharedActions: ManagedSharedActionDetail[];
    downloads: ManagedDownloadDetail[];
  };
}
