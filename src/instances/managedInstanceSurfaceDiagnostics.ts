import type { SearchPublishDiagnosticsSummary } from "../diagnostics/rustMuleSurfaceSummaries.js";
import { summarizeSearchPublishDiagnostics } from "../diagnostics/rustMuleSurfaceSummaries.js";
import type { SearchHealthLog } from "../searchHealth/searchHealthLog.js";
import { createSearchHealthRecordFromManagedObservation } from "../searchHealth/records.js";
import type {
  RustMuleSearchDetailResponse,
  RustMuleKeywordSearchInfo,
  RustMuleReadiness,
} from "../api/rustMuleClient.js";
import { ManagedInstanceDiagnosticsService } from "./managedInstanceDiagnostics.js";

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

export class ManagedInstanceSurfaceDiagnosticsService {
  private readonly diagnostics: ManagedInstanceDiagnosticsService;
  private readonly searchHealthLog: SearchHealthLog | undefined;
  private readonly lastObservedSearchSignatures = new Map<string, string>();

  constructor(
    diagnostics: ManagedInstanceDiagnosticsService,
    config: {
      searchHealthLog?: SearchHealthLog;
    } = {},
  ) {
    this.diagnostics = diagnostics;
    this.searchHealthLog = config.searchHealthLog;
  }

  async getSummary(instanceId: string): Promise<ManagedInstanceSurfaceDiagnosticsSummary> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    const [status, searches, shared, actions, downloads, peers] = await Promise.all([
      client.getStatus(),
      client.getSearches(),
      client.getSharedFiles(),
      client.getSharedActions(),
      client.getDownloads(),
      client.getPeers(),
    ]);
    const readiness: RustMuleReadiness = {
      statusReady: status.ready === true,
      searchesReady: searches.ready === true,
      ready: status.ready === true && searches.ready === true,
      status,
      searches,
    };
    await this.recordObservedSearchHealth(record.id, readiness, peers.length, client, searches.searches);
    return {
      instanceId: record.id,
      observedAt: new Date().toISOString(),
      summary: summarizeSearchPublishDiagnostics({
        searches,
        shared,
        actions,
        downloads,
      }),
      highlights: {
        searches: summarizeSearchHighlights(searches.searches),
        sharedActions: summarizeSharedActionHighlights(actions.actions),
        downloads: summarizeDownloadHighlights(downloads.downloads),
      },
    };
  }

  private async recordObservedSearchHealth(
    instanceId: string,
    readiness: RustMuleReadiness,
    peerCount: number,
    client: {
      getSearchDetail(searchId: string): Promise<RustMuleSearchDetailResponse>;
    },
    searches: RustMuleKeywordSearchInfo[],
  ): Promise<void> {
    if (!this.searchHealthLog || searches.length === 0) {
      return;
    }

    const recordedAt = new Date().toISOString();
    const details = await Promise.all(
      searches.map(async (search) => {
        const searchId = readString(search.search_id_hex);
        if (!searchId) {
          return undefined;
        }
        try {
          return await client.getSearchDetail(searchId);
        } catch {
          return undefined;
        }
      }),
    );

    for (let index = 0; index < searches.length; index += 1) {
      const search = searches[index];
      const record = createSearchHealthRecordFromManagedObservation({
        instanceId,
        readiness,
        peerCount,
        search,
        detail: details[index],
        recordedAt,
      });
      const signature = buildObservedSearchSignature(record);
      const key = `${instanceId}:${record.searchId}`;
      if (this.lastObservedSearchSignatures.get(key) === signature) {
        continue;
      }
      this.lastObservedSearchSignatures.set(key, signature);
      await this.searchHealthLog.append(record);
    }
  }
}

function summarizeSearchHighlights(searches: unknown[]): string[] {
  return searches
    .map((entry) => {
      const search = isRecord(entry) ? entry : {};
      const label = readString(search.keyword_label) ?? readString(search.search_id_hex) ?? "search";
      const state = readString(search.state) ?? "unknown";
      const hits = readNumber(search.hits);
      const tags = [
        typeof hits === "number" ? pluralize(hits, "hit") : undefined,
        search.publish_enabled === true ? "publish enabled" : undefined,
        search.got_publish_ack === true ? "publish acked" : undefined,
      ].filter((value): value is string => Boolean(value));
      return {
        active: isSearchActive(state) ? 0 : 1,
        text: `${label}: ${state}${tags.length ? ` (${tags.join(", ")})` : ""}`,
      };
    })
    .sort((left, right) => left.active - right.active || left.text.localeCompare(right.text))
    .slice(0, 3)
    .map((entry) => entry.text);
}

function summarizeSharedActionHighlights(actions: unknown[]): string[] {
  return actions
    .map((entry) => {
      const action = isRecord(entry) ? entry : {};
      const kind = readString(action.kind) ?? "unknown action";
      const state = readString(action.state) ?? "unknown";
      return {
        active: state === "running" ? 0 : 1,
        text: `${kind}: ${state}`,
      };
    })
    .sort((left, right) => left.active - right.active || left.text.localeCompare(right.text))
    .slice(0, 3)
    .map((entry) => entry.text);
}

function summarizeDownloadHighlights(downloads: unknown[]): string[] {
  return downloads
    .map((entry) => {
      const download = isRecord(entry) ? entry : {};
      const fileName = readString(download.file_name) ?? readString(download.file_hash_md4_hex) ?? "download";
      const state = readString(download.state) ?? "unknown";
      const progress = readNumber(download.progress_pct);
      const sources = readNumber(download.source_count);
      const lastError = readString(download.last_error);
      const tags = [
        typeof progress === "number" ? `${progress}%` : undefined,
        typeof sources === "number" ? pluralize(sources, "source") : undefined,
        lastError ? `error: ${lastError}` : undefined,
      ].filter((value): value is string => Boolean(value));
      return {
        priority: lastError ? 0 : isTerminalState(state) ? 2 : 1,
        text: `${fileName}: ${state}${tags.length ? ` (${tags.join(", ")})` : ""}`,
      };
    })
    .sort((left, right) => left.priority - right.priority || left.text.localeCompare(right.text))
    .slice(0, 3)
    .map((entry) => entry.text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isSearchActive(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized !== "completed" && normalized !== "complete" && normalized !== "done" && normalized !== "timed_out";
}

function isTerminalState(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized === "completed" || normalized === "complete" || normalized === "done" || normalized === "failed";
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function buildObservedSearchSignature(record: {
  finalState: string;
  resultCount: number;
  outcome: string;
  readinessAtDispatch: {
    searcher: {
      ready: boolean;
    };
  };
  transportAtDispatch: {
    searcher: {
      peerCount: number;
    };
  };
}): string {
  return JSON.stringify({
    finalState: record.finalState,
    resultCount: record.resultCount,
    outcome: record.outcome,
    ready: record.readinessAtDispatch.searcher.ready,
    peerCount: record.transportAtDispatch.searcher.peerCount,
  });
}
