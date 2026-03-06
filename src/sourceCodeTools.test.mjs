import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SourceCodeTools } from "../dist/tools/sourceCodeTools.js";

async function makeTempSourceDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-source-tools-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("SourceCodeTools proposePatch stores artifact without mutating source file", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    const proposalDir = join(tmp.dir, "proposals");
    const filePath = join(tmp.dir, "src", "lib.rs");
    await writeFile(filePath, "pub fn stable() {}\n", "utf8");

    const tools = new SourceCodeTools({ sourcePath: tmp.dir, proposalDir });
    const proposal = await tools.proposePatch(
      "diff --git a/src/lib.rs b/src/lib.rs\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@\n-pub fn stable() {}\n+pub fn updated() {}\n"
    );

    const after = await readFile(filePath, "utf8");
    assert.equal(after, "pub fn stable() {}\n");
    assert.equal(proposal.applied, false);
    assert.equal(proposal.mode, "proposal_only");
    assert.equal(proposal.artifactPath.startsWith(`${proposalDir}/`), true);
    assert.equal(existsSync(proposal.artifactPath), true);
  } finally {
    await tmp.cleanup();
  }
});

test("SourceCodeTools gitBlame returns commit metadata for file+line", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    const fileRel = "src/lib.rs";
    const filePath = join(tmp.dir, fileRel);
    await writeFile(filePath, "pub fn stable() {}\n", "utf8");

    execFileSync("git", ["init"], { cwd: tmp.dir });
    execFileSync("git", ["config", "user.name", "Mule Doctor"], { cwd: tmp.dir });
    execFileSync("git", ["config", "user.email", "mule@example.com"], { cwd: tmp.dir });
    execFileSync("git", ["add", "."], { cwd: tmp.dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmp.dir });

    const tools = new SourceCodeTools({ sourcePath: tmp.dir });
    const blame = await tools.gitBlame(fileRel, 1);

    assert.equal(blame.path, fileRel);
    assert.equal(blame.line, 1);
    assert.equal(blame.author, "Mule Doctor");
    assert.equal(blame.authorEmail, "mule@example.com");
    assert.equal(blame.commit.length >= 7, true);
    assert.equal(blame.content.includes("pub fn stable"), true);
  } finally {
    await tmp.cleanup();
  }
});

test("SourceCodeTools readFile returns bounded content for large files", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    const filePath = join(tmp.dir, "src", "large.txt");
    await writeFile(filePath, "A".repeat(2048), "utf8");

    const tools = new SourceCodeTools({ sourcePath: tmp.dir, maxReadBytes: 128 });
    const result = await tools.readFile("src/large.txt");
    const fileStats = await stat(filePath);

    assert.equal(result.path, "src/large.txt");
    assert.equal(result.content.length, 128);
    assert.equal(result.truncated, true);
    assert.equal(result.sizeBytes, fileStats.size);
  } finally {
    await tmp.cleanup();
  }
});

test("SourceCodeTools showFunction matches Rust functions and ignores JS patterns", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    await writeFile(
      join(tmp.dir, "src", "lib.rs"),
      "pub(crate) async fn handshake() {}\nconst fn local_only() -> usize { 1 }\n",
      "utf8"
    );
    await writeFile(join(tmp.dir, "src", "helper.js"), "function handshake() {}\n", "utf8");

    const tools = new SourceCodeTools({ sourcePath: tmp.dir });
    const result = await tools.showFunction("handshake");

    assert.equal(result.totalMatches, 1);
    assert.equal(result.matches[0].path, "src/lib.rs");
    assert.equal(result.matches[0].signature.includes("fn handshake"), true);
  } finally {
    await tmp.cleanup();
  }
});

test("SourceCodeTools searchCode scans Rust-project text files", async () => {
  const tmp = await makeTempSourceDir();
  try {
    await mkdir(join(tmp.dir, "src"), { recursive: true });
    await writeFile(join(tmp.dir, "src", "lib.rs"), "let id = \"needle\";\n", "utf8");
    await writeFile(join(tmp.dir, "blob.json"), "{\"needle\": true}\n", "utf8");

    const tools = new SourceCodeTools({ sourcePath: tmp.dir });
    const result = await tools.searchCode("needle");

    assert.equal(result.totalMatches, 1);
    assert.equal(result.matches[0].path, "src/lib.rs");
  } finally {
    await tmp.cleanup();
  }
});
