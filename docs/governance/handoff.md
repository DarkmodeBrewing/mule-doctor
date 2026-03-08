# Handoff

## Branch

- `feature/observer-active-target`
- PR: (pending)
- Last updated: 2026-03-08

## Status

- In progress; starting active diagnostic target routing for the scheduled observer pipeline.
- PR #30 is merged to `main`.

## Completed Work

- Updated observer loop scheduling to prevent overlapping cycles:
  - replaced fixed `setInterval` cycle dispatch with chained `setTimeout` after each cycle finishes.
  - added duplicate-start guard (`started` flag).
  - stop now clears pending timeout and disables follow-up scheduling.
- Added observer test coverage for non-overlapping behavior with a slow analyzer.
- Updated source proposal handling:
  - `propose_patch` now writes artifacts to `/data/mule-doctor/proposals` by default.
  - `SourceCodeTools` now accepts explicit `proposalDir` override.
  - `artifactPath` now returns absolute path to the saved patch.
- Wired proposal directory through app/tool wiring:
  - `index.ts` computes `${MULE_DOCTOR_DATA_DIR || "/data/mule-doctor"}/proposals`.
  - `ToolRegistry` passes `proposalDir` into `SourceCodeTools`.
- Updated tests (`sourceCodeTools` + `toolRegistry`) to use temp proposal directories and assert absolute artifact paths.
- Updated README runtime notes for the canonical proposal artifact location.
- Updated container tooling for source-code operations:
  - installed `git` in the runtime image (`runner` stage).
  - retained `/opt/rust-mule/.git` metadata in the bundled source tree.
  - removed rust-mule `origin` remote during image build to prevent accidental push from container context.
- Addressed PR #15 review feedback:
  - normalized/validated `proposalDir` handling (`undefined` -> default, relative -> source-root relative, empty string rejected).
  - strengthened observer scheduling semantics across `stop()` + `start()` transitions with in-flight cycle/generation guards.
  - added tests for duplicate `start()` and `stop()`/`start()` while a cycle is in flight.
  - clarified README wording that proposal artifact path is default/configurable.
- Added lint/format toolchain:
  - installed dev dependencies: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `globals`.
  - added flat ESLint config (`eslint.config.mjs`) and Prettier config/ignore files.
  - added npm scripts: `lint`, `lint:fix`, `format`, `format:check`.
  - updated `check` script to run `typecheck + lint + test`.
- Addressed PR #18 review feedback:
  - aligned declared Node engine with ESLint v10 requirements (`>=20.19.0`).
  - pinned CI Node setup to `20.19.0` and renamed CI job to explicitly reflect lint stage.
  - restored intended indentation in architecture tree under `mule-doctor` using a fenced `text` block.
- Ran `npm run format` across the repository and fixed new lint findings surfaced by ESLint.
- Migrated LLM client integration to official OpenAI SDK:
  - added runtime dependency: `openai`.
  - refactored `src/llm/analyzer.ts` to use `OpenAI` client (`chat.completions.create`) instead of manual `fetch`.
  - preserved existing tool-calling loop semantics and usage tracking behavior.
  - improved API error wrapping via structured SDK error handling.
  - enhanced SDK error formatting to explicitly include API status/code/type when available.
- Security and reliability hardening:
  - enforced required bearer token path at startup (`RUST_MULE_TOKEN_PATH`).
  - made rust-mule auth/debug token file load failures explicit and fatal when configured.
  - added bounded HTTP timeouts for rust-mule API calls and Mattermost webhook posts.
  - made read-only rust-mule endpoint calls resilient to transient/unavailable endpoints (including 404 and timeout), with warning logs and safe fallback values.
  - guarded analyzer against empty OpenAI choices responses.
  - removed tool-result payload snippets from analyzer logs to reduce sensitive-data leakage.
  - fixed log watcher offset progression so read failures do not skip unread log bytes.
  - blocked sensitive paths in source tools (`read_file`/`git_blame`) and excluded sensitive files from search scanning.
  - added `propose_patch` maximum diff size enforcement to prevent oversized proposal artifacts.
  - expanded tests for timeout handling and source-tool sensitive path protections.
