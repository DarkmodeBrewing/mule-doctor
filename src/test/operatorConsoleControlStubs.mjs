class StubDiagnosticTargetControl {
  constructor() {
    this.target = { kind: "external" };
  }

  async getActiveTarget() {
    return this.target;
  }

  async setActiveTarget(target) {
    if (target.kind === "managed_instance" && target.instanceId !== "a") {
      throw new Error(`Managed instance not found: ${target.instanceId}`);
    }
    this.target =
      target.kind === "managed_instance"
        ? { kind: "managed_instance", instanceId: target.instanceId }
        : { kind: "external" };
    return this.target;
  }
}

class StubObserverControl {
  constructor() {
    this.status = {
      started: true,
      cycleInFlight: false,
      intervalMs: 300000,
      currentCycleStartedAt: undefined,
      currentCycleTarget: undefined,
    };
  }

  getStatus() {
    return this.status;
  }

  triggerRunNow() {
    if (this.status.cycleInFlight) {
      return { accepted: false, reason: "observer cycle already in progress" };
    }
    this.status = {
      ...this.status,
      cycleInFlight: true,
      currentCycleStartedAt: "2026-03-08T02:10:00.000Z",
      currentCycleTarget: { kind: "external" },
    };
    return { accepted: true };
  }
}

class StubOperatorEvents {
  constructor() {
    this.events = [
      {
        timestamp: "2026-03-08T02:00:00.000Z",
        type: "diagnostic_target_changed",
        message: "Active diagnostic target changed to managed instance a",
        target: { kind: "managed_instance", instanceId: "a" },
        actor: "operator_console",
      },
    ];
  }

  async listRecent(limit = 20) {
    return this.events.slice(-limit);
  }

  async append(event) {
    this.events.push({
      timestamp: "2026-03-08T02:10:00.000Z",
      ...event,
    });
  }
}

class ThrowingOperatorEvents {
  async listRecent() {
    return [];
  }

  async append() {
    throw new Error("operator events unavailable");
  }
}

class StubManagedInstancePresets {
  constructor() {
    this.startedPrefixes = [];
    this.appliedPrefixes = new Set();
  }

  listPresets() {
    return [
      {
        id: "pair",
        name: "Pair",
        description: "Two managed instances",
        nodes: [{ suffix: "a" }, { suffix: "b" }],
      },
      {
        id: "trio",
        name: "Trio",
        description: "Three managed instances",
        nodes: [{ suffix: "a" }, { suffix: "b" }, { suffix: "c" }],
      },
    ];
  }

  async applyPreset(input) {
    if (input.presetId !== "pair" && input.presetId !== "trio") {
      throw new Error(`Managed instance preset not found: ${input.presetId}`);
    }
    if (!input.prefix) {
      throw new Error("Invalid managed instance preset prefix: ");
    }
    if (this.appliedPrefixes.has(input.prefix)) {
      throw new Error(`Managed instance preset prefix already exists: ${input.prefix}`);
    }
    this.appliedPrefixes.add(input.prefix);
    const ids =
      input.presetId === "pair"
        ? [`${input.prefix}-a`, `${input.prefix}-b`]
        : [`${input.prefix}-a`, `${input.prefix}-b`, `${input.prefix}-c`];
    return {
      presetId: input.presetId,
      prefix: input.prefix,
      instances: ids.map((id, index) => ({
        id,
        status: "planned",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19100 + index,
        preset: {
          presetId: input.presetId,
          prefix: input.prefix,
        },
        runtime: {
          rootDir: `/data/instances/${id}`,
          configPath: `/data/instances/${id}/config.toml`,
          tokenPath: `/data/instances/${id}/state/api.token`,
          debugTokenPath: `/data/instances/${id}/state/debug.token`,
          logDir: `/data/instances/${id}/state/logs`,
          logPath: `/data/instances/${id}/state/logs/rust-mule.log`,
          stateDir: `/data/instances/${id}/state`,
          sharedDir: `/data/instances/${id}/shared`,
          metadataPath: `/data/instances/${id}/instance.json`,
        },
      })),
    };
  }

