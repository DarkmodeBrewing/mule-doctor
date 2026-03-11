#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${SMOKE_PROJECT_NAME:-mule-doctor-smoke}"
USER_SUPPLIED_WORK_DIR="${SMOKE_WORK_DIR:-}"
WORK_DIR="${USER_SUPPLIED_WORK_DIR:-$(mktemp -d "/tmp/${PROJECT_NAME}.XXXXXX")}"
DATA_DIR="$WORK_DIR/data"
ENV_FILE="$WORK_DIR/smoke.env"
OVERRIDE_FILE="$WORK_DIR/docker-compose.smoke.yml"
COOKIE_JAR="$WORK_DIR/ui-cookies.txt"
HEADER_FILE="$WORK_DIR/ui-login.headers"
LOG_FILE="$WORK_DIR/smoke.log"
WORK_DIR_MARKER="$WORK_DIR/.mule-doctor-smoke-owned"

RUST_MULE_PORT="${SMOKE_RUST_MULE_PORT:-17835}"
UI_PORT="${SMOKE_UI_PORT:-18080}"
UI_TOKEN="${SMOKE_UI_TOKEN:-smoke-ui-token}"
RUST_MULE_TOKEN_PATH_IN_CONTAINER="${SMOKE_RUST_MULE_TOKEN_PATH:-/data/api.token}"
OPENAI_API_KEY_VALUE="${OPENAI_API_KEY:-smoke-test-key}"
MATTERMOST_WEBHOOK_URL_VALUE="${MATTERMOST_WEBHOOK_URL:-http://127.0.0.1:9/webhook}"
KEEP_WORK_DIR_ON_SUCCESS="${SMOKE_KEEP_WORK_DIR_ON_SUCCESS:-false}"
KEEP_WORK_DIR_ON_FAILURE="${SMOKE_KEEP_WORK_DIR_ON_FAILURE:-true}"
TIMEOUT_SECS="${SMOKE_TIMEOUT_SECS:-120}"
POLL_SECS="${SMOKE_POLL_SECS:-2}"

readonly ROOT_DIR PROJECT_NAME WORK_DIR DATA_DIR ENV_FILE OVERRIDE_FILE COOKIE_JAR HEADER_FILE
readonly RUST_MULE_PORT UI_PORT UI_TOKEN RUST_MULE_TOKEN_PATH_IN_CONTAINER
readonly OPENAI_API_KEY_VALUE MATTERMOST_WEBHOOK_URL_VALUE
readonly KEEP_WORK_DIR_ON_SUCCESS KEEP_WORK_DIR_ON_FAILURE TIMEOUT_SECS POLL_SECS LOG_FILE
readonly USER_SUPPLIED_WORK_DIR WORK_DIR_MARKER

cleanup_mode="success"

log() {
  printf '[smoke] %s\n' "$*" | tee -a "$LOG_FILE"
}

fail() {
  cleanup_mode="failure"
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

compose() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$ROOT_DIR/docker-compose.yml" \
    -f "$OVERRIDE_FILE" \
    "$@"
}

cleanup() {
  local exit_code="$?"
  local can_delete_work_dir="false"

  if [[ -f "$ENV_FILE" && -f "$OVERRIDE_FILE" ]]; then
    log "Stopping smoke stack"
    compose down --remove-orphans >/dev/null 2>&1 || true
  fi

  if [[ -f "$WORK_DIR_MARKER" ]]; then
    can_delete_work_dir="true"
  fi

  if [[ "$cleanup_mode" == "failure" ]]; then
    log "Preserving smoke work directory: $WORK_DIR"
    if [[ -f "$ENV_FILE" && -f "$OVERRIDE_FILE" ]]; then
      compose logs --no-color >"$WORK_DIR/compose.logs" 2>&1 || true
      log "Captured compose logs at $WORK_DIR/compose.logs"
    fi
    if [[ "$KEEP_WORK_DIR_ON_FAILURE" != "true" && "$can_delete_work_dir" == "true" ]]; then
      rm -rf "$WORK_DIR"
    fi
  else
    if [[ "$KEEP_WORK_DIR_ON_SUCCESS" == "true" || "$can_delete_work_dir" != "true" ]]; then
      log "Smoke work directory retained at $WORK_DIR"
    else
      rm -rf "$WORK_DIR"
    fi
  fi

  exit "$exit_code"
}

