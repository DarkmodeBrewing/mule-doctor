import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = "/workspace/mule-doctor/scripts/smoke-compose.sh";

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

async function createFakeCommands(rootDir) {
  const binDir = join(rootDir, "bin");
  await mkdir(binDir, { recursive: true });

  await writeExecutable(
    join(binDir, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" != "compose" ]]; then
  echo "unsupported docker invocation: $*" >&2
  exit 1
fi
shift

env_file=""
compose_cmd=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      env_file="$2"
      shift 2
      ;;
    --project-name|-f)
      shift 2
      ;;
    up|down|logs|config|build)
      compose_cmd="$1"
      shift
      break
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "$env_file" ]]; then
  set -a
  . "$env_file"
  set +a
fi

case "$compose_cmd" in
  up)
    token_rel="\${RUST_MULE_TOKEN_PATH#/data/}"
    token_host_path="$SMOKE_DATA_DIR/\${token_rel}"
    mkdir -p "$(dirname "$token_host_path")" "$SMOKE_DATA_DIR/logs" "$SMOKE_DATA_DIR/mule-doctor"
    printf 'fake-token\\n' >"$token_host_path"
    printf 'log\\n' >"$SMOKE_DATA_DIR/logs/rust-mule.log"
    printf '{}\\n' >"$SMOKE_DATA_DIR/mule-doctor/state.json"
    printf '[]\\n' >"$SMOKE_DATA_DIR/mule-doctor/history.json"
    printf '[]\\n' >"$SMOKE_DATA_DIR/mule-doctor/operator-events.json"
    ;;
  logs)
    printf 'fake compose logs\\n'
    ;;
  down|config|build)
    ;;
  *)
    echo "unsupported compose command: $compose_cmd" >&2
    exit 1
    ;;
esac
`,
  );

  await writeExecutable(
    join(binDir, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail

header_file=""
cookie_file=""
write_out=""
output_file=""
url=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -D)
      header_file="$2"
      shift 2
      ;;
    -c)
      cookie_file="$2"
      shift 2
      ;;
    -w)
      write_out="$2"
      shift 2
      ;;
    -o)
      output_file="$2"
      shift 2
      ;;
    -H|-X|--data-urlencode|--connect-timeout|--max-time|--retry|-b)
      shift 2
      ;;
    -s|-S|-f|-sS|-fsS)
      shift
      ;;
    http://*|https://*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "$header_file" ]]; then
  printf 'HTTP/1.1 303 See Other\\r\\n' >"$header_file"
fi
if [[ -n "$cookie_file" ]]; then
  printf '# Netscape HTTP Cookie File\\n' >"$cookie_file"
fi
if [[ -n "$output_file" && "$output_file" != "/dev/null" ]]; then
  : >"$output_file"
fi

if [[ "$url" == *"/auth/login" ]]; then
  exit 0
fi

if [[ -n "$write_out" ]]; then
  printf '200'
  exit 0
fi

case "$url" in
  */api/v1/status)
    printf '{"ready":true,"nodeId":"fake-node"}'
    ;;
  */api/v1/searches)
    printf '{"ready":true}'
    ;;
  */api/health|*/api/v1/health)
    printf '{"ok":true}'
    ;;
  *)
    printf '{}'
    ;;
esac
`,
  );

  return binDir;
}

test("smoke-compose harness writes expected artifacts in a stubbed success run", async () => {
  const tmp = await makeTempDir("mule-doctor-smoke-harness-");
  try {
    const fakeBin = await createFakeCommands(tmp.dir);
    const workDir = join(tmp.dir, "work");

    await execFileAsync("bash", [SCRIPT_PATH], {
      cwd: "/workspace/mule-doctor",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        SMOKE_WORK_DIR: workDir,
        SMOKE_KEEP_WORK_DIR_ON_SUCCESS: "true",
      },
    });

    const envFile = await readFile(join(workDir, "smoke.env"), "utf8");
    const overrideFile = await readFile(join(workDir, "docker-compose.smoke.yml"), "utf8");
    const configFile = await readFile(join(workDir, "data", "config.toml"), "utf8");
    const logFile = await readFile(join(workDir, "smoke.log"), "utf8");

    assert.match(envFile, /OPENAI_API_KEY=smoke-test-key/);
    assert.match(envFile, /MATTERMOST_WEBHOOK_URL=http:\/\/127\.0\.0\.1:9\/webhook/);
    assert.match(envFile, /RUST_MULE_TOKEN_PATH=\/data\/api\.token/);
    assert.match(envFile, /MULE_DOCTOR_UI_ENABLED=true/);
    assert.match(overrideFile, /container_name: \$\{SMOKE_CONTAINER_NAME\}/);
    assert.match(overrideFile, /- "\$\{SMOKE_DATA_DIR\}:\/data"/);
    assert.match(configFile, /session_name = "mule-doctor-smoke"/);
    assert.match(configFile, /port = 17835/);
    assert.match(logFile, /Smoke validation completed successfully/);

    assert.equal(existsSync(join(workDir, "ui-cookies.txt")), true);
    assert.equal(existsSync(join(workDir, "ui-login.headers")), true);
    assert.equal(existsSync(join(workDir, "data", "logs", "rust-mule.log")), true);
    assert.equal(existsSync(join(workDir, "data", "mule-doctor", "state.json")), true);
    assert.equal(existsSync(join(workDir, "data", "mule-doctor", "history.json")), true);
    assert.equal(existsSync(join(workDir, "data", "mule-doctor", "operator-events.json")), true);
  } finally {
    await tmp.cleanup();
  }
});

test("smoke-compose harness preserves diagnostics for invalid token path overrides", async () => {
  const tmp = await makeTempDir("mule-doctor-smoke-harness-fail-");
  try {
    const fakeBin = await createFakeCommands(tmp.dir);
    const workDir = join(tmp.dir, "work");

    let failure = null;
    try {
      await execFileAsync("bash", [SCRIPT_PATH], {
        cwd: "/workspace/mule-doctor",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          SMOKE_WORK_DIR: workDir,
          SMOKE_RUST_MULE_TOKEN_PATH: "/tmp/outside-data.token",
        },
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 1);

    const logFile = await readFile(join(workDir, "smoke.log"), "utf8");
    const envFile = await readFile(join(workDir, "smoke.env"), "utf8");

    assert.match(logFile, /ERROR: smoke harness only supports token paths under \/data/);
    assert.match(logFile, /Smoke work directory retained at/);
    assert.match(envFile, /RUST_MULE_TOKEN_PATH=\/tmp\/outside-data\.token/);
    assert.equal(existsSync(join(workDir, "data", "config.toml")), true);
    assert.equal(existsSync(join(workDir, "docker-compose.smoke.yml")), true);
    if (existsSync(join(workDir, "compose.logs"))) {
      const composeLogs = await readFile(join(workDir, "compose.logs"), "utf8");
      assert.match(logFile, /Captured compose logs at/);
      assert.match(composeLogs, /fake compose logs/);
    }
  } finally {
    await tmp.cleanup();
  }
});
