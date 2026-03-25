import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-observer-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StubAnalyzer {
  async analyze() {
    return "ok";
  }

  async consumeDailyUsageReport() {
    return null;
  }
}

export class StubMattermost {
  async post() {
    return;
  }
}

export class StubClient {
  async getReadiness() {
    return {
      statusReady: true,
      searchesReady: true,
      ready: true,
      status: { ready: true },
      searches: { ready: true, searches: [] },
    };
  }

  async getNodeInfo() {
    return { nodeId: "n1", version: "v1", uptime: 123 };
  }

  async getPeers() {
    return [
      { id: "p1", address: "a" },
      { id: "p2", address: "b" },
    ];
  }

  async getRoutingBuckets() {
    return [
      { index: 0, count: 4, size: 4 },
      { index: 1, count: 4, size: 4 },
      { index: 2, count: 5, size: 5 },
    ];
  }

  async getLookupStats() {
    return {
      total: 10,
      successful: 9,
      failed: 1,
      matchPerSent: 0.9,
      timeoutsPerSent: 0.1,
      outboundShaperDelayedTotal: 0,
      avgHops: 6,
    };
  }

  async getSearchDetail(searchId) {
    return {
      search: {
        search_id_hex: searchId,
        keyword_label: "observer-search",
        state: "running",
      },
      hits: [],
    };
  }
}

export class StubLogWatcher {
  getOffset() {
    return 321;
  }

  getRecentLines() {
    return ["external log line"];
  }
}

export class SlowAnalyzer {
  constructor(delayMs = 35) {
    this.delayMs = delayMs;
    this.calls = 0;
  }

  async analyze() {
    this.calls += 1;
    await sleep(this.delayMs);
    return "ok";
  }

  async consumeDailyUsageReport() {
    return null;
  }
}

export class CountingMattermost {
  constructor() {
    this.periodicCalls = 0;
    this.lastPeriodicReport = null;
  }

  async postPeriodicReport(report) {
    this.periodicCalls += 1;
    this.lastPeriodicReport = report;
  }

  async postDailyUsageReport() {
    return;
  }
}

export class StubTargetResolver {
  constructor(target) {
    this.target = target;
  }

  async describeActiveTarget() {
    return {
      target: this.target.target,
      label: this.target.label,
    };
  }

  async resolve() {
    return this.target;
  }
}

export class FailingTargetResolver {
  async describeActiveTarget() {
    return {
      target: { kind: "managed_instance", instanceId: "missing" },
      label: "managed instance missing",
    };
  }

  async resolve() {
    throw new Error("Managed instance missing is stopped");
  }
}

export class NotReadyClient extends StubClient {
  async getReadiness() {
    return {
      statusReady: true,
      searchesReady: false,
      ready: false,
      status: { ready: true },
      searches: { ready: false, searches: [] },
    };
  }
}

export class CapturingAnalyzer {
  constructor() {
    this.calls = 0;
    this.prompts = [];
  }

  async analyze(prompt) {
    this.calls += 1;
    this.prompts.push(prompt);
    return "managed ok";
  }

  async consumeDailyUsageReport() {
    return null;
  }
}
