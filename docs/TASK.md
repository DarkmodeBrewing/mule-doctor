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
5. Runtime and search/discoverability groundwork:
   - runtime readiness validation and readiness-contract alignment
   - Docker smoke harness for local/manual stack checks
   - rust-mule API edge-case coverage
   - managed shared-content orchestration primitives
   - controlled discoverability checks between managed instances
   - discoverability persistence, summary, operator-console visibility, and Mattermost reporting
   - bounded LLM tools for discoverability, searches, shared content, and downloads

## Goals

1. Keep externally managed rust-mule nodes strictly observer/advisor scope.
2. Evolve mule-doctor-managed local instances into a bounded, explicit control plane.
3. Improve operational confidence with stronger runtime validation, smoke coverage, and API edge-case coverage.
4. Keep implementation and architecture docs aligned as the system evolves.

## Outstanding Tasks

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

## Task J: Track Full Search Lifecycle and Search Health Signals

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

## Task K: Expose Keyword Search and Publish Status as First-Class Diagnostics

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

1. Task J: Track Full Search Lifecycle and Search Health Signals
2. Task K: Expose Keyword Search and Publish Status as First-Class Diagnostics
3. Task L: Formalize Managed rust-mule config.toml Template Ownership
4. Task D: Operator Console Control Plane Completion
5. Task E: Runtime and Container Hardening
6. Task F: Release and CI Hardening
