# Handoff

## Branch

- `feature/docs-operator-observability-console`
- PR: (pending)
- Last updated: 2026-03-08

## Status

- Documentation update branch to capture next-phase operator observability work.
- PR #20 is merged to `main` (security/reliability hardening complete).

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

## Key Decisions

- Use non-overlapping observer scheduling to avoid concurrent diagnostic cycles when analysis exceeds the configured interval.
- Keep proposal artifacts on disk under `/data` by default for operational visibility and reviewer access.
- Preserve test portability by injecting per-test temp `proposalDir` instead of writing to `/data` in test runs.
- For bundled source safety, preserve local git history for `git_blame` while stripping `origin` remote.

## Validation

- `npm run lint` passes.
- `npm run check` passes (typecheck + lint + build + full test suite).

## Next Steps

- Open and merge documentation PR for `Task D` observability console planning.
- Start implementation in a feature branch once approved.
