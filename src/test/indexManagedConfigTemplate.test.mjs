import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

test("index rejects invalid managed rust-mule template JSON before startup readiness", async () => {
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RUST_MULE_API_URL: "http://127.0.0.1:17835",
      RUST_MULE_LOG_PATH: "/tmp/unused-rust-mule.log",
      OPENAI_API_KEY: "test-key",
      MATTERMOST_WEBHOOK_URL: "http://127.0.0.1:9999/webhook",
      RUST_MULE_TOKEN_PATH: "/tmp/unused-api.token",
      MULE_DOCTOR_MANAGED_RUST_MULE_CONFIG_TEMPLATE_JSON: "{",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });

  assert.equal(exitCode, 1);
  assert.match(stdout, /Invalid MULE_DOCTOR_MANAGED_RUST_MULE_CONFIG_TEMPLATE_JSON:/);
  assert.equal(stderr, "");
});
