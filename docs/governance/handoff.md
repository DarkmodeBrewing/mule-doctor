# Handoff

## Branch
- `feature/phase6-7-reporting-telemetry`
- PR: TBD (to be created with `gh pr create`)
- Last updated: 2026-03-05

## Status
- Phase 6/7 architecture implementation is in progress.
- This branch adds structured Mattermost reporting and LLM usage/cost telemetry with persisted daily/monthly aggregates.

## Completed Work
- Added LLM usage tracking module:
  - `src/llm/usageTracker.ts`
  - writes `/data/mule-doctor/LLM_<timestamp>.log` records
  - tracks daily/monthly aggregate buckets in runtime state
  - computes estimated cost from configurable per-1K token rates
  - supports once-per-day usage report emission (`consumeDailyReport`)
- Extended analyzer to emit telemetry:
  - captures prompt/completion token usage from OpenAI responses
  - records model/tokens/cost through `UsageTracker`
  - exposes `consumeDailyUsageReport()` for observer scheduling
- Upgraded Mattermost integration:
  - structured periodic attachments with health color mapping
  - metrics block + observations block payload format
  - daily usage/spend attachments (today + monthly totals)
- Updated observer loop:
  - uses structured periodic report method
  - emits one daily usage report when usage exists and not yet reported that UTC day
- Added config wiring in startup:
  - `MULE_DOCTOR_LLM_LOG_DIR`
  - `OPENAI_INPUT_COST_PER_1K`
  - `OPENAI_OUTPUT_COST_PER_1K`
- Expanded tests:
  - `src/usageTracker.test.mjs` (log writing, aggregation, once-per-day report behavior)
  - `src/mattermost.test.mjs` (periodic + usage attachment payloads)

## Key Decisions
- Keep usage pricing configurable via env rates to avoid hardcoding model pricing in code.
- Usage reporting is UTC-day keyed and persisted in state so behavior survives restarts.
- Daily usage report is emitted at most once per UTC day and only when calls > 0 for that day.
- Periodic diagnostic report uses attachment colors aligned with architecture health semantics.

## Validation
- `npm run check` passed on this branch:
  - TypeScript no-emit typecheck passed
  - Tests passed (`30/30`)

## Next Steps
- Open PR for Phase 6/7 structured reporting + telemetry.
- Start Phase 8 (runtime/container layout alignment) after this PR merges.