trap cleanup EXIT

wait_for_http_ok() {
  local url="$1"
  local timeout="$2"
  local label="$3"
  local start now elapsed code
  start="$(date +%s)"
  while true; do
    now="$(date +%s)"
    elapsed="$((now - start))"
    if (( elapsed > timeout )); then
      fail "timed out waiting for $label at $url"
    fi
    code="$(
      curl -s --connect-timeout 5 --max-time 10 --retry 0 -o /dev/null -w '%{http_code}' "$url" ||
        true
    )"
    if [[ "$code" == "200" ]]; then
      log "$label ready at $url"
      return 0
    fi
    sleep "$POLL_SECS"
  done
}

wait_for_nonempty_file() {
  local path="$1"
  local timeout="$2"
  local label="$3"
  local start now elapsed
  start="$(date +%s)"
  while true; do
    now="$(date +%s)"
    elapsed="$((now - start))"
    if (( elapsed > timeout )); then
      fail "timed out waiting for $label at $path"
    fi
    if [[ -s "$path" ]]; then
      log "$label ready at $path"
      return 0
    fi
    sleep "$POLL_SECS"
  done
}

assert_file_exists() {
  local path="$1"
  [[ -f "$path" ]] || fail "expected file not found: $path"
  log "verified file: $path"
}

assert_dir_exists() {
  local path="$1"
  [[ -d "$path" ]] || fail "expected directory not found: $path"
  log "verified directory: $path"
}

assert_contains() {
  local text="$1"
  local pattern="$2"
  local label="$3"
  if ! grep -Eq "$pattern" <<<"$text"; then
    fail "expected $label to contain pattern: $pattern"
  fi
  log "verified $label contains: $pattern"
}

write_config() {
  cat >"$DATA_DIR/config.toml" <<EOF
[sam]
host = "127.0.0.1"
port = 7656
udp_port = 7655
session_name = "mule-doctor-smoke"
datagram_transport = "tcp"
forward_host = "127.0.0.1"
forward_port = 0
control_timeout_secs = 120

[kad]
bootstrap_nodes_path = "nodes.dat"
preferences_kad_path = "preferencesKad.dat"
service_runtime_secs = 0

[general]
log_level = "info"
data_dir = "/data"
log_to_file = true
log_file_name = "rust-mule.log"
log_file_level = "debug"
auto_open_ui = false

[api]
port = $RUST_MULE_PORT
enable_debug_endpoints = false
auth_mode = "local_ui"
rate_limit_enabled = true
rate_limit_window_secs = 60
rate_limit_auth_bootstrap_max_per_window = 30
rate_limit_session_max_per_window = 30
rate_limit_token_rotate_max_per_window = 10

[sharing]
share_roots = []
EOF
}

write_env_file() {
  cat >"$ENV_FILE" <<EOF
OPENAI_API_KEY=$OPENAI_API_KEY_VALUE
MATTERMOST_WEBHOOK_URL=$MATTERMOST_WEBHOOK_URL_VALUE
OPENAI_MODEL=gpt-5-mini
OBSERVE_INTERVAL_MS=3600000
RUST_MULE_API_URL=http://127.0.0.1:$RUST_MULE_PORT
RUST_MULE_API_PREFIX=/api/v1
RUST_MULE_LOG_PATH=/data/logs/rust-mule.log
RUST_MULE_TOKEN_PATH=$RUST_MULE_TOKEN_PATH_IN_CONTAINER
RUST_MULE_DEBUG_TOKEN_FILE=/data/debug.token
RUST_MULE_SOURCE_PATH=/opt/rust-mule
RUST_MULE_CONFIG=/data/config.toml
TOKEN_WAIT_TIMEOUT_SEC=60
MULE_DOCTOR_DATA_DIR=/data/mule-doctor
MULE_DOCTOR_STATE_PATH=/data/mule-doctor/state.json
MULE_DOCTOR_HISTORY_PATH=/data/mule-doctor/history.json
MULE_DOCTOR_HISTORY_LIMIT=500
MULE_DOCTOR_LLM_LOG_DIR=/data/mule-doctor
OPENAI_INPUT_COST_PER_1K=0
OPENAI_OUTPUT_COST_PER_1K=0
MULE_DOCTOR_UI_ENABLED=true
MULE_DOCTOR_UI_AUTH_TOKEN=$UI_TOKEN
MULE_DOCTOR_UI_HOST=0.0.0.0
MULE_DOCTOR_UI_PORT=$UI_PORT
MULE_DOCTOR_UI_LOG_BUFFER_LINES=2000
SMOKE_DATA_DIR=$DATA_DIR
SMOKE_RUST_MULE_PORT=$RUST_MULE_PORT
SMOKE_UI_PORT=$UI_PORT
SMOKE_CONTAINER_NAME=${PROJECT_NAME}-container
EOF
}

