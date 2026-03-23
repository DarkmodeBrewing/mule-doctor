import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const ENTRYPOINT_PATH = join(REPO_ROOT, "entrypoint.sh");
const HEALTHCHECK_PATH = join(REPO_ROOT, "scripts", "container-healthcheck.sh");
const REAL_NODE = process.execPath;
const REAL_MKDIR = execFileSync("bash", ["-lc", "command -v mkdir"], {
  encoding: "utf8",
}).trim();

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function writeExecutable(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, { encoding: "utf8", mode: 0o755 });
}

async function createFakeRuntime(rootDir) {
  const binDir = join(rootDir, "bin");
  const fetchShimPath = join(rootDir, "fetch-shim.cjs");
  await mkdir(binDir, { recursive: true });

  await writeFile(
    fetchShimPath,
    `const fs = require("node:fs");

function appendLog(entry) {
  const logPath = process.env.FAKE_FETCH_LOG;
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\\n");
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

global.fetch = async (url, options = {}) => {
  const headers = options.headers || {};
  appendLog({ url, headers });

  const rustToken = process.env.FAKE_EXPECTED_RUST_TOKEN || "";
  const uiToken = process.env.FAKE_EXPECTED_UI_TOKEN || "";
  const authHeader = headers.Authorization || headers.authorization || "";

  if (String(url).includes("/api/v1/")) {
    if (authHeader !== \`Bearer \${rustToken}\`) {
      return response(401, { ok: false });
    }
    if (String(url).endsWith("/health")) {
      return response(200, { ok: true });
    }
    if (String(url).endsWith("/status")) {
      return response(200, {
        ready: process.env.FAKE_RUST_STATUS_READY === "true",
        nodeId: "fake-node",
      });
    }
    if (String(url).endsWith("/searches")) {
      return response(200, {
        ready: process.env.FAKE_RUST_SEARCH_READY === "true",
      });
    }
  }

  if (String(url).includes("/api/health")) {
    if (authHeader !== \`Bearer \${uiToken}\`) {
      return response(401, { ok: false });
    }
    return response(200, {
      ok: process.env.FAKE_DOCTOR_OK === "true",
    });
  }

  return response(404, { ok: false });
};
`,
    "utf8",
  );

  await writeExecutable(
    join(binDir, "mkdir"),
    `#!/usr/bin/env bash
set -euo pipefail

args=()
for arg in "$@"; do
  case "$arg" in
    /data/logs)
      args+=("$FAKE_DATA_ROOT/logs")
      ;;
    /data/mule-doctor)
      args+=("$FAKE_DATA_ROOT/mule-doctor")
      ;;
    *)
      args+=("$arg")
      ;;
  esac
done

exec "${REAL_MKDIR}" "\${args[@]}"
`,
  );

  await writeExecutable(
    join(binDir, "node"),
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "/app/dist/index.js" ]]; then
  printf '%s\\n' "$*" >"$FAKE_MULE_DOCTOR_ARGS_LOG"
  : >"$FAKE_MULE_DOCTOR_STARTED"
  exit "\${FAKE_MULE_DOCTOR_EXIT_CODE:-0}"
fi

if [[ -n "\${FAKE_NODE_REQUIRE:-}" ]]; then
  if [[ -n "\${NODE_OPTIONS:-}" ]]; then
    export NODE_OPTIONS="--require $FAKE_NODE_REQUIRE $NODE_OPTIONS"
  else
    export NODE_OPTIONS="--require $FAKE_NODE_REQUIRE"
  fi
fi

exec "${REAL_NODE}" "$@"
`,
  );

  await writeExecutable(
    join(binDir, "rust-mule"),
    `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >"$FAKE_RUST_MULE_ARGS_LOG"

if [[ "\${FAKE_RUST_MULE_EXIT_BEFORE_TOKEN:-false}" == "true" ]]; then
  exit "\${FAKE_RUST_MULE_EXIT_CODE:-23}"
fi

if [[ "\${FAKE_RUST_MULE_WRITE_TOKEN:-false}" == "true" ]]; then
  mkdir -p "$(dirname "$RUST_MULE_TOKEN_PATH")"
  printf '%s\\n' "\${FAKE_RUST_MULE_TOKEN_CONTENT:-test-token}" >"$RUST_MULE_TOKEN_PATH"
