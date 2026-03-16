import type { SearchPublishDiagnosticsSummary } from "../diagnostics/rustMuleSurfaceSummaries.js";
import { summarizeSearchPublishDiagnostics } from "../diagnostics/rustMuleSurfaceSummaries.js";
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

  constructor(diagnostics: ManagedInstanceDiagnosticsService) {
    this.diagnostics = diagnostics;
  }

  async getSummary(instanceId: string): Promise<ManagedInstanceSurfaceDiagnosticsSummary> {
    const record = await this.diagnostics.getInstanceRecord(instanceId);
    const client = this.diagnostics.getClientForInstance(record);
    await client.loadToken();
    const [searches, shared, actions, downloads] = await Promise.all([
      client.getSearches(),
      client.getSharedFiles(),
      client.getSharedActions(),
      client.getDownloads(),
    ]);
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
}

function summarizeSearchHighlights(searches: unknown[]): string[] {
  return searches
    .map((entry) => {
      const search = isRecord(entry) ? entry : {};
      const label = readString(search.keyword_label) ?? readString(search.search_id_hex) ?? "search";
      const state = readString(search.state) ?? "unknown";
      const hits = readNumber(search.hits);
      const tags = [
        typeof hits === "number" ? `${hits} hits` : undefined,
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
        typeof sources === "number" ? `${sources} sources` : undefined,
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