write_override_file() {
  cat >"$OVERRIDE_FILE" <<'EOF'
services:
  mule-doctor:
    container_name: ${SMOKE_CONTAINER_NAME}
    restart: "no"
    ports:
      - "${SMOKE_RUST_MULE_PORT}:${SMOKE_RUST_MULE_PORT}"
      - "${SMOKE_UI_PORT}:${SMOKE_UI_PORT}"
    volumes:
      - "${SMOKE_DATA_DIR}:/data"
EOF
}

login_operator_console() {
  local base_url="$1"
  rm -f "$COOKIE_JAR" "$HEADER_FILE"
  curl -sS \
    --connect-timeout 5 \
    --max-time 10 \
    -D "$HEADER_FILE" \
    -c "$COOKIE_JAR" \
    -o /dev/null \
    -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "token=$UI_TOKEN" \
    "$base_url/auth/login"
  grep -qi '^HTTP/.* 303' "$HEADER_FILE" || fail "operator console login did not return 303"
  [[ -s "$COOKIE_JAR" ]] || fail "operator console login did not produce a cookie jar"
  log "operator console login succeeded"
}

main() {
  require_cmd docker
  require_cmd curl
  require_cmd grep

  mkdir -p "$DATA_DIR/logs" "$DATA_DIR/mule-doctor"
  if [[ -z "$USER_SUPPLIED_WORK_DIR" ]]; then
    : >"$WORK_DIR_MARKER"
  fi
  : >"$LOG_FILE"
  write_config
  printf 'placeholder-debug-token\n' >"$DATA_DIR/debug.token"
  write_env_file
  write_override_file

  log "Building and starting smoke stack"
  compose up --build -d

  local rust_token_host_path
  rust_token_host_path="$(host_path_for_container_path "$RUST_MULE_TOKEN_PATH_IN_CONTAINER")"

  wait_for_nonempty_file "$rust_token_host_path" "$TIMEOUT_SECS" "rust-mule api token"
  wait_for_http_ok "http://127.0.0.1:$RUST_MULE_PORT/api/v1/health" "$TIMEOUT_SECS" "rust-mule health"

  local rust_token
  rust_token="$(tr -d '\r\n' <"$rust_token_host_path")"
  [[ -n "$rust_token" ]] || fail "rust-mule api token file is empty"
  local rust_status
  rust_status="$(
    curl -fsS \
      --connect-timeout 5 \
      --max-time 10 \
      -H "Authorization: Bearer $rust_token" \
      "http://127.0.0.1:$RUST_MULE_PORT/api/v1/status"
  )"
  assert_contains "$rust_status" '"nodeId"[[:space:]]*:' "rust-mule status payload"

  login_operator_console "http://127.0.0.1:$UI_PORT"
  local doctor_health
  doctor_health="$(
    curl -fsS \
      --connect-timeout 5 \
      --max-time 10 \
      -b "$COOKIE_JAR" \
      "http://127.0.0.1:$UI_PORT/api/health"
  )"
  assert_contains "$doctor_health" '"ok"[[:space:]]*:[[:space:]]*true' "mule-doctor health payload"

  assert_file_exists "$DATA_DIR/config.toml"
  assert_file_exists "$DATA_DIR/logs/rust-mule.log"
  assert_dir_exists "$DATA_DIR/mule-doctor"
  assert_file_exists "$DATA_DIR/mule-doctor/state.json"
  assert_file_exists "$DATA_DIR/mule-doctor/history.json"
  assert_file_exists "$DATA_DIR/mule-doctor/operator-events.json"

  log "Smoke validation completed successfully"
}

host_path_for_container_path() {
  local container_path="$1"
  if [[ "$container_path" != /data/* ]]; then
    fail "smoke harness only supports token paths under /data, got: $container_path"
  fi
  printf '%s\n' "$DATA_DIR/${container_path#/data/}"
}

main "$@"
