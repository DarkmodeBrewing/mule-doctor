import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ToolRegistry } from "../../dist/tools/toolRegistry.js";
import { StubClient, StubLogWatcher, makeTempSourceDir } from "./toolRegistryTestHelpers.mjs";

test("ToolRegistry enables source tools only when sourcePath is configured", async () => {
  const withoutSource = new ToolRegistry(new StubClient(), new StubLogWatcher());
  const withoutSourceNames = withoutSource
    .getDefinitions()
    .map((definition) => definition.function.name);
  assert.equal(withoutSourceNames.includes("search_code"), false);
  assert.equal(withoutSourceNames.includes("read_file"), false);

  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    await writeFile(join(tmp.dir, "src", "lib.rs"), "pub fn handshake() {}\n", "utf8");

    const withSource = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
    });
    const withSourceNames = withSource
      .getDefinitions()
      .map((definition) => definition.function.name);

    assert.equal(withSourceNames.includes("search_code"), true);
    assert.equal(withSourceNames.includes("read_file"), true);
    assert.equal(withSourceNames.includes("show_function"), true);
    assert.equal(withSourceNames.includes("propose_patch"), true);
    assert.equal(withSourceNames.includes("git_blame"), true);
  } finally {
    await tmp.cleanup();
  }
});

test("ToolRegistry source tools search, read, and show function return structured data", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    await writeFile(
      join(tmp.dir, "src", "lib.rs"),
      "pub fn handshake() {}\nfn internal_task() {}\n",
      "utf8",
    );

    const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
    });

    const search = await registry.invoke("search_code", { query: "handshake" });
    assert.equal(search.success, true);
    assert.equal(search.data.totalMatches >= 1, true);

    const read = await registry.invoke("read_file", { path: "src/lib.rs" });
    assert.equal(read.success, true);
    assert.equal(read.data.path, "src/lib.rs");
    assert.equal(read.data.content.includes("internal_task"), true);

    const showFn = await registry.invoke("show_function", { name: "handshake" });
    assert.equal(showFn.success, true);
    assert.equal(showFn.data.totalMatches >= 1, true);
  } finally {
    await tmp.cleanup();
  }
});

test("ToolRegistry source tools block path traversal", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    await writeFile(join(tmp.dir, "src", "lib.rs"), "pub fn ok() {}\n", "utf8");

    const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
    });
    const result = await registry.invoke("read_file", { path: "../etc/passwd" });

    assert.deepEqual(result, {
      tool: "read_file",
      success: false,
      error: "Error: Path escapes source root: ../etc/passwd",
    });
  } finally {
    await tmp.cleanup();
  }
});

test("ToolRegistry propose_patch triggers patch proposal notifier with diff content", async () => {
  const tmp = await makeTempSourceDir();
  try {
    const notices = [];
    const proposalDir = join(tmp.dir, "proposals");
    const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
      proposalDir,
      patchProposalNotifier: async (notice) => {
        notices.push(notice);
      },
    });
    const diff = "diff --git a/src/lib.rs b/src/lib.rs\n@@\n-pub fn old() {}\n+pub fn new() {}\n";

    const result = await registry.invoke("propose_patch", { diff });

    assert.equal(result.success, true);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].artifactPath.startsWith(`${proposalDir}/`), true);
    assert.equal(notices[0].diff, diff.trim());
    assert.equal(notices[0].bytes, result.data.bytes);
    assert.equal(notices[0].lines, result.data.lines);
  } finally {
    await tmp.cleanup();
  }
});

test("ToolRegistry propose_patch succeeds even when notifier fails", async () => {
  const tmp = await makeTempSourceDir();
  try {
    const proposalDir = join(tmp.dir, "proposals");
    const registry = new ToolRegistry(new StubClient(), new StubLogWatcher(), undefined, {
      sourcePath: tmp.dir,
      proposalDir,
      patchProposalNotifier: async () => {
        throw new Error("webhook down");
      },
    });

    const result = await registry.invoke("propose_patch", {
      diff: "diff --git a/src/lib.rs b/src/lib.rs\n@@\n-pub fn old() {}\n+pub fn new() {}\n",
    });

    assert.equal(result.success, true);
    assert.equal(result.data.applied, false);
    assert.equal(result.data.artifactPath.startsWith(`${proposalDir}/`), true);
  } finally {
    await tmp.cleanup();
  }
});
