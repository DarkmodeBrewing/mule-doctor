import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OperatorConsoleServer } from "../dist/operatorConsole/server.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-console-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("OperatorConsoleServer serves health, logs, and proposal metadata", async () => {
  const tmp = await makeTempDir();
  try {
    const rustLogPath = join(tmp.dir, "rust-mule.log");
    const llmDir = join(tmp.dir, "llm");
    const proposalDir = join(tmp.dir, "proposals");
    await mkdir(llmDir, { recursive: true });
    await mkdir(proposalDir, { recursive: true });
    await writeFile(rustLogPath, "line1\nline2\n", "utf8");
    await writeFile(join(llmDir, "LLM_2026-03-08.log"), "token=secret\npayload=ok\n", "utf8");
    await writeFile(
      join(proposalDir, "proposal-2026-03-08.patch"),
      "diff --git a/src/a.rs b/src/a.rs\n",
      "utf8",
    );

    const server = new OperatorConsoleServer({
      host: "127.0.0.1",
      port: 0,
      rustMuleLogPath: rustLogPath,
      llmLogDir: llmDir,
      proposalDir,
      getAppLogs: () => ['{"msg":"api_key=topsecret"}'],
    });
    await server.start();

    const baseUrl = server.publicAddress();
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);

    const appRes = await fetch(`${baseUrl}/api/logs/app?lines=10`);
    assert.equal(appRes.status, 200);
    const appLogs = await appRes.json();
    assert.equal(appLogs.lines[0].includes("[redacted]"), true);

    const llmListRes = await fetch(`${baseUrl}/api/llm/logs`);
    assert.equal(llmListRes.status, 200);
    const llmList = await llmListRes.json();
    assert.equal(llmList.files.length, 1);
    assert.equal(llmList.files[0].name, "LLM_2026-03-08.log");

    const proposalListRes = await fetch(`${baseUrl}/api/proposals`);
    assert.equal(proposalListRes.status, 200);
    const proposals = await proposalListRes.json();
    assert.equal(proposals.files.length, 1);
    assert.equal(proposals.files[0].name, "proposal-2026-03-08.patch");

    const invalidPathRes = await fetch(`${baseUrl}/api/proposals/%2e%2e%2fsecret.txt`);
    assert.equal(invalidPathRes.status, 400);

    await server.stop();
  } finally {
    await tmp.cleanup();
  }
});
