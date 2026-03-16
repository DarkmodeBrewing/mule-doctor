#!/usr/bin/env bash
set -euo pipefail

RUST_MULE_API_URL="${RUST_MULE_API_URL:-http://127.0.0.1:17835}"
RUST_MULE_API_PREFIX="${RUST_MULE_API_PREFIX:-/api/v1}"
RUST_MULE_TOKEN_PATH="${RUST_MULE_TOKEN_PATH:-/data/token}"
MULE_DOCTOR_UI_ENABLED="${MULE_DOCTOR_UI_ENABLED:-false}"
MULE_DOCTOR_UI_HOST="${MULE_DOCTOR_UI_HOST:-127.0.0.1}"
MULE_DOCTOR_UI_PORT="${MULE_DOCTOR_UI_PORT:-18080}"
MULE_DOCTOR_UI_AUTH_TOKEN="${MULE_DOCTOR_UI_AUTH_TOKEN:-}"
MULE_DOCTOR_UI_HEALTHCHECK_HOST="${MULE_DOCTOR_UI_HEALTHCHECK_HOST:-}"
RUST_MULE_PID_FILE="${RUST_MULE_PID_FILE:-/tmp/rust-mule.pid}"
MULE_DOCTOR_PID_FILE="${MULE_DOCTOR_PID_FILE:-/tmp/mule-doctor.pid}"

check_pid() {
  local pid_file="$1"
  if [ ! -r "$pid_file" ]; then
    echo "missing pid file: $pid_file" >&2
    exit 1
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [ -z "$pid" ] || ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "managed process not running for pid file: $pid_file" >&2
    exit 1
  fi
}

check_pid "$RUST_MULE_PID_FILE"
check_pid "$MULE_DOCTOR_PID_FILE"

if [ ! -r "$RUST_MULE_TOKEN_PATH" ]; then
  echo "rust-mule token path is not readable: $RUST_MULE_TOKEN_PATH" >&2
  exit 1
fi

RUST_MULE_TOKEN="$(tr -d '\r\n' < "$RUST_MULE_TOKEN_PATH")"
if [ -z "$RUST_MULE_TOKEN" ]; then
  echo "rust-mule token file is empty: $RUST_MULE_TOKEN_PATH" >&2
  exit 1
fi

export RUST_MULE_API_URL
export RUST_MULE_API_PREFIX
export RUST_MULE_TOKEN
export MULE_DOCTOR_UI_ENABLED
export MULE_DOCTOR_UI_HOST
export MULE_DOCTOR_UI_PORT
export MULE_DOCTOR_UI_AUTH_TOKEN
export MULE_DOCTOR_UI_HEALTHCHECK_HOST

node <<'EOF'
const rustBase = process.env.RUST_MULE_API_URL.replace(/\/+$/, "");
const apiPrefix = process.env.RUST_MULE_API_PREFIX || "/api/v1";
const rustToken = process.env.RUST_MULE_TOKEN;
const uiEnabled = String(process.env.MULE_DOCTOR_UI_ENABLED || "").toLowerCase() === "true";
const uiHost = process.env.MULE_DOCTOR_UI_HOST || "127.0.0.1";
const uiHealthcheckHost = process.env.MULE_DOCTOR_UI_HEALTHCHECK_HOST || "";
const uiPort = process.env.MULE_DOCTOR_UI_PORT || "18080";
const uiAuthToken = process.env.MULE_DOCTOR_UI_AUTH_TOKEN || "";

function resolveUiProbeHost(host, overrideHost) {
  if (overrideHost) {
    return overrideHost;
  }
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }
  return host;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function main() {
  await fetchJson(`${rustBase}${apiPrefix}/health`, {
    Authorization: `Bearer ${rustToken}`,
  });
  const status = await fetchJson(`${rustBase}${apiPrefix}/status`, {
    Authorization: `Bearer ${rustToken}`,
  });
  const searches = await fetchJson(`${rustBase}${apiPrefix}/searches`, {
    Authorization: `Bearer ${rustToken}`,
  });
  if (status.ready !== true) {
    throw new Error("rust-mule status.ready is not true");
  }
  if (searches.ready !== true) {
    throw new Error("rust-mule searches.ready is not true");
  }

  if (uiEnabled) {
    if (!uiAuthToken) {
      throw new Error("MULE_DOCTOR_UI_ENABLED requires MULE_DOCTOR_UI_AUTH_TOKEN for healthcheck");
    }
    const doctor = await fetchJson(`http://${resolveUiProbeHost(uiHost, uiHealthcheckHost)}:${uiPort}/api/health`, {
      Authorization: `Bearer ${uiAuthToken}`,
    });
    if (doctor.ok !== true) {
      throw new Error("mule-doctor /api/health did not return ok=true");
    }
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
EOF
