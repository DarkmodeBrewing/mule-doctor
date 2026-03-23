import type {
  ManagedDiscoverabilityCheckResult,
  ManagedDiscoverabilityStateSample,
  ManagedSharedFixtureSnapshot,
} from "../types/contracts.js";
import type { SearchHealthLog } from "../searchHealth/searchHealthLog.js";
import { ManagedInstanceDiagnosticsService } from "./managedInstanceDiagnostics.js";
import { ManagedInstanceSharingService } from "./managedInstanceSharing.js";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface RunControlledDiscoverabilityCheckInput {
  publisherInstanceId: string;
  searcherInstanceId: string;
  fixtureId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class ManagedInstanceDiscoverabilityService {
  private readonly diagnostics: ManagedInstanceDiagnosticsService;
  private readonly sharing: ManagedInstanceSharingService;
  private readonly searchHealthLog: SearchHealthLog | undefined;

  constructor(
    diagnostics: ManagedInstanceDiagnosticsService,
    sharing: ManagedInstanceSharingService,
    searchHealthLog?: SearchHealthLog,
  ) {
    this.diagnostics = diagnostics;
    this.sharing = sharing;
    this.searchHealthLog = searchHealthLog;
  }

  async runControlledCheck(
    input: RunControlledDiscoverabilityCheckInput,
  ): Promise<ManagedDiscoverabilityCheckResult> {
    const timeoutMs = clampInt(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 15 * 60_000);
    const pollIntervalMs = clampInt(
      input.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      100,
      30_000,
    );
    const publisherRecord = await this.diagnostics.getInstanceRecord(input.publisherInstanceId);
    const searcherRecord = await this.diagnostics.getInstanceRecord(input.searcherInstanceId);
    const publisherClient = this.diagnostics.getClientForInstance(publisherRecord);
    const searcherClient = this.diagnostics.getClientForInstance(searcherRecord);
    await Promise.all([publisherClient.loadToken(), searcherClient.loadToken()]);

    const [publisherReadiness, searcherReadiness] = await Promise.all([
      publisherClient.getReadiness(),
      searcherClient.getReadiness(),
    ]);
    if (!publisherReadiness.ready) {
      throw new Error(
        `publisher instance ${publisherRecord.id} is not ready for discoverability checks`,
      );
    }
    if (!searcherReadiness.ready) {
      throw new Error(
        `searcher instance ${searcherRecord.id} is not ready for discoverability checks`,
      );
    }

    const [publisherPeers, searcherPeers] = await Promise.all([
      publisherClient.getPeers(),
      searcherClient.getPeers(),
    ]);

    const fixture = await this.sharing.ensureFixture(publisherRecord.id, {
      fixtureId: input.fixtureId,
    });
    const publisherSharedBefore = await captureFixtureSnapshot(
      this.sharing,
      publisherRecord.id,
      fixture.fileName,
    );
    await this.sharing.triggerReindex(publisherRecord.id);
    await this.sharing.triggerRepublishSources(publisherRecord.id);
    await this.sharing.triggerRepublishKeywords(publisherRecord.id);
    const publisherSharedAfter = await captureFixtureSnapshot(
      this.sharing,
      publisherRecord.id,
      fixture.fileName,
    );

    const dispatch = await searcherClient.startKeywordSearch({ query: fixture.token });
    const searchId = dispatch.search_id_hex ?? dispatch.keyword_id_hex;
    if (!searchId) {
      throw new Error(`search dispatch did not return a search identifier: ${JSON.stringify(dispatch)}`);
    }

    const dispatchedAt = new Date().toISOString();
    await this.searchHealthLog?.appendControlledDiscoverabilityDispatch({
      publisherInstanceId: publisherRecord.id,
      searcherInstanceId: searcherRecord.id,
      fixture,
      query: fixture.token,
      dispatch,
      publisherReadiness,
      searcherReadiness,
      publisherPeerCount: publisherPeers.length,
      searcherPeerCount: searcherPeers.length,
      dispatchedAt,
    });
    const deadline = Date.now() + timeoutMs;
    const states: ManagedDiscoverabilityStateSample[] = [];

    while (true) {
      const detail = await searcherClient.getSearchDetail(searchId);
      const state = typeof detail.search.state === "string" ? detail.search.state : "unknown";
      const hits = detail.hits.length;
      pushState(states, {
        observedAt: new Date().toISOString(),
        state,
        hits,
      });
      if (hits > 0) {
        return {
          publisherInstanceId: publisherRecord.id,
          searcherInstanceId: searcherRecord.id,
          fixture,
          query: fixture.token,
          dispatchedAt,
          searchId,
          readinessAtDispatch: {
            publisherStatusReady: publisherReadiness.statusReady,
            publisherSearchesReady: publisherReadiness.searchesReady,
            publisherReady: publisherReadiness.ready,
            searcherStatusReady: searcherReadiness.statusReady,
            searcherSearchesReady: searcherReadiness.searchesReady,
            searcherReady: searcherReadiness.ready,
          },
          peerCountAtDispatch: {
            publisher: publisherPeers.length,
            searcher: searcherPeers.length,
          },
          publisherSharedBefore,
          publisherSharedAfter,
          states,
          resultCount: hits,
          outcome: "found",
          finalState: state,
        };
      }
      if (isTerminalSearchState(state)) {
        return {
          publisherInstanceId: publisherRecord.id,
          searcherInstanceId: searcherRecord.id,
          fixture,
          query: fixture.token,
          dispatchedAt,
          searchId,
          readinessAtDispatch: {
            publisherStatusReady: publisherReadiness.statusReady,
            publisherSearchesReady: publisherReadiness.searchesReady,
            publisherReady: publisherReadiness.ready,
            searcherStatusReady: searcherReadiness.statusReady,
            searcherSearchesReady: searcherReadiness.searchesReady,
            searcherReady: searcherReadiness.ready,
          },
          peerCountAtDispatch: {
            publisher: publisherPeers.length,
            searcher: searcherPeers.length,
          },
          publisherSharedBefore,
          publisherSharedAfter,
          states,
          resultCount: hits,
          outcome: "completed_empty",
          finalState: state,
        };
      }
      if (Date.now() >= deadline) {
        return {
          publisherInstanceId: publisherRecord.id,
          searcherInstanceId: searcherRecord.id,
          fixture,
          query: fixture.token,
          dispatchedAt,
          searchId,
          readinessAtDispatch: {
            publisherStatusReady: publisherReadiness.statusReady,
            publisherSearchesReady: publisherReadiness.searchesReady,
            publisherReady: publisherReadiness.ready,
            searcherStatusReady: searcherReadiness.statusReady,
            searcherSearchesReady: searcherReadiness.searchesReady,
            searcherReady: searcherReadiness.ready,
          },
          peerCountAtDispatch: {
            publisher: publisherPeers.length,
            searcher: searcherPeers.length,
          },
          publisherSharedBefore,
          publisherSharedAfter,
          states,
          resultCount: hits,
          outcome: "timed_out",
          finalState: state,
        };
      }
      await sleep(pollIntervalMs);
    }
  }
}

function isTerminalSearchState(state: string): boolean {
  const normalized = state.toLowerCase();
  return normalized === "completed" || normalized === "complete" || normalized === "done";
}

function pushState(
  states: ManagedDiscoverabilityStateSample[],
  sample: ManagedDiscoverabilityStateSample,
): void {
  const last = states.at(-1);
  if (last && last.state === sample.state && last.hits === sample.hits) {
    return;
  }
  states.push(sample);
}

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureFixtureSnapshot(
  sharing: ManagedInstanceSharingService,
  instanceId: string,
  fileName: string,
): Promise<ManagedSharedFixtureSnapshot> {
  const overview = await sharing.getOverview(instanceId);
  const file = overview.files.find((entry) => {
    const identity =
      typeof entry["identity"] === "object" && entry["identity"] !== null
        ? (entry["identity"] as Record<string, unknown>)
        : undefined;
    return identity?.["file_name"] === fileName;
  });
  return {
    file,
    actions: overview.actions,
    downloads: overview.downloads,
  };
}