- Addressed PR #20 review feedback:
  - exported `RUST_MULE_TOKEN_PATH` in `entrypoint.sh` so the Node process receives the validated value.
  - widened sensitive `.env` path detection to block `.env` directory segments as well as files.
  - aligned `propose_patch` byte-limit enforcement with exact bytes written to disk.
  - updated `LogWatcher` to advance offsets by consumed bytes and always close/destroy stream resources in `finally`.
  - made core read endpoints treat HTTP 403 as non-recoverable (while keeping debug endpoint fallback behavior).
  - added test coverage for `.env` directory blocking, log-watcher offset handling, and core-read 403 behavior.
- Added deferred backlog item in `docs/TASK.md` for an operator observability web console:
  - browser UI for app logs, LLM logs, and patch proposal artifacts.
  - explicit requirement to expose a dedicated container port and map it in docker-compose.
  - security defaults and read-only constraints documented.
- Implemented operator console phase 1:
  - added optional in-process `OperatorConsoleServer` with read-only routes:
    - `/` (UI)
    - `/api/health`
    - `/api/logs/app`
    - `/api/logs/rust-mule`
    - `/api/llm/logs` and `/api/llm/logs/:file`
    - `/api/proposals` and `/api/proposals/:file`
  - added stdout log buffering (`installStdoutLogBuffer`) so app logs can be inspected from the UI.
  - wired console startup in `index.ts` behind env toggles, with graceful failure behavior (app continues if UI fails to start).
  - documented and wired container access:
    - Dockerfile `EXPOSE 17835 18080`
    - compose maps UI port but keeps the UI disabled by default; enabling host access requires explicit `MULE_DOCTOR_UI_ENABLED=true`
    - env vars added: `MULE_DOCTOR_UI_ENABLED`, `MULE_DOCTOR_UI_HOST`, `MULE_DOCTOR_UI_PORT`, `MULE_DOCTOR_UI_LOG_BUFFER_LINES`
  - added integration-style test coverage for console health/log/proposal endpoints.
  - addressed PR #22 review feedback:
    - only install stdout log buffering when the UI or explicit buffer sizing is enabled.
    - await operator console shutdown with timeout before process exit.
    - hardened operator console responses with `Cache-Control: no-store`, `Pragma: no-cache`, and `X-Content-Type-Options: nosniff`.
    - tightened filename validation for console file reads and strengthened resolved-path escape checks.
    - added focused test coverage for stdout log buffer chunk handling and restore behavior.
    - updated compose/docs so unauthenticated UI exposure is opt-in instead of default.
- Operator console phase 2 underway:
  - adding token-based auth for the UI shell and all `/api/*` routes.
  - adding SSE streams for live app-log and rust-mule-log viewing.
  - extending UI to support authenticated access and live stream consumption.
  - expanding test coverage for auth and stream behavior.
- Documentation updated for the next architectural direction:
  - architecture now explicitly documents the operator console as part of the system.
  - architecture now distinguishes external observation mode from future mule-doctor-managed local test instances.
  - backlog now includes `InstanceManager` and operator-console control-plane tasks for multi-instance rust-mule supervision.
  - backlog now also includes splitting the operator-console frontend into static assets instead of inline HTML in server code.
- Operator-console static asset split underway:
  - moving the frontend into `src/operatorConsole/public/`
  - serving HTML/CSS/JS statically from the existing Node server
  - preserving the current auth, API, and SSE behavior while simplifying `server.ts`
