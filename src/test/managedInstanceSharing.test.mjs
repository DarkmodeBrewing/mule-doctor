import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ManagedInstanceSharingService } from "../../dist/instances/managedInstanceSharing.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-sharing-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("ManagedInstanceSharingService creates deterministic fixtures in the managed shared dir", async () => {
  const temp = await makeTempDir();
  const record = {
    id: "alpha",
    runtime: {
      sharedDir: temp.dir,
    },
  };
  const diagnostics = {
    async getInstanceRecord(id) {
      assert.equal(id, "alpha");
      return record;
    },
  };

  try {
    const service = new ManagedInstanceSharingService(diagnostics);
    const fixture = await service.ensureFixture("alpha", { fixtureId: "Search Probe" });
    const content = await readFile(fixture.absolutePath, "utf8");

    assert.equal(fixture.fixtureId, "search-probe");
    assert.equal(fixture.fileName, "mule-doctor-alpha-search-probe.txt");
    assert.match(content, /search_token=mule-doctor-alpha-search-probe/);
    assert.match(content, /instance_id=alpha/);
  } finally {
    await temp.cleanup();
  }
});

test("ManagedInstanceSharingService returns shared status from the managed rust-mule client", async () => {
  const record = {
    id: "alpha",
    runtime: {
      sharedDir: "/data/instances/alpha/shared",
    },
  };
  const calls = [];
  const client = {
    async loadToken() {
      calls.push("loadToken");
    },
    async getSharedFiles() {
      calls.push("getSharedFiles");
      return { files: [{ identity: { file_name: "fixture.txt" } }] };
    },
    async getSharedActions() {
      calls.push("getSharedActions");
      return { actions: [{ kind: "reindex", state: "idle" }] };
    },
    async getDownloads() {
      calls.push("getDownloads");
      return { downloads: [{ file_name: "fixture.txt", state: "queued" }] };
    },
  };
  const diagnostics = {
    async getInstanceRecord(id) {
      assert.equal(id, "alpha");
      return record;
    },
    getClientForInstance(instance) {
      assert.equal(instance, record);
      return client;
    },
  };

  const service = new ManagedInstanceSharingService(diagnostics);
  const overview = await service.getOverview("alpha");

  assert.deepEqual(calls, ["loadToken", "getSharedFiles", "getSharedActions", "getDownloads"]);
  assert.equal(overview.sharedDir, "/data/instances/alpha/shared");
  assert.equal(overview.files[0].identity.file_name, "fixture.txt");
  assert.equal(overview.actions[0].kind, "reindex");
  assert.equal(overview.downloads[0].state, "queued");
});
