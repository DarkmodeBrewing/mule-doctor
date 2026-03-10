# mule-doctor Implementation Task Plan

Source of truth: `docs/architecture/rust-doctor.md`.

This document translates the architecture into an implementation backlog.
Each item is intended to become one or more focused feature branches and PRs.

## Goals

1. Align runtime behavior with the architecture document.
2. Keep externally managed rust-mule nodes strictly observer/advisor scope.
3. Add deterministic, structured data flow for metrics, tools, and reporting.
4. Build a clear path for incremental delivery and review.
5. Evolve the operator console into the control surface for mule-doctor-managed local test instances.

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

## Task D: Operator Observability Web Console

1. Add a small, read-only web server + UI for operators to inspect:
   - mule-doctor app logs
   - LLM telemetry logs
   - saved patch proposal artifacts
2. Provide minimal API/UI surface for:
   - health/runtime status
   - tail/browse logs
   - list/view/download proposal files
3. Container/runtime access requirements:
   - expose a dedicated UI port from the mule-doctor container
   - map that port in `docker-compose.yml` for host/browser access
   - make bind address and port configurable by env vars
4. Security and safety constraints:
   - disabled by default
   - default bind to loopback unless explicitly configured
   - redact token/secrets from rendered log content
   - path-safe reads scoped to allowed data directories only

Acceptance criteria:

- Operator can access the UI in a browser through the container-exposed port.
- UI supports log and proposal inspection without shell access.
- App remains running if UI server fails to start; failure is logged.

## Task E: Managed Local rust-mule Instances

1. Add an explicit `InstanceManager` for mule-doctor-owned local test instances.
2. Support zero-or-more managed instances rather than assuming a single external client.
3. Give each instance a stable id and isolated runtime directory under `/data/instances/<id>`.
4. Allocate per-instance:
   - config file
   - token/debug-token files
   - API port
   - log path
   - observation/runtime state namespace
5. Use the shared rust-mule binary built into the container image instead of copying binaries per instance unless version pinning requires otherwise.

Acceptance criteria:

- mule-doctor can start without any running rust-mule client.
- Managed instances can be created and started by mule-doctor against isolated runtime directories.
- Process lifecycle is owned by a bounded `InstanceManager`, not ad hoc shelling out from the UI.

## Task F: Operator Console Control Plane

1. Extend the operator console from read-only observability to controlled local-instance lifecycle management.
2. Add UI/API flows for:
   - listing managed instances
   - start
   - stop
   - restart
   - view per-instance health/log/runtime metadata
3. Keep control scope bounded to mule-doctor-managed local test instances only.
4. Preserve explicit safety boundaries so external nodes remain observer-only.

Acceptance criteria:

- Operator can boot multiple local rust-mule instances from the browser.
- Each managed instance is clearly labeled and observable independently.
- Control actions do not apply to external production-like nodes.

## Task G: Split Operator Console UI From Server Code

1. Move the operator console frontend out of inline HTML strings in `server.ts`.
2. Serve static UI assets from a dedicated directory such as `src/operatorConsole/public/`.
3. Separate concerns into:
   - static HTML/CSS/JS assets
   - backend API/auth routes
   - backend SSE stream handlers
4. Keep the backend lightweight; do not add a new web framework unless routing complexity justifies it later.

Acceptance criteria:

- The operator console frontend is served as static assets rather than inline string templates.
- UI review and testing are easier because frontend changes are isolated from backend route logic.
- The current auth/API/SSE behavior remains intact after the split.

## Task H: Active Diagnostic Target Routing

1. Introduce an explicit active diagnostic target model for the scheduled observer pipeline:
   - external configured rust-mule client
   - selected mule-doctor-managed instance
2. Persist the active target in mule-doctor runtime state so restarts remain deterministic.
3. Expose target selection in the operator console API/UI.
4. Route scheduled observation, analyzer tool calls, and health persistence through the selected target.
5. Decide and document Mattermost semantics:
   - whether reports follow the active target
   - how the active target is labeled in notifications
6. Add a bounded operator action to trigger the scheduled observer cycle immediately.
7. Keep failure handling non-fatal:
   - stopped managed instance
   - missing token files
   - version-dependent 404 endpoints
   - transient timeouts
8. Surface scheduler execution state in runtime/API/UI:
   - current cycle start time
   - current cycle target
   - last cycle duration
   - last cycle outcome
9. Add a bounded operator event timeline:
   - target changes
   - run-now requests
   - cycle start
   - cycle completion outcome
10. Add a read-only managed-instance comparison view:
   - compare two managed instances side by side
   - reuse diagnostics snapshots rather than changing the scheduler model
   - keep scheduled observation single-target

Acceptance criteria:

- Operator can inspect and change the active diagnostic target explicitly.
- mule-doctor restarts with the previously selected target intact.
- Scheduled observation uses the selected target without crashing when that target is unavailable.
- Reports and runtime state identify which target was observed.
- Operator can trigger a one-off scheduled-cycle run without changing the background scheduler model.
- Operator console shows scheduler execution state without requiring raw log inspection.
- Operator console shows a bounded event timeline for recent control and scheduler actions.
- Operator can compare two managed instances in the console without changing the active scheduled target.

## Task I: Managed Instance Cluster Presets

1. Add a bounded preset model for mule-doctor-managed local test clusters.
2. Start with simple built-in presets such as:
   - `pair`
   - `trio`
3. Let operators apply a preset by providing an instance-id prefix.
4. Create all preset instances through `InstanceManager` batch planning rather than per-instance UI loops.
5. Keep preset application read-only with respect to scheduler targeting:
   - do not change the active scheduled target
   - do not start scheduled observation on the new instances automatically
6. Add bounded bulk lifecycle flows for preset-created groups:
   - start every instance in one preset group from one operator action
   - stop every instance in one preset group from one operator action
   - restart every instance in one preset group from one operator action
   - preserve explicit per-instance lifecycle APIs underneath
   - report partial failures without crashing mule-doctor
7. Keep preset scope bounded; lifecycle start/stop remains explicit operator intent.

Acceptance criteria:

- Operator can list available presets in the console.
- Operator can inspect preset intent in the console before applying it, including a short description and node-layout summary.
- Operator can apply a preset and get multiple planned instances with stable ids such as `lab-a`, `lab-b`, `lab-c`.
- Batch preset creation preserves existing `InstanceManager` invariants for ids, ports, runtime paths, and rollback on failure.
- Operator can trigger bounded bulk start/stop/restart actions for a preset-created group from the console.
- Bulk preset-group actions surface partial failures as data, not as a mule-doctor-wide failure.
- Scheduled observation remains single-target and unchanged after preset application.

## Task J: Operator Console Cluster Grouping

1. Make preset-created groups first-class in the operator console UI.
2. Show a per-group summary with:
   - planned/running/stopped/failed counts
   - group membership
   - last known failure summaries when present
3. Keep grouped members operable from the group view:
   - inspect
   - analyze
   - use as target
4. Keep standalone instances visible separately so non-preset instances are not lost.

Acceptance criteria:

- Preset-created groups are easier to scan than the flat instance list.
- Operators can understand group state without opening raw per-instance detail first.
- Grouped members remain directly inspectable/selectable from the cluster view.
- Preset groups provide a quick path into the existing side-by-side compare view.
- Preset apply controls explain the purpose and layout of the selected preset without requiring operators to read external docs first.
- Operators can filter the timeline by group, managed instance, and event type.
- Cluster cards and grouped members provide direct shortcuts into the existing filtered operator timeline.
