# mule-doctor Implementation Task Plan

Source of truth: `docs/architecture/rust-doctor.md`.

This document translates the architecture into an implementation backlog.
Each item is intended to become one or more focused feature branches and PRs.

## Goals

1. Align runtime behavior with the architecture document.
2. Keep mule-doctor strictly observer/advisor (no unsafe control actions).
3. Add deterministic, structured data flow for metrics, tools, and reporting.
4. Build a clear path for incremental delivery and review.

## Current Gaps (vs architecture)

1. Model mismatch: code uses `gpt-4o`; architecture specifies `gpt-5-mini`.
2. No persisted runtime state (`/data/mule-doctor/state.json`).
3. No historical metrics store (`/data/mule-doctor/history.json`).
4. No health scoring module (`healthScore.ts`).
5. Tool output contract is not standardized as `{ tool, success, data|error }`.
6. Missing tools: `getHistory`, `searchLogs`, `triggerBootstrap`, `traceLookup(target_id)`.
7. No source code tools behind `RUST_MULE_SOURCE_PATH`.
8. Mattermost output is plain text only; architecture expects richer attachment format and status coloring.
9. No LLM call usage logging or daily spending report.
10. Container/runtime layout does not match architecture example.

## Implementation Phases

## Phase 1: Core Contract Alignment

1. Introduce shared types for:
   - tool responses (`ToolResult`)
   - observer snapshots
   - persisted state/history entries
2. Switch analyzer default model to architecture model and make model configurable.
3. Enforce structured tool response format for every tool.
4. Add strict input validation for env vars and interval parsing.

Acceptance criteria:
- All tool handlers return structured JSON envelope.
- Analyzer and observer compile and run with new contract.
- Existing tests updated and passing.

## Phase 2: Persistent State and History

1. Add state manager for `/data/mule-doctor/state.json`.
2. Add history manager for `/data/mule-doctor/history.json` with bounded retention.
3. Persist:
   - last run timestamp
   - last health score
   - log read offset
   - last alert issued
4. Integrate persistence into observer lifecycle.

Acceptance criteria:
- State/history files auto-created if absent.
- Observer survives restart and continues from persisted state.
- Retention limit enforced.

## Phase 3: Network Health Module

1. Add `src/health/healthScore.ts` implementing weighted score components:
   - peer count
   - bucket balance
   - lookup success
   - lookup efficiency (hops)
   - error rate
2. Define normalization rules per component (0-100 scale).
3. Add unit tests covering healthy, degraded, and missing-data scenarios.

Acceptance criteria:
- `getNetworkHealth()` returns deterministic score + component breakdown.
- Observer includes health score in each diagnostic cycle context.

## Phase 4: Tool Surface Completion

1. Add `getHistory`.
2. Add `searchLogs` (safe bounded log search; no arbitrary shell injection).
3. Add `triggerBootstrap` as explicitly controlled tool with safety guardrails.
4. Add `traceLookup(target_id)` tool and structured hop trace output.
5. Keep existing tools (`getNodeInfo`, `getPeers`, `getRoutingBuckets`) compatible.

Acceptance criteria:
- Tool registry matches architecture list.
- All tool outputs follow standard response envelope.
- Tests cover success and failure responses.

## Phase 5: Source Code Tools (Read/Inspect + Proposal)

1. Add `RUST_MULE_SOURCE_PATH`-gated tool set:
   - `search_code(query)`
   - `read_file(path)`
   - `show_function(name)`
   - `propose_patch(diff)`
   - `git_blame(file, line)`
2. Keep write operations proposal-only by default.
3. Add path sandboxing to prevent filesystem escape outside source root.

Acceptance criteria:
- Source tools disabled cleanly when source path is unset.
- Proposal operations produce reviewable artifacts only.
- Security tests for path traversal and command injection.

## Phase 6: Mattermost Reporting

