# Handoff

## Branch
- `main` (current integrated state)
- Last merged PR: https://github.com/DarkmodeBrewing/mule-doctor/pull/15
- Last updated: 2026-03-06

## Status
- PR #15 is merged into `main` (merge commit: `394882361f688159d7842c4d66242613a9ebf5aa`).
- Observer scheduling + source proposal artifact path/runtime tooling changes are integrated.
- Current phase is runtime validation against a stable rust-mule release window.

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

## Key Decisions
- Use non-overlapping observer scheduling to avoid concurrent diagnostic cycles when analysis exceeds the configured interval.
- Keep proposal artifacts on disk under `/data` by default for operational visibility and reviewer access.
- Preserve test portability by injecting per-test temp `proposalDir` instead of writing to `/data` in test runs.
- For bundled source safety, preserve local git history for `git_blame` while stripping `origin` remote.

## Validation
- `npm run check` passes (typecheck + build + full test suite).

## Next Steps
- Run end-to-end validation with a stable rust-mule release once available (debug endpoints, token flows, observer/report loop).
- Execute containerized smoke run (`docker compose`) with mounted `/data` and confirm persisted artifacts/state behavior.
- Continue backlog from `docs/TASK.md` based on validation findings and any upstream rust-mule API changes.
