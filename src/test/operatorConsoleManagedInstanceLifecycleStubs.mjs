class StubManagedInstances {
  constructor() {
    this.instances = [
      {
        id: "a",
        status: "planned",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19000,
        preset: {
          presetId: "pair",
          prefix: "lab",
        },
        runtime: {
          rootDir: "/data/instances/a",
          configPath: "/data/instances/a/config.toml",
          tokenPath: "/data/instances/a/state/api.token",
          debugTokenPath: "/data/instances/a/state/debug.token",
          logDir: "/data/instances/a/state/logs",
          logPath: "/data/instances/a/state/logs/rust-mule.log",
          stateDir: "/data/instances/a/state",
          sharedDir: "/data/instances/a/shared",
          metadataPath: "/data/instances/a/instance.json",
        },
      },
      {
        id: "b",
        status: "running",
        createdAt: "2026-03-08T00:10:00.000Z",
        updatedAt: "2026-03-08T00:10:00.000Z",
        apiHost: "127.0.0.1",
        apiPort: 19001,
        preset: {
          presetId: "pair",
          prefix: "lab",
        },
        currentProcess: {
          pid: 2222,
          command: ["rust-mule"],
          cwd: "/data/instances/b",
          startedAt: "2026-03-08T00:12:00.000Z",
        },
        runtime: {
          rootDir: "/data/instances/b",
          configPath: "/data/instances/b/config.toml",
          tokenPath: "/data/instances/b/state/api.token",
          debugTokenPath: "/data/instances/b/state/debug.token",
          logDir: "/data/instances/b/state/logs",
          logPath: "/data/instances/b/state/logs/rust-mule.log",
          stateDir: "/data/instances/b/state",
          sharedDir: "/data/instances/b/shared",
          metadataPath: "/data/instances/b/instance.json",
        },
      },
    ];
  }

  async listInstances() {
    return this.instances;
  }

  async createPlannedInstance(input) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.id)) {
      throw new Error(`Invalid managed instance id: ${input.id}`);
    }
    if (this.instances.some((instance) => instance.id === input.id)) {
      throw new Error(`Managed instance already exists: ${input.id}`);
    }
    const instance = {
      ...this.instances[0],
      id: input.id,
      runtime: {
        ...this.instances[0].runtime,
        rootDir: `/data/instances/${input.id}`,
        configPath: `/data/instances/${input.id}/config.toml`,
        tokenPath: `/data/instances/${input.id}/state/api.token`,
        debugTokenPath: `/data/instances/${input.id}/state/debug.token`,
        logDir: `/data/instances/${input.id}/state/logs`,
        logPath: `/data/instances/${input.id}/state/logs/rust-mule.log`,
        stateDir: `/data/instances/${input.id}/state`,
        sharedDir: `/data/instances/${input.id}/shared`,
        metadataPath: `/data/instances/${input.id}/instance.json`,
      },
      apiPort: input.apiPort ?? 19001,
      status: "planned",
      updatedAt: "2026-03-08T01:00:00.000Z",
    };
    this.instances.push(instance);
    return instance;
  }

  async startInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "running";
    instance.updatedAt = "2026-03-08T01:10:00.000Z";
    return instance;
  }

  async stopInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "stopped";
    instance.updatedAt = "2026-03-08T01:20:00.000Z";
    return instance;
  }

  async restartInstance(id) {
    const instance = this.instances.find((candidate) => candidate.id === id);
    if (!instance) {
      throw new Error(`Managed instance not found: ${id}`);
    }
    instance.status = "running";
    instance.updatedAt = "2026-03-08T01:30:00.000Z";
    return instance;
  }
}

export { StubManagedInstances };