fi

trap 'exit 0' TERM INT
while true; do
  sleep 1
done
`,
  );

  return {
    binDir,
    fetchShimPath,
  };
}

function startLongRunningProcess() {
  const child = spawn("sleep", ["30"], {
    stdio: "ignore",
  });
  return child;
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

test("entrypoint waits for token readiness and launches mule-doctor", async () => {
  const tmp = await makeTempDir("mule-doctor-runtime-entrypoint-");
  try {
    const { binDir } = await createFakeRuntime(tmp.dir);
    const dataRoot = join(tmp.dir, "mapped-data");
    const configPath = join(tmp.dir, "config.toml");
    const tokenPath = join(tmp.dir, "token");
    const logPath = join(tmp.dir, "logs", "rust-mule.log");
    const rustPidFile = join(tmp.dir, "rust-mule.pid");
    const doctorPidFile = join(tmp.dir, "mule-doctor.pid");
    const rustArgsLog = join(tmp.dir, "rust-args.log");
    const doctorArgsLog = join(tmp.dir, "doctor-args.log");
    const doctorStarted = join(tmp.dir, "doctor.started");

    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(configPath, "[general]\nlog_level = \"info\"\n", "utf8");

    const result = await execFileAsync("bash", [ENTRYPOINT_PATH], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_DATA_ROOT: dataRoot,
        FAKE_RUST_MULE_WRITE_TOKEN: "true",
        FAKE_RUST_MULE_ARGS_LOG: rustArgsLog,
        FAKE_MULE_DOCTOR_ARGS_LOG: doctorArgsLog,
        FAKE_MULE_DOCTOR_STARTED: doctorStarted,
        RUST_MULE_BIN: join(binDir, "rust-mule"),
        RUST_MULE_CONFIG: configPath,
        RUST_MULE_TOKEN_PATH: tokenPath,
        RUST_MULE_LOG_PATH: logPath,
        RUST_MULE_PID_FILE: rustPidFile,
        MULE_DOCTOR_PID_FILE: doctorPidFile,
        RUST_MULE_EXTRA_ARGS: "--debug-flag value",
        TOKEN_WAIT_TIMEOUT_SEC: "5",
      },
    });

    const rustInvocation = await readFile(rustArgsLog, "utf8");
    const doctorInvocation = await readFile(doctorArgsLog, "utf8");

    assert.match(result.stdout, /Starting rust-mule/);
    assert.match(result.stdout, /Waiting for API token/);
    assert.match(result.stdout, /Starting mule-doctor/);
    assert.match(result.stdout, /A managed process exited with status 0/);
    assert.match(rustInvocation, new RegExp(`--config ${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(rustInvocation, /--debug-flag value/);
    assert.equal(existsSync(doctorStarted), true);
    assert.match(doctorInvocation, /\/app\/dist\/index\.js/);
    assert.equal(existsSync(tokenPath), true);
    assert.equal(existsSync(logPath), true);
    assert.equal(existsSync(rustPidFile), false);
    assert.equal(existsSync(doctorPidFile), false);
  } finally {
    await tmp.cleanup();
  }
});

test("entrypoint fails fast when token readiness never arrives", async () => {
  const tmp = await makeTempDir("mule-doctor-runtime-entrypoint-timeout-");
  try {
    const { binDir } = await createFakeRuntime(tmp.dir);
    const dataRoot = join(tmp.dir, "mapped-data");
    const configPath = join(tmp.dir, "config.toml");
    const tokenPath = join(tmp.dir, "token");
    const logPath = join(tmp.dir, "logs", "rust-mule.log");
    const rustPidFile = join(tmp.dir, "rust-mule.pid");
    const doctorPidFile = join(tmp.dir, "mule-doctor.pid");
    const doctorStarted = join(tmp.dir, "doctor.started");

    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(configPath, "[general]\nlog_level = \"info\"\n", "utf8");

    await assert.rejects(
      execFileAsync("bash", [ENTRYPOINT_PATH], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          FAKE_DATA_ROOT: dataRoot,
          FAKE_MULE_DOCTOR_STARTED: doctorStarted,
          FAKE_RUST_MULE_ARGS_LOG: join(tmp.dir, "rust-args.log"),
          FAKE_MULE_DOCTOR_ARGS_LOG: join(tmp.dir, "doctor-args.log"),
          RUST_MULE_BIN: join(binDir, "rust-mule"),
          RUST_MULE_CONFIG: configPath,
          RUST_MULE_TOKEN_PATH: tokenPath,
          RUST_MULE_LOG_PATH: logPath,
          RUST_MULE_PID_FILE: rustPidFile,
          MULE_DOCTOR_PID_FILE: doctorPidFile,
          TOKEN_WAIT_TIMEOUT_SEC: "1",
        },
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Timed out waiting for readable non-empty token file/);
        return true;
      },
    );

    assert.equal(existsSync(doctorStarted), false);
    assert.equal(existsSync(rustPidFile), false);
    assert.equal(existsSync(doctorPidFile), false);
  } finally {
    await tmp.cleanup();
  }
});

