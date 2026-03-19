import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateStartupReadiness } from "../../dist/startup/readiness.js";

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "mule-doctor-readiness-"));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function makeConfig(tmp, overrides = {}) {
  return {
    tokenPath: join(tmp.dir, "token"),
    debugTokenPath: undefined,
    logPath: join(tmp.dir, "logs", "rust-mule.log"),
    dataDir: join(tmp.dir, "mule-doctor"),
    statePath: undefined,
    historyPath: undefined,
    llmLogDir: join(tmp.dir, "mule-doctor", "llm"),
    proposalDir: join(tmp.dir, "mule-doctor", "proposals"),
    ...overrides,
  };
}

test("validateStartupReadiness accepts readable token files and creatable data directories", async () => {
  const tmp = await makeTempDir();
  try {
    await writeFile(join(tmp.dir, "token"), "secret\n", "utf8");
    await writeFile(join(tmp.dir, "debug.token"), "debug\n", "utf8");
    await mkdir(join(tmp.dir, "logs"), { recursive: true });

    await validateStartupReadiness(
      makeConfig(tmp, {
        debugTokenPath: join(tmp.dir, "debug.token"),
      }),
    );

    const llmDir = await stat(join(tmp.dir, "mule-doctor", "llm"));
    const proposalDir = await stat(join(tmp.dir, "mule-doctor", "proposals"));
    assert.equal(llmDir.isDirectory(), true);
    assert.equal(proposalDir.isDirectory(), true);
  } finally {
    await tmp.cleanup();
  }
});

test("validateStartupReadiness rejects missing token files", async () => {
  const tmp = await makeTempDir();
  try {
    await mkdir(join(tmp.dir, "logs"), { recursive: true });

    await assert.rejects(
      validateStartupReadiness(makeConfig(tmp)),
      /RUST_MULE_TOKEN_PATH is not readable/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("validateStartupReadiness rejects missing debug token files", async () => {
  const tmp = await makeTempDir();
  try {
    await writeFile(join(tmp.dir, "token"), "secret\n", "utf8");
    await mkdir(join(tmp.dir, "logs"), { recursive: true });

    await assert.rejects(
      validateStartupReadiness(
        makeConfig(tmp, {
          debugTokenPath: join(tmp.dir, "missing-debug.token"),
        }),
      ),
      /RUST_MULE_DEBUG_TOKEN_FILE is not readable/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("validateStartupReadiness rejects missing rust-mule log parent directory", async () => {
  const tmp = await makeTempDir();
  try {
    await writeFile(join(tmp.dir, "token"), "secret\n", "utf8");

    await assert.rejects(
      validateStartupReadiness(makeConfig(tmp)),
      /RUST_MULE_LOG_PATH parent is unavailable/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("validateStartupReadiness rejects invalid custom state path parents", async () => {
  const tmp = await makeTempDir();
  try {
    await writeFile(join(tmp.dir, "token"), "secret\n", "utf8");
    await mkdir(join(tmp.dir, "logs"), { recursive: true });
    await writeFile(join(tmp.dir, "not-a-dir"), "x\n", "utf8");

    await assert.rejects(
      validateStartupReadiness(
        makeConfig(tmp, {
          statePath: join(tmp.dir, "not-a-dir", "state.json"),
        }),
      ),
      /MULE_DOCTOR_STATE_PATH is not writable/,
    );
  } finally {
    await tmp.cleanup();
  }
});

test("validateStartupReadiness rejects existing read-only state files", async (t) => {
  const tmp = await makeTempDir();
  try {
    const statePath = join(tmp.dir, "mule-doctor", "state.json");
    await writeFile(join(tmp.dir, "token"), "secret\n", "utf8");
    await mkdir(join(tmp.dir, "logs"), { recursive: true });
    await mkdir(join(tmp.dir, "mule-doctor"), { recursive: true });
    await writeFile(statePath, "{}\n", "utf8");
    await chmod(statePath, 0o400);
    try {
      await access(statePath, constants.W_OK);
      t.skip("filesystem reports chmod 0400 files as writable in this environment");
      return;
    } catch {
      // expected on filesystems that honor chmod-based write denial
    }

    await assert.rejects(
      validateStartupReadiness(
        makeConfig(tmp, {
          statePath,
        }),
      ),
      /MULE_DOCTOR_STATE_PATH is not writable/,
    );
  } finally {
    await tmp.cleanup();
  }
});
