# mule-doctor Implementation Task Plan

Source of truth: `docs/architecture/mule-doctor.md`.

This document tracks the remaining implementation backlog from the current `main` baseline.
Completed work is intentionally not repeated here except where it clarifies scope boundaries for follow-on tasks.

## Current Baseline

The following major slices are already landed on `main`:

1. Core architecture alignment work:
   - persisted runtime state/history
   - health scoring
   - structured tool results
   - source-code tools
   - Mattermost attachments
   - LLM usage tracking
   - architecture document alignment
2. Operator console foundation:
   - authenticated UI and API
   - log/proposal inspection
   - scheduler/runtime health visibility
   - operator event timeline
   - cluster/group/compare navigation shortcuts
   - timeline context feedback
3. Managed local instance support:
   - `InstanceManager`
   - managed-instance diagnostics and analysis
   - active diagnostic target routing
   - preset groups and grouped lifecycle actions
4. Maintainability refactors:
   - operator-console server split into focused modules
   - operator-console frontend split into focused browser modules
   - tests consolidated under `src/test/`
   - Alpine.js evaluated and explicitly deferred

## Goals

1. Keep externally managed rust-mule nodes strictly observer/advisor scope.
2. Evolve mule-doctor-managed local instances into a bounded, explicit control plane.
3. Improve operational confidence with stronger runtime validation, smoke coverage, and API edge-case coverage.
4. Keep implementation and architecture docs aligned as the system evolves.

## Outstanding Tasks

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

1. Add startup/readiness validation for runtime prerequisites:
   - required env vars
   - token and debug-token file paths
   - config file presence where required
   - writable `/data` subpaths
2. Fail fast with explicit operator-facing diagnostics when prerequisites are missing.
3. Document the readiness contract alongside runtime configuration.

Acceptance criteria:

- Startup failures surface concrete missing prerequisites.
- Operational setup issues are identified before the observer loop begins.
- The readiness contract is documented clearly enough for operators to self-diagnose setup errors.

## Task D: Operator Console Control Plane Completion

1. Extend the operator console from observability-first into the bounded control surface for mule-doctor-managed local instances.
2. Review the remaining lifecycle/control gaps in the current UI/API and close the highest-value ones first.
3. Preserve explicit safety boundaries so external nodes remain observer-only.
4. Keep control semantics deterministic and auditable through the existing runtime state and operator event timeline.

Acceptance criteria:

- Operators can manage mule-doctor-owned local instances from the console without shell access.
- Each managed instance remains clearly labeled and independently observable.
- Control actions cannot be applied to externally managed targets.

## Task E: Runtime and Container Hardening

1. Recheck the live container/runtime layout against `docs/architecture/mule-doctor.md`.
2. Add or tighten startup/entrypoint behavior where the architecture and runtime still differ.
3. Document production/runtime dependencies and any remaining operational assumptions.

Acceptance criteria:

- Container boots reliably in the documented layout.
- Runtime assumptions are explicit rather than implicit in scripts or code.
- Operators can follow the documented runtime contract without source inspection.

## Task F: Release and CI Hardening

1. Keep the PR workflow aligned with the current repository checks.
2. Expand automation where it materially reduces regression risk:
   - smoke validation
   - integration coverage
   - release-oriented validation
3. Ensure failures surface early and clearly in CI.

Acceptance criteria:

- CI covers the checks the project actually relies on.
- Regression detection happens before merge for the critical runtime paths.
- Release validation is repeatable rather than ad hoc.

## Task G: Align rust-mule Readiness Handling with the New 200/ready Contract

1. Update mule-doctor to treat rust-mule readiness as explicit payload state rather than HTTP `503`/`504` responses.
2. Review and correct all current readiness assumptions, including:
   - the Docker smoke harness
   - `RustMuleClient` fallback/recoverable-error logic
   - observer-cycle behavior when rust-mule responds with `ready: false`
   - docs that still describe readiness as HTTP-status-based
3. Incorporate the current rust-mule readiness signals:
   - `GET /api/v1/health == 200`
   - `GET /api/v1/status == 200`
   - `/api/v1/status.ready == true`
   - `/api/v1/searches.ready == true`
4. Decide and document the intended mule-doctor behavior when rust-mule is reachable but not ready:
   - block startup-sensitive flows such as smoke validation until ready
   - degrade observer behavior gracefully with explicit unavailable/not-ready state where appropriate

Acceptance criteria:

- mule-doctor no longer depends on upstream `503`/`504` readiness semantics.
- smoke validation waits for the new readiness contract instead of HTTP `200` alone.
- observer/runtime behavior is explicit and documented for `ready: false` upstream states.
- implementation and docs both reflect the new rust-mule readiness model.

## Task H: Add Controlled Search Discoverability Checks for Managed Instances

1. Teach mule-doctor to run controlled search checks between mule-doctor-managed local rust-mule instances instead of relying on random public-network keyword searches.
2. Start with the highest-signal scenario:
   - instance A shares a known file
   - instance B searches for a distinctive keyword derived from that file
   - mule-doctor repeats the search for a bounded window until found or timed out
3. Use readiness-gated dispatch so search checks only start after:
   - `GET /api/v1/health == 200`
   - `GET /api/v1/status == 200`
   - `/api/v1/status.ready == true`
   - `/api/v1/searches.ready == true`