test("container healthcheck succeeds for ready rust-mule and authenticated UI", async () => {
  const tmp = await makeTempDir("mule-doctor-runtime-healthcheck-");
  const rustProcess = startLongRunningProcess();
  const doctorProcess = startLongRunningProcess();
  try {
    const { binDir, fetchShimPath } = await createFakeRuntime(tmp.dir);
    const tokenPath = join(tmp.dir, "token");
    const rustPidFile = join(tmp.dir, "rust.pid");
    const doctorPidFile = join(tmp.dir, "doctor.pid");
    const fetchLog = join(tmp.dir, "fetch.log");

    await writeFile(tokenPath, "health-token\n", "utf8");
    await writeFile(rustPidFile, `${rustProcess.pid}\n`, "utf8");
    await writeFile(doctorPidFile, `${doctorProcess.pid}\n`, "utf8");

    await execFileAsync("bash", [HEALTHCHECK_PATH], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_NODE_REQUIRE: fetchShimPath,
        FAKE_FETCH_LOG: fetchLog,
        FAKE_EXPECTED_RUST_TOKEN: "health-token",
        FAKE_EXPECTED_UI_TOKEN: "ui-token",
        FAKE_RUST_STATUS_READY: "true",
        FAKE_RUST_SEARCH_READY: "true",
        FAKE_DOCTOR_OK: "true",
        RUST_MULE_TOKEN_PATH: tokenPath,
        RUST_MULE_PID_FILE: rustPidFile,
        MULE_DOCTOR_PID_FILE: doctorPidFile,
        MULE_DOCTOR_UI_ENABLED: "true",
        MULE_DOCTOR_UI_HOST: "0.0.0.0",
        MULE_DOCTOR_UI_HEALTHCHECK_HOST: "127.0.0.1",
        MULE_DOCTOR_UI_PORT: "18080",
        MULE_DOCTOR_UI_AUTH_TOKEN: "ui-token",
      },
    });

    const requests = (await readFile(fetchLog, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const urls = requests.map((request) => request.url);
    assert.equal(urls.includes("http://127.0.0.1:17835/api/v1/health"), true);
    assert.equal(urls.includes("http://127.0.0.1:17835/api/v1/status"), true);
    assert.equal(urls.includes("http://127.0.0.1:17835/api/v1/searches"), true);
    assert.equal(urls.includes("http://127.0.0.1:18080/api/health"), true);

    const uiHealthRequest = requests.find((request) => request.url === "http://127.0.0.1:18080/api/health");
    assert.ok(uiHealthRequest);
    assert.equal(uiHealthRequest.headers.Authorization, "Bearer ui-token");
  } finally {
    await stopProcess(rustProcess);
    await stopProcess(doctorProcess);
    await tmp.cleanup();
  }
});