1. Add structured attachment payload format with health color mapping:
   - healthy (`#2ecc71`)
   - warning (`#f1c40f`)
   - degraded (`#e74c3c`)
   - informational (`#3498db`)
2. Include node metrics + observations blocks.
3. Add daily usage/spend report message.

Acceptance criteria:
- Periodic report uses attachment schema.
- Daily usage report emits once per UTC day.

## Phase 7: LLM Telemetry and Cost Tracking

1. Log each LLM call to `/data/mule-doctor/LLM_<timestamp>.log`.
2. Track tokens in/out, model, estimated cost.
3. Aggregate daily and monthly usage summaries.

Acceptance criteria:
- Every analyze cycle records LLM telemetry.
- Usage aggregation survives process restarts.

## Phase 8: Runtime and Container Layout

1. Align Docker/runtime paths with architecture:
   - `/opt/rust-mule`
   - `/app`
   - `/data`
2. Add/align entrypoint behavior for rust-mule + mule-doctor startup.
3. Document runtime dependencies and production configuration.

Acceptance criteria:
- Container boots reliably in architecture-defined layout.
- Health/reporting loop runs with persisted `/data` volume.

## Phase 9: Test and Release Hardening

1. Expand tests beyond client:
   - observer loop integration
   - analyzer tool-call loop
   - tool registry contract tests
   - persistence and retention behavior
2. Add CI checks for lint/type/test/build.
   - Add GitHub Actions PR workflow (trigger: `pull_request` to `main`) that runs:
     - `npm ci`
     - `npm run check`
3. Add smoke script for local end-to-end validation.

Acceptance criteria:
- CI validates all core behavior.
- PR workflow fails fast on test/type/lint regressions before merge.
- Regressions are caught before merge.

## API Clarifications Needed from rust-mule

1. Bootstrap trigger endpoint and auth requirements for `triggerBootstrap`.
2. Lookup trace endpoint and response schema for `traceLookup(target_id)`.
3. Fields/endpoints for hop count and lookup efficiency calculations.
4. Any rate limits or polling guidance for diagnostic API calls.
5. Stability guarantees for debug endpoints across environments.

## Suggested Delivery Order

1. Phase 1 (contract alignment)
2. Phase 2 + Phase 3 (state/history + health score)
3. Phase 4 (tool completion)
4. Phase 6 + Phase 7 (reporting + usage telemetry)
5. Phase 5 (source tools)
6. Phase 8 + Phase 9 (runtime hardening + CI)

## Documented Next Tasks (Deferred, No Implementation Yet)

These items are intentionally documented for follow-up and are not in progress.

## Task A: End-to-End Smoke Harness

1. Add a repeatable local smoke script that:
   - boots the stack via `docker compose`
   - waits for rust-mule + mule-doctor readiness
   - validates key observer/tool flows
   - verifies persisted artifacts under mounted `/data`
2. Ensure clear pass/fail output and non-zero exit on failure.

Acceptance criteria:
- One command executes the smoke run end-to-end.
- Script verifies state/history/proposal artifact creation.
- Suitable for pre-release validation.

## Task B: Integration Coverage for rust-mule API Edge Cases

1. Add integration tests for debug endpoint behaviors:
   - `403` for invalid debug token
   - `404` when debug mode is disabled
   - async `202 -> poll` flows for bootstrap and trace lookup
2. Validate bearer-token rejection behavior (`403`) across relevant endpoints.

Acceptance criteria:
- Edge-case handling is covered by automated integration tests.
- Regressions in debug/auth/polling behavior are caught before merge.

## Task C: Runtime Readiness Validation

1. Add a startup/readiness validation script/checklist for runtime prerequisites:
   - required env vars
   - token and debug-token file paths
   - config file presence
   - writable `/data` subpaths
2. Fail fast with explicit operator-facing diagnostics when prerequisites are missing.

Acceptance criteria:
- Startup failures surface concrete missing prerequisites.
- Operational setup issues are identified before observer loop begins.