- Instance-manager foundation underway:
  - adding persisted managed-instance metadata separate from process launch
  - adding deterministic runtime directory planning under `/data/instances/<id>`
  - reserving unique API ports for planned instances
  - generating bounded per-instance `config.toml` files from confirmed rust-mule settings (`sam.session_name`, `general.data_dir`, `api.port`) plus optional shared template overrides
  - aligning managed runtime token/log paths with rust-mule `general.data_dir`
  - explicitly deferring process spawn until rust-mule startup behavior is confirmed
- Managed-instance launcher phase underway:
  - adding a bounded process-launch abstraction for rust-mule child-process lifecycle
  - persisting per-instance runtime process state (`pid`, command, cwd, last exit)
  - reconciling stale `running` records on mule-doctor startup and polling reconciled live pids so status does not stick forever after a mule-doctor restart
  - deferring operator-console lifecycle controls until backend launch behavior is in place
- Managed-instance diagnostics routing underway:
  - adding a `ManagedInstanceDiagnosticsService` that builds per-instance `RustMuleClient` objects from managed runtime metadata
  - loading managed-instance bearer/debug tokens from each instance runtime directory before snapshot collection
  - exposing operator-console diagnostics route for a selected managed instance
  - extending the console UI to show selected-instance diagnostics alongside detail and per-instance logs
- Managed-instance on-demand analysis underway:
  - adding a `ManagedInstanceAnalysisService` that reuses `Analyzer` + `ToolRegistry` against a selected managed instance
  - capturing a bounded recent log snapshot from the selected instance for tool-based analysis
  - exposing an operator-console route for on-demand analysis of the selected managed instance
  - preserving the background observer/Mattermost pipeline on the original configured external client for now
- Active diagnostic target routing underway:
  - adding a persisted `activeDiagnosticTarget` runtime-state field
  - adding a `DiagnosticTargetService` to validate and store `external` vs `managed_instance:<id>` selection
  - exposing operator-console API/UI hooks for inspecting and updating the active diagnostic target
  - routing the scheduled observer through a resolved active target each cycle
  - recording `lastObservedTarget` in runtime state and labeling history entries with the observed target
  - labeling periodic Mattermost reports with the observed target
  - emitting explicit degraded/unavailable reports with `healthScore=0` when the selected target cannot be resolved at cycle start
  - surfacing observer target/runtime state in the operator-console health endpoint and UI

## Key Decisions

- Use non-overlapping observer scheduling to avoid concurrent diagnostic cycles when analysis exceeds the configured interval.
- Keep proposal artifacts on disk under `/data` by default for operational visibility and reviewer access.
- Preserve test portability by injecting per-test temp `proposalDir` instead of writing to `/data` in test runs.
- For bundled source safety, preserve local git history for `git_blame` while stripping `origin` remote.
- Keep external rust-mule nodes observer-only, while allowing future controlled lifecycle actions only for mule-doctor-owned local test instances.
- Use a bounded `InstanceManager` as the future control plane rather than allowing the UI to shell out directly.
- Build `InstanceManager` in two steps: first metadata/path/port/config planning, then process lifecycle once rust-mule startup assumptions are verified.
- Port allocation in this phase guarantees non-overlap inside the managed-instance catalog only; probing host-level port availability is deferred until launch wiring.
- Managed-instance lifecycle should fail locally per instance and never take down mule-doctor as a whole.
- Managed-instance diagnostics should be selected-instance scoped first; do not jump directly to observing all managed instances concurrently until the per-instance client/session model is stable.
- Keep selected-instance analysis on-demand until target-aware observer scheduling and reporting semantics are explicitly designed.
- Active diagnostic target selection must persist in runtime state before the scheduled observer is rerouted.
- Scheduled observation should remain single-target even though the console can inspect many managed instances.
- Keep the existing external analyzer for Mattermost command handling, while the scheduled observer may construct target-specific analyzers/tool registries per cycle.

## Validation

- `npm run lint` passes.
- `npm run check` passes (typecheck + lint + build + full test suite).

## Next Steps

- Finish the active-target foundation slice:
  - review
  - merge
- Open the PR for active-target routing and process review feedback.
