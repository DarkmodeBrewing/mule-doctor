#!/usr/bin/env bash
set -euo pipefail

RUST_MULE_BIN="${RUST_MULE_BIN:-/opt/rust-mule/target/release/rust-mule}"
RUST_MULE_CONFIG="${RUST_MULE_CONFIG:-/data/config.toml}"
RUST_MULE_TOKEN_PATH="${RUST_MULE_TOKEN_PATH-/data/token}"
RUST_MULE_LOG_PATH="${RUST_MULE_LOG_PATH:-/data/logs/rust-mule.log}"
RUST_MULE_EXTRA_ARGS="${RUST_MULE_EXTRA_ARGS:-}"
TOKEN_WAIT_TIMEOUT_SEC="${TOKEN_WAIT_TIMEOUT_SEC:-120}"
RUST_MULE_PID_FILE="${RUST_MULE_PID_FILE:-/tmp/rust-mule.pid}"
MULE_DOCTOR_PID_FILE="${MULE_DOCTOR_PID_FILE:-/tmp/mule-doctor.pid}"

mkdir -p /data/logs /data/mule-doctor
mkdir -p "$(dirname "$RUST_MULE_LOG_PATH")"
mkdir -p "$(dirname "$RUST_MULE_PID_FILE")"
mkdir -p "$(dirname "$MULE_DOCTOR_PID_FILE")"

if [ ! -x "$RUST_MULE_BIN" ]; then
  echo "rust-mule binary not found or not executable: $RUST_MULE_BIN" >&2
  exit 1
fi

if [ ! -f "$RUST_MULE_CONFIG" ]; then
  echo "rust-mule config file not found: $RUST_MULE_CONFIG" >&2
  exit 1
fi

if [ ! -r "$RUST_MULE_CONFIG" ]; then
  echo "rust-mule config file is not readable: $RUST_MULE_CONFIG" >&2
  exit 1
fi

echo "Starting rust-mule..."
if [ -n "$RUST_MULE_EXTRA_ARGS" ]; then
  # shellcheck disable=SC2206
  extra_args=($RUST_MULE_EXTRA_ARGS)
else
  extra_args=()
fi

"$RUST_MULE_BIN" \
  --config "$RUST_MULE_CONFIG" \
  "${extra_args[@]}" >>"$RUST_MULE_LOG_PATH" 2>&1 &
RUST_PID=$!
printf '%s\n' "$RUST_PID" >"$RUST_MULE_PID_FILE"

cleanup() {
  echo "Shutting down..."
  if kill -0 "$RUST_PID" >/dev/null 2>&1; then
    kill "$RUST_PID" >/dev/null 2>&1 || true
    wait "$RUST_PID" || true
  fi
  if [ "${DOCTOR_PID:-}" != "" ] && kill -0 "$DOCTOR_PID" >/dev/null 2>&1; then
    kill "$DOCTOR_PID" >/dev/null 2>&1 || true
    wait "$DOCTOR_PID" || true
  fi
  rm -f "$RUST_MULE_PID_FILE" "$MULE_DOCTOR_PID_FILE"
}

trap cleanup INT TERM EXIT

if [ -n "$RUST_MULE_TOKEN_PATH" ]; then
  echo "Waiting for API token at $RUST_MULE_TOKEN_PATH..."
  start_ts="$(date +%s)"
  while true; do
    if ! kill -0 "$RUST_PID" >/dev/null 2>&1; then
      echo "rust-mule exited before token file became available" >&2
      wait "$RUST_PID"
    fi

    if [ -r "$RUST_MULE_TOKEN_PATH" ] && [ -s "$RUST_MULE_TOKEN_PATH" ]; then
      break
    fi

    now_ts="$(date +%s)"
    elapsed="$((now_ts - start_ts))"
    if [ "$TOKEN_WAIT_TIMEOUT_SEC" -gt 0 ] && [ "$elapsed" -ge "$TOKEN_WAIT_TIMEOUT_SEC" ]; then
      echo "Timed out waiting for readable non-empty token file: $RUST_MULE_TOKEN_PATH" >&2
      exit 1
    fi
    sleep 1
  done
else
  echo "RUST_MULE_TOKEN_PATH must be set and non-empty" >&2
  exit 1
fi

export RUST_MULE_TOKEN_PATH

echo "Starting mule-doctor..."
node /app/dist/index.js &
DOCTOR_PID=$!
printf '%s\n' "$DOCTOR_PID" >"$MULE_DOCTOR_PID_FILE"

wait -n "$RUST_PID" "$DOCTOR_PID"
status=$?

echo "A managed process exited with status $status"
exit "$status"
