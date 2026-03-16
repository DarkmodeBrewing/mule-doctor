# mule-doctor

Observability and diagnostic agent for `rust-mule` nodes.

## Docs

- Configuration reference: [docs/configuration.md](/home/coder/projects/mule-doctor/docs/configuration.md)
- Operator console HTTP API: [docs/api.md](/home/coder/projects/mule-doctor/docs/api.md)
- LLM tool capability reference: [docs/llm_tools.md](/home/coder/projects/mule-doctor/docs/llm_tools.md)
- Architecture: [docs/architecture/mule-doctor.md](/home/coder/projects/mule-doctor/docs/architecture/mule-doctor.md)
- Backlog / implementation plan: [docs/TASK.md](/home/coder/projects/mule-doctor/docs/TASK.md)

## What it does

- polls the rust-mule API (`/api/v1`)
- tails rust-mule logs
- runs an LLM diagnostic loop with tool-calling
- posts periodic reports to Mattermost via incoming webhook
- persists controlled discoverability and normalized search-health history for operators and LLM diagnostics

## Configuration

Copy `.env.example` and set values in your shell or runtime environment.

Minimum required variables:

- `RUST_MULE_API_URL`
- `RUST_MULE_LOG_PATH`
- `RUST_MULE_TOKEN_PATH`
- `OPENAI_API_KEY`
- `MATTERMOST_WEBHOOK_URL`

For the full runtime contract, including optional env vars, container entrypoint variables, managed-instance settings, and config ownership, see [docs/configuration.md](/home/coder/projects/mule-doctor/docs/configuration.md).

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
- `npm run smoke:docker` – build the Docker stack, wait for rust-mule + mule-doctor readiness, and validate persisted runtime artifacts under a disposable temp `/data`
- `npm run check` – CI-friendly verification (`typecheck` + `lint` + `test`)

## Container Runtime

The Docker image follows the architecture runtime layout:

- `/opt/rust-mule` – rust-mule source + compiled binary
- `/app` – mule-doctor code and compiled JS
- `/data` – runtime volume (state, logs, token, config)
- runtime image includes `git`; bundled `/opt/rust-mule` keeps local `.git` history for read-only operations like `git_blame`, with `origin` remote removed to prevent accidental pushes

For container defaults, entrypoint variables, and startup behavior, see [docs/configuration.md](/home/coder/projects/mule-doctor/docs/configuration.md).

End-to-end smoke harness:

- `npm run smoke:docker` provisions a disposable temp data directory, starts the stack with `docker compose`, waits for:
  - rust-mule token creation
  - rust-mule `GET /api/v1/health`
  - rust-mule authenticated `GET /api/v1/status`
  - rust-mule `/api/v1/status.ready == true`
  - rust-mule `/api/v1/searches.ready == true`
  - authorized mule-doctor `GET /api/health`
- it then verifies persisted runtime artifacts under the mounted `/data`, including:
  - `config.toml`
  - `logs/rust-mule.log`
  - `mule-doctor/state.json`
  - `mule-doctor/history.json`
  - `mule-doctor/operator-events.json`
- by default the temp work directory is deleted on success and preserved on failure with captured compose logs for debugging

Note: rust-mule readiness handling is being aligned with the newer `200 + ready: true/false` contract in code and tests, but the broader observer/search workflow work is still tracked in [docs/TASK.md](/home/coder/projects/mule-doctor/docs/TASK.md).

Operator console (optional):

- `GET /` serves a read-only UI for operator inspection.
- The UI and `/api/*` routes are guarded by `MULE_DOCTOR_UI_AUTH_TOKEN`.
- JSON endpoints and request/response details are documented in [docs/api.md](/home/coder/projects/mule-doctor/docs/api.md).
- Live log streaming is available through SSE at `/api/stream/app` and `/api/stream/rust-mule`.
- The selected-instance panel now shows a compact rust-mule surface summary over searches, shared publish state, shared actions, and downloads, with the raw summary payload still available underneath.
- Frontend assets are served statically from the built-in operator-console public bundle rather than inline backend HTML templates.
- Docker compose maps UI port `${MULE_DOCTOR_UI_PORT:-18080}`, but keeps the UI disabled by default.
- To access the console from the host, explicitly set `MULE_DOCTOR_UI_ENABLED=true`, provide `MULE_DOCTOR_UI_AUTH_TOKEN`, and keep `MULE_DOCTOR_UI_HOST=0.0.0.0` inside the container.
- Do not expose the console directly on untrusted networks; place it behind an authenticated or access-restricted reverse proxy if remote access is needed.

## Notes

- `getRoutingBuckets` uses `/api/v1/debug/routing/buckets` and sends `X-Debug-Token` when `RUST_MULE_DEBUG_TOKEN_FILE` is configured. If debug endpoints are unavailable (403/404/501), mule-doctor logs a warning and continues with empty bucket data.
- Runtime persistence auto-creates state/history files and appends one history snapshot per observer cycle.
- Observer now computes a deterministic network health score (peer count, bucket balance, lookup success, hop efficiency, error rate) and persists it as `lastHealthScore` + history entries.
- The LLM tool surface is documented in [docs/llm_tools.md](/home/coder/projects/mule-doctor/docs/llm_tools.md).
- Analyzer records per-call LLM usage logs (`LLM_<timestamp>.log`), aggregates daily/monthly usage in state, and emits one Mattermost usage report per UTC day when usage exists.
- Periodic Mattermost reports now include compact discoverability and search-health summary attachments when recent history exists, and add managed surface diagnostics when the active target is a managed instance.
- Current slash/mention command handling is implemented in code, but this repo does not yet expose an inbound HTTP command endpoint.