  async startPreset(prefix) {
    if (!prefix) {
      throw new Error("Invalid managed instance preset prefix: ");
    }
    if (prefix !== "lab") {
      throw new Error(`Managed instance preset group not found: ${prefix}`);
    }
    this.startedPrefixes.push(prefix);
    return {
      presetId: "pair",
      prefix,
      action: "start",
      instances: ["lab-a", "lab-b"].map((id, index) => ({
        id,
        status: "running",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:10:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19100 + index,
        preset: {
          presetId: "pair",
          prefix,
        },
        currentProcess: {
          pid: 5001 + index,
          command: ["rust-mule"],
          cwd: `/data/instances/${id}`,
          startedAt: "2026-03-09T00:10:00.000Z",
        },
        runtime: {
          rootDir: `/data/instances/${id}`,
          configPath: `/data/instances/${id}/config.toml`,
          tokenPath: `/data/instances/${id}/state/api.token`,
          debugTokenPath: `/data/instances/${id}/state/debug.token`,
          logDir: `/data/instances/${id}/state/logs`,
          logPath: `/data/instances/${id}/state/logs/rust-mule.log`,
          stateDir: `/data/instances/${id}/state`,
          sharedDir: `/data/instances/${id}/shared`,
          metadataPath: `/data/instances/${id}/instance.json`,
        },
      })),
      failures: [],
    };
  }

  async stopPreset(prefix) {
    if (prefix !== "lab") {
      throw new Error(`Managed instance preset group not found: ${prefix}`);
    }
    return {
      presetId: "pair",
      prefix,
      action: "stop",
      instances: ["lab-a", "lab-b"].map((id, index) => ({
        id,
        status: "stopped",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:20:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19100 + index,
        preset: {
          presetId: "pair",
          prefix,
        },
        runtime: {
          rootDir: `/data/instances/${id}`,
          configPath: `/data/instances/${id}/config.toml`,
          tokenPath: `/data/instances/${id}/state/api.token`,
          debugTokenPath: `/data/instances/${id}/state/debug.token`,
          logDir: `/data/instances/${id}/state/logs`,
          logPath: `/data/instances/${id}/state/logs/rust-mule.log`,
          stateDir: `/data/instances/${id}/state`,
          sharedDir: `/data/instances/${id}/shared`,
          metadataPath: `/data/instances/${id}/instance.json`,
        },
      })),
      failures: [],
    };
  }

  async restartPreset(prefix) {
    if (prefix !== "lab") {
      throw new Error(`Managed instance preset group not found: ${prefix}`);
    }
    return {
      presetId: "pair",
      prefix,
      action: "restart",
      instances: ["lab-a", "lab-b"].map((id, index) => ({
        id,
        status: "running",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:30:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19100 + index,
        preset: {
          presetId: "pair",
          prefix,
        },
        currentProcess: {
          pid: 5101 + index,
          command: ["rust-mule"],
          cwd: `/data/instances/${id}`,
          startedAt: "2026-03-09T00:30:00.000Z",
        },
        runtime: {
          rootDir: `/data/instances/${id}`,
          configPath: `/data/instances/${id}/config.toml`,
          tokenPath: `/data/instances/${id}/state/api.token`,
          debugTokenPath: `/data/instances/${id}/state/debug.token`,
          logDir: `/data/instances/${id}/state/logs`,
          logPath: `/data/instances/${id}/state/logs/rust-mule.log`,
          stateDir: `/data/instances/${id}/state`,
          sharedDir: `/data/instances/${id}/shared`,
          metadataPath: `/data/instances/${id}/instance.json`,
        },
      })),
      failures: [],
    };
  }
}

export {
  StubDiagnosticTargetControl,
  StubManagedInstancePresets,
  StubObserverControl,
  StubOperatorEvents,
  ThrowingOperatorEvents,
};
