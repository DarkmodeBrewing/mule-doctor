# Handoff

## Branch

- `feature/openai-sdk-client`
- PR: (pending)
- Last updated: 2026-03-08

## Status

- In progress; branch migrates OpenAI integration from raw HTTP `fetch` to the official OpenAI SDK client.
- Prior lint/format/tooling hardening from PR #18 remains merged in `main`.

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

## Key Decisions

- Use non-overlapping observer scheduling to avoid concurrent diagnostic cycles when analysis exceeds the configured interval.
- Keep proposal artifacts on disk under `/data` by default for operational visibility and reviewer access.
- Preserve test portability by injecting per-test temp `proposalDir` instead of writing to `/data` in test runs.
- For bundled source safety, preserve local git history for `git_blame` while stripping `origin` remote.

## Validation

- `npm run lint` passes.
- `npm run check` passes (typecheck + lint + build + full test suite).

## Next Steps

- Open PR for OpenAI SDK migration and process review feedback.
- After merge, continue deferred runtime validation tasks documented in `docs/TASK.md`.
