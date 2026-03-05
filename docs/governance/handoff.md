# Handoff

## Branch
- `feature/phase5-source-tools`
- PR: (to be created)
- Last updated: 2026-03-05

## Status
- Phase 5 architecture implementation is in progress.
- This branch adds source-code tooling behind `RUST_MULE_SOURCE_PATH` with path sandboxing and proposal-only patch behavior.

## Completed Work
- Added `src/tools/sourceCodeTools.ts`:
  - `searchCode(query)` literal match search across bounded source files.
  - `readFile(path)` bounded read of source files within configured root.
  - `showFunction(name)` signature lookup for Rust and JS/TS function definitions.
  - `proposePatch(diff)` stores proposal artifact under `.mule-doctor/proposals` and never applies.
  - `gitBlame(file, line)` returns structured commit/author metadata using `git blame --porcelain`.
- Added strict path safety controls:
  - relative-path-only inputs for file-based tools.
  - path traversal prevention (`..`/absolute path rejection).
  - symlink/realpath boundary checks to keep reads/blame inside source root.
- Extended `src/tools/toolRegistry.ts`:
  - new optional `sourcePath` option.
  - architecture tool names added when source path is configured:
    - `search_code`
    - `read_file`
    - `show_function`
    - `propose_patch`
    - `git_blame`
- Updated startup config wiring in `src/index.ts`:
  - reads `RUST_MULE_SOURCE_PATH` and enables source tools only when set.
- Added tests:
  - `src/sourceCodeTools.test.mjs` (proposal artifact behavior, git blame metadata, bounded file reads).
  - expanded `src/toolRegistry.test.mjs` for source tool gating, source tool contract behavior, and traversal rejection.
- Updated docs/config:
  - `.env.example` with `RUST_MULE_SOURCE_PATH`.
  - `README.md` documenting source-tool enablement, scope, and safety.

## Key Decisions
- Source code tools are opt-in and disabled by default unless `RUST_MULE_SOURCE_PATH` is configured.
- All source file access is sandboxed to the configured source root to avoid filesystem escape.
- `propose_patch` is artifact-only (no automatic write/apply to target source files).

## Validation
- `npm run check` passed on this branch:
  - TypeScript no-emit typecheck passed
  - Tests passed (`37/37`)

## Next Steps
- Open PR for Phase 5 source tools implementation.
- Start Phase 8 (runtime/container layout alignment) after Phase 5 merges.
- Phase 9 follow-up task remains: add GitHub Actions PR CI workflow (`pull_request` on `main`) running `npm ci` and `npm run check`.
