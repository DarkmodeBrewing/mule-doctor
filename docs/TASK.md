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
   - unified selected-instance control pane for lifecycle, targeting, analysis, shared-content, and discoverability
   - selected-instance shared-content and discoverability controls
3. Managed local instance support:
   - `InstanceManager`
   - managed-instance diagnostics and analysis
   - active diagnostic target routing
   - preset groups and grouped lifecycle actions
4. Maintainability refactors:
   - operator-console server split into focused modules
   - operator-console frontend split into focused browser modules
   - 2026-03-23 follow-up pass reduced the remaining oversized operator-console files by splitting:
     - backend general API routes vs managed-instance/control routes
     - selected-instance rendering vs workflow/action orchestration
   - operator-console integration tests are now split into focused files plus shared fixtures/helpers
   - tool registry is split by tool domain and rust-mule client is split into request flow vs shared normalization/types helpers
   - observer loop is split into scheduling/orchestration vs shared helpers vs observed-search tracking
   - managed-instance operator-console routes are split into dispatcher vs collection/preset/discoverability routes vs per-instance routes
   - Mattermost integration is split into webhook/command transport vs payload-building and shared formatting helpers
   - managed-instance lifecycle orchestration is split from instance planning/runtime-path/config materialization helpers
   - managed-instance tests are split into planning/config vs lifecycle/reconciliation files with shared helpers
   - managed rust-mule config handling is split into shared contract/types, parser/validation, and TOML rendering modules behind a stable public entrypoint
   - operator-console general API routing is split into dispatcher, control/history routes, read-only log/runtime routes, and shared route context
   - source code tools are split into a thin coordinator plus shared contract helpers, filesystem/path operations, and git-blame parsing
   - rust-mule client tests are split into read-surface vs debug/write-path files with shared fetch/token helpers
   - observer tests are split into context/target behavior vs scheduler/control behavior with shared stubs
   - tool-registry tests are split by core/runtime/surface/source domains with shared stubs so the test surface mirrors the production registry split
   - operator-console managed-instance test stubs are split by lifecycle, diagnostics, workflows, and invocation/audit concerns behind a thin compatibility export
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
6. Human-triggered LLM hardening:
   - bounded prompt policy and evidence-first output shape
   - human-triggered rate limiting and concurrency guards
   - tool-round, tool-count, and duration budgets
   - invocation audit metadata and operator-console visibility

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

Current status:

- runtime/container contract docs have been aligned with the shipped image, entrypoint, readiness checks, and smoke flow
- startup now fails early for misconfigured source paths and missing managed-instance rust-mule binaries
- `entrypoint.sh` now waits for a readable, non-empty token file before mule-doctor starts
- remaining work here should be incremental follow-ups, not the next main delivery track

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

Current status:

- PRs now validate the Docker/compose build path in a dedicated workflow so container regressions surface before merge
- PR CI also validates the packaged runtime image layout and metadata so release-image drift is caught before merge
- pushes to `main` now rerun the fast check suite and Docker validation so the mainline release path is continuously revalidated
- smoke-harness contract tests now cover generated files and failure diagnostics without depending on a live I2P/SAM-backed rust-mule runtime
- `entrypoint.sh` and `container-healthcheck.sh` now have script-level contract coverage for token wait behavior, process/pid assumptions, and authenticated readiness checks
- full `npm run smoke:docker` runtime validation remains environment-specific because rust-mule needs an available SAM/I2P dependency and is not portable to GitHub-hosted runners
- remaining Task F work should focus on release-oriented validation and any additional high-value integration coverage beyond `npm run check` plus Docker build validation

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

Current status:

- controlled discoverability checks already persist lifecycle-style search health records with dispatch readiness, peer context, state samples, and terminal outcomes
- controlled discoverability now also records an immediate active lifecycle entry at search dispatch, before the polling loop reaches a terminal result
- managed-instance surface diagnostics now also persist deduplicated observed search lifecycle records for active and terminal keyword searches
- observer cycles now also persist deduplicated observed search lifecycle records for the active diagnostic target, including externally configured targets
- operator console manual keyword search dispatch now records first-class lifecycle entries against the selected managed instance or active diagnostic target
- remaining work should focus on refining search-lifecycle context richness for non-controlled searches and tightening any remaining operator workflows that should emit or surface search lifecycle state more directly

