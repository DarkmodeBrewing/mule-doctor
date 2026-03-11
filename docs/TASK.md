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

## Recommended Next Order

1. Task C: Runtime Readiness Validation
2. Task A: End-to-End Smoke Harness
3. Task B: Integration Coverage for rust-mule API Edge Cases
4. Task D: Operator Console Control Plane Completion
5. Task E: Runtime and Container Hardening
6. Task F: Release and CI Hardening
