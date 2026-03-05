# Handoff

## Branch
- `feature/phase8-runtime-layout`
- PR: https://github.com/DarkmodeBrewing/mule-doctor/pull/12
- Last updated: 2026-03-05

## Status
- Phase 8 runtime/container layout alignment is in progress.
- This branch aligns runtime paths, startup behavior, and production docs with architecture.

## Completed Work
- Reworked `Dockerfile` to architecture layout:
  - builds rust-mule under `/opt/rust-mule` (configurable repo/ref build args).
  - builds mule-doctor under `/app`.
  - provisions `/data` runtime paths and volume mount.
  - sets container-default runtime env paths (`RUST_MULE_*`, `MULE_DOCTOR_*`).
- Added `entrypoint.sh`:
  - starts rust-mule with `/data/config.toml`.
  - waits for token file before launching mule-doctor.
  - supervises both processes and forwards shutdown.
- Added `.dockerignore` to reduce build context noise.
- Updated `README.md` with container runtime layout, startup flow, and production dependencies.

## Key Decisions
- Use architecture-consistent absolute runtime paths (`/opt/rust-mule`, `/app`, `/data`) as container defaults.
- Keep startup orchestration in entrypoint so rust-mule and mule-doctor are coupled in one container process model.
- Use `/data` as persisted runtime source for config/token/log/state.

## Validation
- `npm run check` passed on this branch:
  - TypeScript no-emit typecheck passed
  - Tests passed (`42/42`)

## Next Steps
- Open PR for Phase 8 runtime/container layout alignment.
- Start Phase 9 hardening:
  - PR CI workflow (`pull_request` on `main`) running `npm ci` + `npm run check`.
  - additional integration/smoke hardening tasks.
- Phase 9 follow-up task remains: add GitHub Actions PR CI workflow (`pull_request` on `main`) running `npm ci` and `npm run check`.
