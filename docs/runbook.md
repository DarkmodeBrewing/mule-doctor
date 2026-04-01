# mule-doctor Runbook

This runbook is the operator-oriented guide for starting and validating `mule-doctor`.

Use it when you want to:

- attach mule-doctor to an existing `rust-mule`
- run the bundled container stack
- enable the operator console
- validate that the runtime is healthy before deeper testing

For the full variable reference, see [configuration.md](./configuration.md).

## Prerequisites

### Local / host run

- Node `>=20.19.0`
- npm
- a working `rust-mule` node
- the `rust-mule` API token path
- the `rust-mule` log path
- `OPENAI_API_KEY`
- `MATTERMOST_WEBHOOK_URL`

### Container run

- Docker with `docker compose`
- a host `/data` path writable by `1000:1000`
- an environment where `rust-mule` can actually become ready if you want a full end-to-end runtime test

## Choose a Run Mode

The two normal run modes are:

1. Attach mule-doctor to an existing `rust-mule`
2. Run the bundled container stack

If you want the fastest practical path, start with the first one.

## Run Locally Against an Existing rust-mule

From the repository root:

```bash
cd /workspace/mule-doctor
cp .env.example .env
```

Set the minimum required variables:

```bash
RUST_MULE_API_URL=http://127.0.0.1:17835
RUST_MULE_API_PREFIX=/api/v1
RUST_MULE_LOG_PATH=/absolute/path/to/rust-mule.log
RUST_MULE_TOKEN_PATH=/absolute/path/to/api.token
OPENAI_API_KEY=...
MATTERMOST_WEBHOOK_URL=...
```

Recommended optional settings:

```bash
RUST_MULE_DEBUG_TOKEN_FILE=/absolute/path/to/debug.token
RUST_MULE_SOURCE_PATH=/absolute/path/to/rust-mule/source
MULE_DOCTOR_UI_ENABLED=true
MULE_DOCTOR_UI_AUTH_TOKEN=choose-a-token
MULE_DOCTOR_UI_HOST=127.0.0.1
MULE_DOCTOR_UI_PORT=18080
```

Install and start:

```bash
npm install
npm run build
set -a; source .env; set +a
npm run start
```

Expected behavior:

- startup validates environment variables and writable runtime paths
- mule-doctor loads the rust-mule token
- the observer loop starts
- if the UI is enabled, the operator console is available at `http://127.0.0.1:18080/`

## Run the Bundled Container Stack

From the repository root:

```bash
cd /workspace/mule-doctor
cp .env.example .env
```

Set at least:

```bash
OPENAI_API_KEY=...
MATTERMOST_WEBHOOK_URL=...
MULE_DOCTOR_UI_ENABLED=true
MULE_DOCTOR_UI_AUTH_TOKEN=choose-a-token
MULE_DOCTOR_UI_HOST=0.0.0.0
MULE_DOCTOR_UI_PORT=18080
```

Important runtime note:

- `docker-compose.yml` bind-mounts `./data:/data`
- the image runs as `node` with UID/GID `1000:1000`
- the host `./data` path should be writable by `1000:1000`

Prepare the bind mount if needed:

```bash
mkdir -p data
sudo chown -R 1000:1000 data
```

Start the stack:

```bash
docker compose up --build
```

Default ports:

- rust-mule API: `17835`
- mule-doctor UI: `18080`

Expected container sequence:

1. `entrypoint.sh` starts `rust-mule`
2. it waits for a readable non-empty token file
3. it exports `RUST_MULE_TOKEN_PATH`
4. it starts mule-doctor

## Operator Console

When enabled:

- open `/`
- authenticate with `MULE_DOCTOR_UI_AUTH_TOKEN`

Current console capabilities include:

- health, logs, and operator-event inspection
- mule-doctor-managed instance lifecycle actions
- target selection
- managed-instance analysis
- controlled discoverability checks
- manual keyword search launch
- runtime-surface inspection
- search-health history with filters for source, outcome, dispatch readiness, and target/instance

## Managed Instance Setup

If you want mule-doctor to create and run local managed `rust-mule` nodes, set these as needed:

```bash
MULE_DOCTOR_MANAGED_RUST_MULE_BINARY_PATH=/absolute/path/to/rust-mule
MULE_DOCTOR_MANAGED_INSTANCE_ROOT=/data/instances
MULE_DOCTOR_MANAGED_API_PORT_START=19000
MULE_DOCTOR_MANAGED_API_PORT_END=19999
```

Optional managed config template:

```bash
MULE_DOCTOR_MANAGED_RUST_MULE_CONFIG_TEMPLATE_JSON='{
  "sam": { "host": "127.0.0.1", "forwardHost": "127.0.0.1" },
  "general": { "logLevel": "info" },
  "api": { "authMode": "headless_remote" }
}'
```

Important ownership rule:

- mule-doctor owns per-instance `sam.session_name`, `general.data_dir`, `general.auto_open_ui`, and `api.port`
- conflicting values are rejected

## Validation Commands

Fast project validation:

```bash
npm run check
```

Environment-backed container smoke validation:

```bash
npm run smoke:docker
```

Use `npm run smoke:docker` only when the environment can actually let `rust-mule` become ready. It is not a portable substitute for hosted CI.

## First Real Validation Pass

Recommended first practical validation:

1. Run mule-doctor against one existing `rust-mule`
2. Enable the UI
3. Confirm `/api/health` works
4. Let one observer cycle complete
5. Check:
   - app logs
   - rust-mule logs
   - operator events
   - search-health history
6. Only then move on to managed instances and controlled discoverability

## Troubleshooting

### Local run fails at startup

Check:

- `RUST_MULE_TOKEN_PATH` exists and is readable
- `RUST_MULE_LOG_PATH` parent directory exists
- `RUST_MULE_API_URL` is reachable
- `rust-mule` is actually ready, not just running

### Container run fails with `/data` permissions

Fix the host bind-mount ownership:

```bash
sudo chown -R 1000:1000 data
```

### UI is not reachable

Check:

- `MULE_DOCTOR_UI_ENABLED=true`
- `MULE_DOCTOR_UI_AUTH_TOKEN` is set
- local run uses the expected host/port
- container run uses `MULE_DOCTOR_UI_HOST=0.0.0.0`

### Full smoke does not complete

Check:

- Docker is installed and `docker compose` works
- the environment can bind the requested ports
- the backing environment provides the SAM/I2P dependency that `rust-mule` needs to reach readiness

## Related Docs

- [README.md](../README.md)
- [configuration.md](./configuration.md)
- [api.md](./api.md)
- [architecture/mule-doctor.md](./architecture/mule-doctor.md)
