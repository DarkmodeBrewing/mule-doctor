# mule-doctor

Observability and diagnostic agent for `rust-mule` nodes.

## What it does

- polls the rust-mule API (`/api/v1`)
- tails rust-mule logs
- runs an LLM diagnostic loop with tool-calling
- posts periodic reports to Mattermost via incoming webhook

## Configuration

Copy `.env.example` and set values in your shell or runtime environment.

Required:

- `RUST_MULE_API_URL` (example: `http://127.0.0.1:17835`)
- `RUST_MULE_LOG_PATH` (example: `/home/coder/mule-a/data/logs/rust-mule.log`)
- `RUST_MULE_TOKEN_PATH` (API bearer token file path)
- `OPENAI_API_KEY`
- `MATTERMOST_WEBHOOK_URL`

Optional:

- `RUST_MULE_DEBUG_TOKEN_FILE` (debug token file path; required by rust-mule debug endpoints via `X-Debug-Token`)
- `RUST_MULE_SOURCE_PATH` (enables Rust-project source inspection tools scoped to this repository path)
- `RUST_MULE_API_PREFIX` (defaults to `/api/v1`)
- `OBSERVE_INTERVAL_MS` (defaults to `300000`, 5 minutes)
- `OPENAI_MODEL` (defaults to `gpt-5-mini`)
- `MULE_DOCTOR_DATA_DIR` (defaults to `/data/mule-doctor`)
- `MULE_DOCTOR_STATE_PATH` (defaults to `/data/mule-doctor/state.json`)
- `MULE_DOCTOR_HISTORY_PATH` (defaults to `/data/mule-doctor/history.json`)
- `MULE_DOCTOR_HISTORY_LIMIT` (defaults to `500`)
- `MULE_DOCTOR_LLM_LOG_DIR` (defaults to `MULE_DOCTOR_DATA_DIR`, stores `LLM_<timestamp>.log`)
- `MULE_DOCTOR_UI_ENABLED` (defaults to `false`; enables built-in operator console when `true`)
- `MULE_DOCTOR_UI_AUTH_TOKEN` (required when `MULE_DOCTOR_UI_ENABLED=true`; protects the operator console UI and `/api/*` routes)
- `MULE_DOCTOR_UI_HOST` (defaults to `127.0.0.1`; use `0.0.0.0` in container for host access)
- `MULE_DOCTOR_UI_PORT` (defaults to `18080`)
- `MULE_DOCTOR_UI_LOG_BUFFER_LINES` (defaults to `2000`, in-memory app-log line buffer for UI)
- `OPENAI_INPUT_COST_PER_1K` (optional USD per 1K input tokens, default `0`)
- `OPENAI_OUTPUT_COST_PER_1K` (optional USD per 1K output tokens, default `0`)

## Scripts

- `npm run build` – compile TypeScript to `dist/`
- `npm run start` – run compiled agent
- `npm run dev` – watch compile during development
- `npm run typecheck` – strict typecheck (`tsc --noEmit`)
- `npm run lint` – run ESLint across the codebase
- `npm run lint:fix` – auto-fix lint issues where supported
- `npm run format` – run Prettier and write formatting changes
- `npm run format:check` – verify formatting without writing changes
- `npm test` – build + run basic smoke tests
- `npm run check` – CI-friendly verification (`typecheck` + `lint` + `test`)

## Container Runtime

The Docker image follows the architecture runtime layout:

- `/opt/rust-mule` – rust-mule source + compiled binary
- `/app` – mule-doctor code and compiled JS
- `/data` – runtime volume (state, logs, token, config)
- runtime image includes `git`; bundled `/opt/rust-mule` keeps local `.git` history for read-only operations like `git_blame`, with `origin` remote removed to prevent accidental pushes

Container defaults:

- `RUST_MULE_API_URL=http://127.0.0.1:17835`
- `RUST_MULE_TOKEN_PATH=/data/token`
- `RUST_MULE_LOG_PATH=/data/logs/rust-mule.log`
- `RUST_MULE_SOURCE_PATH=/opt/rust-mule`
- `MULE_DOCTOR_DATA_DIR=/data/mule-doctor`
- `MULE_DOCTOR_UI_ENABLED=false`
- `MULE_DOCTOR_UI_AUTH_TOKEN` must be supplied if the UI is enabled
- `MULE_DOCTOR_UI_HOST=127.0.0.1`
- `MULE_DOCTOR_UI_PORT=18080`

