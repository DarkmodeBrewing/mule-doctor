# Handoff

## Branch
- `feature/nonoverlap-observer-proposal-dir`
- PR: (pending)
- Last updated: 2026-03-06

## Status
- In progress; ready to open PR.
- This branch hardens observer scheduling and aligns `propose_patch` artifact storage with runtime `/data`.

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

## Key Decisions
- Use non-overlapping observer scheduling to avoid concurrent diagnostic cycles when analysis exceeds the configured interval.
- Keep proposal artifacts on disk under `/data` by default for operational visibility and reviewer access.
- Preserve test portability by injecting per-test temp `proposalDir` instead of writing to `/data` in test runs.

## Validation
- `npm run check` passes (typecheck + build + full test suite).

## Next Steps
- Open PR and process review feedback.
- After merge, continue end-to-end runtime validation once rust-mule stable release is available.