## Task K: Expose Keyword Search and Publish Status as First-Class Diagnostics

Status: complete for current scope. The operator console now exposes a structured managed-instance runtime-surface view via `/api/instances/{id}/runtime_surface`, the compare panel can contrast current search/publish/download state across two managed instances while keeping historical search-health views separate, and the missing upstream publish-job surface is now documented explicitly instead of being implied.

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

Current status:

- mule-doctor now enforces the managed config ownership boundary in code instead of only documenting it
- conflicting template keys for mule-doctor-owned settings are rejected explicitly during config rendering
- the generated `config.toml` header now lists mule-doctor-owned keys, externally managed template keys, and explicitly rejected conflicting keys
- mule-doctor now also accepts one bounded operator-facing input surface for this contract via `MULE_DOCTOR_MANAGED_RUST_MULE_CONFIG_TEMPLATE_JSON`
- remaining work should focus on whether any additional operator ergonomics are needed beyond the current template object plus bounded JSON env input

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

## Task M: Harden Human-Triggered LLM Invocation Boundaries

Status: substantially landed on `main` on 2026-03-17. Remaining follow-up should be treated as refinement and doc alignment rather than a greenfield feature slice.

1. Add explicit rate limiting and concurrency guards for all human-triggered LLM entry points:
   - Mattermost command handling
   - operator-console managed-instance analysis
   - any manual observer-trigger path that results in `Analyzer.analyze(...)`
2. Keep scheduled observer analysis separately governed from human-triggered analysis so operator abuse or mistakes cannot starve normal periodic diagnostics.
3. Return clear, structured rejection behavior when a limit is hit:
   - surface-specific cooldown
   - target-specific cooldown where applicable
   - `retry_after` style guidance for API/UI clients
4. Keep each LLM invocation bounded even after it starts:
   - explicit max tool-call rounds
   - optional max total tool calls
   - optional max wall-clock duration
   - clear incomplete/budget-exhausted outcomes
5. Harden prompt construction across all LLM invocation surfaces:
   - replace vague instructions like "use all available tools"
   - require evidence-based conclusions
   - distinguish confirmed issues, probable issues, and hypotheses
   - instruct the model to start from supplied snapshot/context before calling tools
   - make tool-budget expectations explicit in the prompt itself
6. Restrict tool exposure by invocation surface:
   - narrower tool sets for Mattermost status/peer queries
   - explicit separation between routine runtime analysis tools and source/patch-oriented tools
   - avoid exposing broader tools where the surface does not need them
7. Add stronger runtime guards around each invocation:
   - max wall-clock duration
   - timeout/cancellation handling
   - explicit finish reasons for timeout, rate-limit, unavailable target, and budget exhaustion
8. Improve output handling:
   - require a more structured response shape
   - validate or normalize key sections before returning/posting results
   - redact sensitive content again before sending responses to UI or Mattermost
9. Add invocation audit metadata:
   - surface
   - target
   - model
   - prompt/policy version
   - tool count
   - completion/finish reason
   - rate-limit or budget-limit hits
10. Review prompt inputs and tool outputs for secret/path leakage and reduce what is sent to the model when it is not needed.
11. Ensure the human-triggered limiter is applied at the invocation boundaries rather than buried inside the analyzer implementation.
12. Document the active policy and its scope in the runtime/API docs.

Acceptance criteria:

- repeated human-triggered analysis requests cannot spam the OpenAI API
- the same instance or target cannot be analyzed concurrently through overlapping manual requests
- a single LLM invocation cannot loop through tool calls indefinitely
- prompts consistently push the model toward bounded, evidence-based analysis instead of broad exploratory tool use
- each invocation surface only exposes the tools it actually needs
- analysis runs end with explicit, inspectable reasons when they time out or hit policy limits
- returned LLM output is more structured and less likely to leak sensitive context
- invocation metadata is recorded well enough to audit usage and regressions
- scheduled observer analysis remains isolated from human-triggered rate limits
- UI/API and Mattermost users receive clear feedback when analysis is temporarily rate-limited

## Recommended Next Order

1. Task F: Release and CI Hardening
2. Task J: Track Full Search Lifecycle and Search Health Signals
3. Task E: Runtime and Container Hardening follow-up cleanup only
