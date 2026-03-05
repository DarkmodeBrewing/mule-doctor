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
- `OPENAI_API_KEY`
- `MATTERMOST_WEBHOOK_URL`

Optional:

- `RUST_MULE_TOKEN_PATH` (API bearer token file path; defaults to no bearer auth)
- `RUST_MULE_DEBUG_TOKEN_FILE` (debug token file path; required by rust-mule debug endpoints via `X-Debug-Token`)
- `RUST_MULE_API_PREFIX` (defaults to `/api/v1`)
- `OBSERVE_INTERVAL_MS` (defaults to `300000`, 5 minutes)
- `OPENAI_MODEL` (defaults to `gpt-5-mini`)
- `MULE_DOCTOR_DATA_DIR` (defaults to `/data/mule-doctor`)
- `MULE_DOCTOR_STATE_PATH` (defaults to `/data/mule-doctor/state.json`)
- `MULE_DOCTOR_HISTORY_PATH` (defaults to `/data/mule-doctor/history.json`)
- `MULE_DOCTOR_HISTORY_LIMIT` (defaults to `500`)
- `MULE_DOCTOR_LLM_LOG_DIR` (defaults to `MULE_DOCTOR_DATA_DIR`, stores `LLM_<timestamp>.log`)
- `OPENAI_INPUT_COST_PER_1K` (optional USD per 1K input tokens, default `0`)
- `OPENAI_OUTPUT_COST_PER_1K` (optional USD per 1K output tokens, default `0`)

## Scripts

- `npm run build` – compile TypeScript to `dist/`
- `npm run start` – run compiled agent
- `npm run dev` – watch compile during development
- `npm run typecheck` – strict typecheck (`tsc --noEmit`)
- `npm test` – build + run basic smoke tests
- `npm run check` – CI-friendly verification (`typecheck` + `test`)

## Notes

- `getRoutingBuckets` uses `/api/v1/debug/routing/buckets` and sends `X-Debug-Token` when `RUST_MULE_DEBUG_TOKEN_FILE` is configured. If debug endpoints are unavailable (403/404/501), mule-doctor logs a warning and continues with empty bucket data.
- Runtime persistence auto-creates state/history files and appends one history snapshot per observer cycle.
- Observer now computes a deterministic network health score (peer count, bucket balance, lookup success, hop efficiency, error rate) and persists it as `lastHealthScore` + history entries.
- Tool surface includes: `getHistory`, `searchLogs`, `triggerBootstrap`, and `traceLookup` (debug tools require bearer + `X-Debug-Token` and poll async job/trace status endpoints).
- Analyzer records per-call LLM usage logs (`LLM_<timestamp>.log`), aggregates daily/monthly usage in state, and emits one Mattermost usage report per UTC day when usage exists.
- Current slash/mention command handling is implemented in code, but this repo does not yet expose an inbound HTTP command endpoint.