Entrypoint behavior:

1. Starts rust-mule (`/opt/rust-mule/target/release/rust-mule --config /data/config.toml`)
2. Waits for token file at `RUST_MULE_TOKEN_PATH` (`/data/token` by default)
3. Starts mule-doctor (`node /app/dist/index.js`)

Required production runtime inputs:

- `/data/config.toml` for rust-mule startup
- `OPENAI_API_KEY`
- `MATTERMOST_WEBHOOK_URL`

Runtime readiness validation:

- mule-doctor validates required env-driven startup prerequisites before the observer loop starts
- startup fails fast if:
  - `RUST_MULE_TOKEN_PATH` is missing or unreadable
  - `RUST_MULE_DEBUG_TOKEN_FILE` is configured but unreadable
  - the parent directory of `RUST_MULE_LOG_PATH` does not exist or is inaccessible
  - persistence/log/proposal directories under `MULE_DOCTOR_DATA_DIR`, `MULE_DOCTOR_LLM_LOG_DIR`, `MULE_DOCTOR_STATE_PATH`, or `MULE_DOCTOR_HISTORY_PATH` cannot be created/written
- the container entrypoint separately validates that `/data/config.toml` exists and is readable before starting rust-mule

Operator console (optional):

- `GET /` serves a read-only UI for operator inspection.
- The UI and `/api/*` routes are guarded by `MULE_DOCTOR_UI_AUTH_TOKEN`.
- JSON endpoints include `/api/health`, `/api/logs/app`, `/api/logs/rust-mule`, `/api/llm/logs`, and `/api/proposals`.
- Live log streaming is available through SSE at `/api/stream/app` and `/api/stream/rust-mule`.
- Frontend assets are served statically from the built-in operator-console public bundle rather than inline backend HTML templates.
- Docker compose maps UI port `${MULE_DOCTOR_UI_PORT:-18080}`, but keeps the UI disabled by default.
- To access the console from the host, explicitly set `MULE_DOCTOR_UI_ENABLED=true`, provide `MULE_DOCTOR_UI_AUTH_TOKEN`, and keep `MULE_DOCTOR_UI_HOST=0.0.0.0` inside the container.
- Do not expose the console directly on untrusted networks; place it behind an authenticated or access-restricted reverse proxy if remote access is needed.

## Notes

- `getRoutingBuckets` uses `/api/v1/debug/routing/buckets` and sends `X-Debug-Token` when `RUST_MULE_DEBUG_TOKEN_FILE` is configured. If debug endpoints are unavailable (403/404/501), mule-doctor logs a warning and continues with empty bucket data.
- Runtime persistence auto-creates state/history files and appends one history snapshot per observer cycle.
- Observer now computes a deterministic network health score (peer count, bucket balance, lookup success, hop efficiency, error rate) and persists it as `lastHealthScore` + history entries.
- Tool surface includes: `getHistory`, `searchLogs`, `triggerBootstrap`, and `traceLookup` (debug tools require bearer + `X-Debug-Token` and poll async job/trace status endpoints).
- Source tools are enabled only when `RUST_MULE_SOURCE_PATH` is set: `search_code`, `read_file`, `show_function`, `propose_patch`, and `git_blame`.
- Source scanning is Rust-project oriented (`.rs` and core Rust project text files), excludes sensitive files (for example `.env` and key material), and `show_function` resolves Rust function signatures.
- File access is sandboxed to the configured source root and `propose_patch` stores proposal artifacts under `/data/mule-doctor/proposals` by default (configurable via `MULE_DOCTOR_DATA_DIR`) for review.
- `read_file` and `git_blame` block sensitive paths (for example `.env` and `.git` content).
- `propose_patch` enforces a maximum diff size to avoid oversized artifact writes.
- When `propose_patch` is used, mule-doctor also posts a Mattermost notification containing proposal metadata and diff content for quick reviewer access.
- Analyzer records per-call LLM usage logs (`LLM_<timestamp>.log`), aggregates daily/monthly usage in state, and emits one Mattermost usage report per UTC day when usage exists.
- Current slash/mention command handling is implemented in code, but this repo does not yet expose an inbound HTTP command endpoint.