test("container healthcheck fails when rust-mule searches are not ready", async () => {
  const tmp = await makeTempDir("mule-doctor-runtime-healthcheck-searches-");
  const rustProcess = startLongRunningProcess();
  const doctorProcess = startLongRunningProcess();
  try {
    const { binDir, fetchShimPath } = await createFakeRuntime(tmp.dir);
    const tokenPath = join(tmp.dir, "token");
    const rustPidFile = join(tmp.dir, "rust.pid");
    const doctorPidFile = join(tmp.dir, "doctor.pid");

    await writeFile(tokenPath, "health-token\n", "utf8");
    await writeFile(rustPidFile, `${rustProcess.pid}\n`, "utf8");
    await writeFile(doctorPidFile, `${doctorProcess.pid}\n`, "utf8");

    await assert.rejects(
      execFileAsync("bash", [HEALTHCHECK_PATH], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          FAKE_NODE_REQUIRE: fetchShimPath,
          FAKE_EXPECTED_RUST_TOKEN: "health-token",
          FAKE_RUST_STATUS_READY: "true",
          FAKE_RUST_SEARCH_READY: "false",
          RUST_MULE_TOKEN_PATH: tokenPath,
          RUST_MULE_PID_FILE: rustPidFile,
          MULE_DOCTOR_PID_FILE: doctorPidFile,
        },
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /rust-mule searches\.ready is not true/);
        return true;
      },
    );
  } finally {
    await stopProcess(rustProcess);
    await stopProcess(doctorProcess);
    await tmp.cleanup();
  }
});

test("container healthcheck requires a UI auth token when UI checks are enabled", async () => {
  const tmp = await makeTempDir("mule-doctor-runtime-healthcheck-ui-auth-");
  const rustProcess = startLongRunningProcess();
  const doctorProcess = startLongRunningProcess();
  try {
    const { binDir, fetchShimPath } = await createFakeRuntime(tmp.dir);
    const tokenPath = join(tmp.dir, "token");
    const rustPidFile = join(tmp.dir, "rust.pid");
    const doctorPidFile = join(tmp.dir, "doctor.pid");

    await writeFile(tokenPath, "health-token\n", "utf8");
    await writeFile(rustPidFile, `${rustProcess.pid}\n`, "utf8");
    await writeFile(doctorPidFile, `${doctorProcess.pid}\n`, "utf8");

    await assert.rejects(
      execFileAsync("bash", [HEALTHCHECK_PATH], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          FAKE_NODE_REQUIRE: fetchShimPath,
          FAKE_EXPECTED_RUST_TOKEN: "health-token",
          FAKE_RUST_STATUS_READY: "true",
          FAKE_RUST_SEARCH_READY: "true",
          RUST_MULE_TOKEN_PATH: tokenPath,
          RUST_MULE_PID_FILE: rustPidFile,
          MULE_DOCTOR_PID_FILE: doctorPidFile,
          MULE_DOCTOR_UI_ENABLED: "true",
        },
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(
          error.stderr,
          /MULE_DOCTOR_UI_ENABLED requires MULE_DOCTOR_UI_AUTH_TOKEN for healthcheck/,
        );
        return true;
      },
    );
  } finally {
    await stopProcess(rustProcess);
    await stopProcess(doctorProcess);
    await tmp.cleanup();
  }
});

test("container healthcheck requires both managed pid files to be live", async () => {
  const tmp = await makeTempDir("mule-doctor-runtime-healthcheck-pid-");
  const rustProcess = startLongRunningProcess();
  try {
    const { binDir, fetchShimPath } = await createFakeRuntime(tmp.dir);
    const tokenPath = join(tmp.dir, "token");
    const rustPidFile = join(tmp.dir, "rust.pid");
    const doctorPidFile = join(tmp.dir, "doctor.pid");

    await writeFile(tokenPath, "health-token\n", "utf8");
    await writeFile(rustPidFile, `${rustProcess.pid}\n`, "utf8");
    await writeFile(doctorPidFile, "999999\n", "utf8");

    await assert.rejects(
      execFileAsync("bash", [HEALTHCHECK_PATH], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          FAKE_NODE_REQUIRE: fetchShimPath,
          FAKE_EXPECTED_RUST_TOKEN: "health-token",
          FAKE_RUST_STATUS_READY: "true",
          FAKE_RUST_SEARCH_READY: "true",
          RUST_MULE_TOKEN_PATH: tokenPath,
          RUST_MULE_PID_FILE: rustPidFile,
          MULE_DOCTOR_PID_FILE: doctorPidFile,
        },
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /managed process not running for pid file/);
        return true;
      },
    );
  } finally {
    await stopProcess(rustProcess);
    await tmp.cleanup();
  }
});