4. Treat “random public-network keyword search” as a secondary signal only, not the primary health check.
5. Base the check on the current rust-mule share/publish workflow:
   - managed instance A exposes a known file through `sharing.share_roots`
   - rust-mule indexes and publishes it
   - managed instance B searches for a distinctive keyword derived from that controlled fixture

Acceptance criteria:

- mule-doctor can execute a repeatable controlled discoverability check between managed instances.
- search checks do not dispatch before the upstream readiness contract is satisfied.
- the first-class search health path is based on known shared content, not opportunistic public-network results.

## Task I: Track Full Search Lifecycle and Search Health Signals

1. Add explicit search-lifecycle tracking around rust-mule keyword searches, including:
   - query text
   - search ID
   - dispatch time
   - readiness state at dispatch
   - state transitions
   - result count
   - terminal outcome such as `completed_found`, `completed_empty`, or `timed_out`
2. Capture correlated transport/network context alongside each search attempt, including:
   - live peer count
   - degraded SAM/KAD indicators where available
3. Persist or expose this data in a way that mule-doctor can use for diagnostics, reporting, and future operator-console visibility.

Acceptance criteria:

- mule-doctor can explain not just that a search failed, but whether it was dispatched too early, completed empty, timed out, or ran under degraded transport conditions.
- search attempts have enough structured context to compare propagation behavior over time.
- search health becomes a first-class diagnostic signal rather than an ad hoc log observation.

## Task J: Expose Keyword Search and Publish Status as First-Class Diagnostics

1. Use the current rust-mule endpoints as the basis for publish/search observability:
   - `GET /api/v1/searches`
   - `GET /api/v1/searches/{search_id}`
   - `GET /api/v1/shared`
   - `GET /api/v1/shared/actions`
2. Add mule-doctor-side summaries that distinguish:
   - active keyword searches
   - per-file keyword publish status
   - background republish/reindex actions
3. Include the current download surface as a parallel diagnostic input:
   - `GET /api/v1/downloads`
   - queue-level health
   - per-download state, progress, source count, retry, and error information
4. Avoid treating shared-library publish fields as if they were a dedicated “active publish jobs” API; document the current gap explicitly.
5. Make the missing upstream publish-job surface visible in mule-doctor’s architecture/backlog so the limitation is tracked instead of hidden.

Acceptance criteria:

- mule-doctor can report the current search, publish, and download-related signals available from rust-mule without conflating them.
- operators and future LLM diagnostics can tell which information comes from active searches, shared-file publish state, shared-action jobs, and download state.
- the lack of a first-class upstream keyword-publish job endpoint is documented as a real dependency/gap.

## Task K: Add LLM Investigation Tools for Downloads, Searches, and Keyword Publish State

1. Extend the LLM tool surface with bounded investigation tools for rust-mule search/download workflows.
2. Start with explicit tools for the currently known upstream surfaces:
   - active keyword searches
   - per-search detail
   - shared-file keyword publish state
   - shared action jobs such as reindex / republish
   - download status from `GET /api/v1/downloads`
3. Normalize the most important fields for LLM use instead of exposing raw upstream payloads only, including:
   - ID
   - query or target
   - state
   - timing fields
   - result count
   - terminal outcome
   - error detail
4. Preserve the bounded-tool model:
   - no generic arbitrary API passthrough
   - only named, documented, test-covered investigation tools

Acceptance criteria:

- the LLM can inspect search, publish, shared-action, and download-related state through dedicated mule-doctor tools.
- tool outputs are normalized enough for reliable diagnostics without requiring the model to reverse-engineer raw rust-mule payloads each time.
- the new tools are documented alongside the existing LLM tool surface.

## Task L: Formalize Managed rust-mule config.toml Template Ownership

1. Turn the current managed-instance config generation into an explicit ownership model for per-instance `config.toml` files.
2. Preserve the existing split of responsibility:
   - externally supplied base/template values provide shared network/runtime settings such as `sam.host` and `sam.forward_host`
   - mule-doctor-owned values are always generated per instance, including:
     - `sam.session_name`
     - `general.data_dir`
     - `api.port`
3. Define and document which config keys are:
   - externally managed
   - mule-doctor managed
   - rejected or overwritten when they conflict with mule-doctor-owned runtime isolation
4. Improve the template/input contract so it scales cleanly as more rust-mule config fields need to be supplied before launch.

Acceptance criteria:

- each managed instance continues to get its own generated `config.toml`
- shared base/template values can be supplied before launch for fields mule-doctor does not own
- mule-doctor-owned per-instance values remain isolated and deterministic
- the config ownership boundary is documented clearly enough that operators know what to set externally and what mule-doctor will always control

## Recommended Next Order

1. Task G: Align rust-mule Readiness Handling with the New 200/ready Contract
2. Task H: Add Controlled Search Discoverability Checks for Managed Instances
3. Task I: Track Full Search Lifecycle and Search Health Signals
4. Task J: Expose Keyword Search and Publish Status as First-Class Diagnostics
5. Task K: Add LLM Investigation Tools for Downloads, Searches, and Keyword Publish State
6. Task L: Formalize Managed rust-mule config.toml Template Ownership
7. Task D: Operator Console Control Plane Completion
8. Task E: Runtime and Container Hardening
9. Task F: Release and CI Hardening
