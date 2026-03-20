# mule-doctor Configuration Reference

This document is the runtime configuration reference for mule-doctor.

It covers:

- mule-doctor application environment variables
- container entrypoint environment variables
- managed-instance configuration generation
- required, optional, and derived runtime values

Primary implementation sources:

- [index.ts](../src/index.ts)
- [entrypoint.sh](../entrypoint.sh)
- [instanceManager.ts](../src/instances/instanceManager.ts)
- [rustMuleConfig.ts](../src/instances/rustMuleConfig.ts)

## Configuration Layers

There are three distinct configuration layers:

1. mule-doctor application configuration
   - environment variables read by `src/index.ts`
2. container entrypoint configuration
   - environment variables read by `entrypoint.sh`
3. managed rust-mule instance configuration
   - per-instance generated `config.toml` files created by mule-doctor

These layers overlap, but they are not the same thing.

## 1. mule-doctor Application Environment

These variables are read directly by [index.ts](../src/index.ts).

### Required

| Variable | Purpose |
| --- | --- |
| `RUST_MULE_API_URL` | Base URL of the upstream rust-mule API |
| `RUST_MULE_LOG_PATH` | Path to the rust-mule log file mule-doctor tails |
| `RUST_MULE_TOKEN_PATH` | Path to the rust-mule bearer-token file |
| `OPENAI_API_KEY` | OpenAI API key for the analyzer |
| `MATTERMOST_WEBHOOK_URL` | Mattermost incoming webhook for reports |

### Optional rust-mule access

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUST_MULE_API_PREFIX` | `/api/v1` | API prefix used against rust-mule |
| `RUST_MULE_DEBUG_TOKEN_FILE` | unset | Optional debug-token file for rust-mule debug endpoints |
| `RUST_MULE_SOURCE_PATH` | unset | Optional source root for source-inspection tools |

Notes:

- when `RUST_MULE_SOURCE_PATH` is configured, mule-doctor startup now validates that it resolves to an existing accessible directory before source tools are wired

### Optional observer/runtime behavior

| Variable | Default | Purpose |
| --- | --- | --- |
| `OBSERVE_INTERVAL_MS` | `300000` | Observer interval in milliseconds |
| `OPENAI_MODEL` | `gpt-5-mini` | Model used by the analyzer |

### Optional persistence and data paths

| Variable | Default | Purpose |
| --- | --- | --- |
| `MULE_DOCTOR_DATA_DIR` | `/data/mule-doctor` | Base mule-doctor runtime data directory |
| `MULE_DOCTOR_STATE_PATH` | `/data/mule-doctor/state.json` | Persisted runtime-state file |
| `MULE_DOCTOR_HISTORY_PATH` | `/data/mule-doctor/history.json` | Persisted history file |
| `MULE_DOCTOR_HISTORY_LIMIT` | `500` | Max retained history entries |
| `MULE_DOCTOR_LLM_LOG_DIR` | `MULE_DOCTOR_DATA_DIR` | Directory for `LLM_*.log` files |

Derived path:

- proposal artifacts are written under `${MULE_DOCTOR_DATA_DIR}/proposals`

### Optional operator console

| Variable | Default | Purpose |
| --- | --- | --- |
| `MULE_DOCTOR_UI_ENABLED` | `false` | Enable built-in operator console |
| `MULE_DOCTOR_UI_AUTH_TOKEN` | required when UI enabled | Token protecting UI and `/api/*` routes |
| `MULE_DOCTOR_UI_HOST` | `127.0.0.1` | Bind host for the operator console |
| `MULE_DOCTOR_UI_PORT` | `18080` | Bind port for the operator console |
| `MULE_DOCTOR_UI_LOG_BUFFER_LINES` | `2000` | In-memory app-log buffer size for UI/SSE |

Notes:

- if `MULE_DOCTOR_UI_ENABLED=true`, `MULE_DOCTOR_UI_AUTH_TOKEN` becomes required
- in containers, use `MULE_DOCTOR_UI_HOST=0.0.0.0` if host access is required

### Optional usage-cost model

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_INPUT_COST_PER_1K` | `0` | Optional USD cost per 1K input tokens |
| `OPENAI_OUTPUT_COST_PER_1K` | `0` | Optional USD cost per 1K output tokens |

### Optional managed-instance controller

These variables control mule-doctor's local managed rust-mule instances.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MULE_DOCTOR_MANAGED_RUST_MULE_BINARY_PATH` | unset | Explicit rust-mule binary path for managed instances |
| `MANAGED_RUST_MULE_BINARY_PATH` | unset | Legacy alias for managed rust-mule binary path |
| `MULE_DOCTOR_MANAGED_INSTANCE_ROOT` | `/data/instances` | Root directory for managed-instance runtime trees |
| `MULE_DOCTOR_MANAGED_API_PORT_START` | `19000` | Start of allowed API-port range for managed instances |
| `MULE_DOCTOR_MANAGED_API_PORT_END` | `19999` | End of allowed API-port range for managed instances |

Notes:

- if no managed binary path is supplied, `InstanceManager` falls back to `rust-mule` on `PATH`
- managed-instance support is initialized best-effort; mule-doctor can continue running without it if setup fails
- when managed-instance control initializes, mule-doctor now validates that the selected rust-mule launch binary is executable or resolvable on `PATH`

## 2. Container Entrypoint Environment

These variables are read by [entrypoint.sh](../entrypoint.sh).

| Variable | Default | Purpose |
| --- | --- | --- |
| `RUST_MULE_BIN` | `/opt/rust-mule/target/release/rust-mule` | rust-mule binary launched by the container |
| `RUST_MULE_CONFIG` | `/data/config.toml` | rust-mule config file passed to `--config` |
| `RUST_MULE_TOKEN_PATH` | `/data/token` | Token file path the entrypoint waits for before starting mule-doctor |
| `RUST_MULE_LOG_PATH` | `/data/logs/rust-mule.log` | Log file rust-mule writes to in the container |
| `RUST_MULE_EXTRA_ARGS` | empty | Additional rust-mule CLI arguments |
| `TOKEN_WAIT_TIMEOUT_SEC` | `120` | Timeout waiting for the token file |
| `RUST_MULE_PID_FILE` | `/tmp/rust-mule.pid` | PID file written for the rust-mule container process |
| `MULE_DOCTOR_PID_FILE` | `/tmp/mule-doctor.pid` | PID file written for the mule-doctor container process |

Entrypoint behavior:

1. ensures runtime directories exist
2. validates:
   - rust-mule binary is executable
   - `RUST_MULE_CONFIG` exists
   - `RUST_MULE_CONFIG` is readable
3. starts rust-mule
4. waits for the rust-mule token file at `RUST_MULE_TOKEN_PATH`
5. exports `RUST_MULE_TOKEN_PATH`
6. starts mule-doctor

The entrypoint also creates parent directories for `RUST_MULE_PID_FILE` and `MULE_DOCTOR_PID_FILE` before writing them.

Important distinction:

- `entrypoint.sh` validates file existence and token creation
- mule-doctor's own startup readiness validation separately checks its runtime prerequisites

Runtime contract summary:

- the image provides defaults for `/opt/rust-mule`, `/app`, `/data`, and the bundled healthcheck script
- `entrypoint.sh` owns rust-mule process bootstrap inside the container
- mule-doctor process startup only begins after the token file exists at `RUST_MULE_TOKEN_PATH`
- mule-doctor then performs its own readiness validation before wiring runtime services
- the Docker `HEALTHCHECK` is a steady-state probe, not a bootstrap mechanism
- `npm run smoke:docker` is the canonical end-to-end validation path for the composed container stack

## 3. Managed rust-mule config.toml Generation

For mule-doctor-managed local instances, mule-doctor generates a dedicated `config.toml` per instance.

Per-instance path layout:

- instance root: `${MULE_DOCTOR_MANAGED_INSTANCE_ROOT:-/data/instances}/{instanceId}`
- generated config: `{root}/config.toml`
- runtime state dir: `{root}/state`
- token path: `{root}/state/api.token`
- debug token path: `{root}/state/debug.token`
- log path: `{root}/state/logs/rust-mule.log`

### Current Ownership Model

The current implementation now makes the ownership boundary explicit in both code and generated config comments.
It splits responsibility between:

- externally supplied base/template values
- mule-doctor-owned per-instance values

### mule-doctor-owned per-instance values

These are generated or enforced per managed instance:

| Setting | Source |
| --- | --- |
| `sam.session_name` | generated as `<sessionNamePrefix>-<instanceId>` |
| `general.data_dir` | generated from the instance runtime directory |
| `api.port` | generated/assigned from the managed API port range |
| `general.auto_open_ui` | forced to `false` |

### Base/template-supplied values

These can be supplied through the managed rust-mule config template object used by [InstanceManager](../src/instances/instanceManager.ts).

The input contract supports:

- a preferred nested shape:
  - `sam.*`
  - `general.*`
  - `api.*`
  - `sharing.extraShareRoots`
- backward-compatible flat aliases for the same fields

Preferred nested template shape:

```ts
{
  sam: {
    host: "127.0.0.1",
    forwardHost: "127.0.0.1"
  },
  general: {
    logLevel: "info"
  },
  api: {
    authMode: "headless_remote"
  },
  sharing: {
    extraShareRoots: ["/srv/fixtures"]
  },
  sessionNamePrefix: "managed"
}
```

Supported externally managed fields:

| Template field | Rendered rust-mule config key | Ownership |
| --- | --- | --- |
| `sam.host` or `samHost` | `sam.host` | externally managed |
| `sam.port` or `samPort` | `sam.port` | externally managed |
| `sam.udpPort` or `samUdpPort` | `sam.udp_port` | externally managed |
| `sam.datagramTransport` or `samDatagramTransport` | `sam.datagram_transport` | externally managed |
| `sam.forwardHost` or `samForwardHost` | `sam.forward_host` | externally managed |
| `sam.forwardPort` or `samForwardPort` | `sam.forward_port` | externally managed |
| `sam.controlTimeoutSecs` or `samControlTimeoutSecs` | `sam.control_timeout_secs` | externally managed |
| `general.logLevel` or `generalLogLevel` | `general.log_level` | externally managed |
| `general.logToFile` or `generalLogToFile` | `general.log_to_file` | externally managed |
| `general.logFileName` or `generalLogFileName` | `general.log_file_name` | externally managed |
| `general.logFileLevel` or `generalLogFileLevel` | `general.log_file_level` | externally managed |
| `api.enableDebugEndpoints` or `apiEnableDebugEndpoints` | `api.enable_debug_endpoints` | externally managed |
| `api.authMode` or `apiAuthMode` | `api.auth_mode` | externally managed |
| `sharing.extraShareRoots` or `sharingShareRoots` | appended to `sharing.share_roots` after the managed shared dir | externally managed |
| `sessionNamePrefix` | prefix used for generated `sam.session_name` | externally managed input to generated value |

### Rejected or overwritten ownership

These keys are not template-owned even if an operator conceptually wants to set them:

| Setting | Behavior |
| --- | --- |
| `sam.session_name` | always generated by mule-doctor |
| `general.data_dir` | always generated from the instance runtime directory |
| `general.auto_open_ui` | always forced to `false` |
| `api.port` | always generated/assigned by mule-doctor |

Important note:

- these template values are supported by the config-rendering path
- they are not currently wired from standalone environment variables automatically
- they must be supplied through the managed-instance template configuration path before launch
- generated `config.toml` files now include ownership comments at the top so operators can see the split directly in the rendered file

## Runtime Readiness Expectations

mule-doctor startup readiness currently validates:

- `RUST_MULE_TOKEN_PATH` is readable
- `RUST_MULE_DEBUG_TOKEN_FILE` is readable when configured
- the parent directory of `RUST_MULE_LOG_PATH` exists and is accessible
- mule-doctor persistence/log/proposal directories can be created or written

This is mule-doctor readiness, not full rust-mule network readiness.

Specifically, mule-doctor readiness does not:

- launch rust-mule
- wait for token creation
- verify rust-mule HTTP readiness flags
- verify container process supervision

rust-mule readiness semantics are currently evolving toward explicit payload readiness flags rather than HTTP `503`/`504` responses. The remaining runtime/container alignment work is tracked in [TASK.md](TASK.md) under `Task E`.

### Container healthcheck behavior

The container image now includes a Docker `HEALTHCHECK` that verifies:

- the tracked rust-mule PID is still alive
- the tracked mule-doctor PID is still alive
- `RUST_MULE_TOKEN_PATH` is readable and non-empty
- rust-mule responds locally with:
  - `GET /api/v1/health`
  - `GET /api/v1/status` where `ready == true`
  - `GET /api/v1/searches` where `ready == true`
- when `MULE_DOCTOR_UI_ENABLED=true`, mule-doctor also responds locally with:
  - `GET /api/health` using `MULE_DOCTOR_UI_AUTH_TOKEN`

Runtime files used by the container healthcheck:

| Path / setting | Purpose |
| --- | --- |
| `/tmp/rust-mule.pid` or `RUST_MULE_PID_FILE` | tracked rust-mule process id |
| `/tmp/mule-doctor.pid` or `MULE_DOCTOR_PID_FILE` | tracked mule-doctor process id |
| `RUST_MULE_TOKEN_PATH` | rust-mule bearer token used for local health requests |

Healthcheck-specific variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MULE_DOCTOR_UI_HEALTHCHECK_HOST` | unset | Optional override for the UI probe host; otherwise the healthcheck uses `MULE_DOCTOR_UI_HOST`, except `0.0.0.0` and `::` are probed through `127.0.0.1` |

Operational note:

- the healthcheck treats `status.ready=false` or `searches.ready=false` as unhealthy, even if the HTTP endpoints return `200`
- this matches the current runtime contract more closely than older `503/504` assumptions

### Smoke validation path

`npm run smoke:docker` uses [scripts/smoke-compose.sh](../scripts/smoke-compose.sh) as the canonical runtime-stack validation flow.

It validates all three runtime layers together:

- image + entrypoint startup through `docker compose up --build`
- rust-mule token creation and local HTTP readiness
- mule-doctor authenticated `/api/health` when the UI is enabled

It also verifies persisted runtime artifacts under the mounted `/data` tree, including:

- `config.toml`
- `logs/rust-mule.log`
- `mule-doctor/state.json`
- `mule-doctor/history.json`
- `mule-doctor/operator-events.json`

Operational constraints:

- Docker with `docker compose` is required
- the requested host ports must be available
- the harness injects placeholder `OPENAI_API_KEY` and `MATTERMOST_WEBHOOK_URL` unless you override them
- if `RUST_MULE_TOKEN_PATH` is overridden for smoke use, it must remain under `/data`

## Minimum Practical Configurations

### Local non-container run

Minimum required environment:

```env
RUST_MULE_API_URL=http://127.0.0.1:17835
RUST_MULE_API_PREFIX=/api/v1
RUST_MULE_LOG_PATH=/path/to/rust-mule.log
RUST_MULE_TOKEN_PATH=/path/to/api.token
OPENAI_API_KEY=...
MATTERMOST_WEBHOOK_URL=...
```

Optional but common:

```env
RUST_MULE_DEBUG_TOKEN_FILE=/path/to/debug.token
RUST_MULE_SOURCE_PATH=/path/to/rust-mule
MULE_DOCTOR_DATA_DIR=/data/mule-doctor
MULE_DOCTOR_UI_ENABLED=true
MULE_DOCTOR_UI_AUTH_TOKEN=...
MULE_DOCTOR_UI_HOST=127.0.0.1
MULE_DOCTOR_UI_PORT=18080
```

### Container run

Typical important values:

```env
RUST_MULE_CONFIG=/data/config.toml
RUST_MULE_TOKEN_PATH=/data/token
RUST_MULE_LOG_PATH=/data/logs/rust-mule.log
RUST_MULE_API_URL=http://127.0.0.1:17835
MULE_DOCTOR_DATA_DIR=/data/mule-doctor
MULE_DOCTOR_UI_ENABLED=true
MULE_DOCTOR_UI_AUTH_TOKEN=...
MULE_DOCTOR_UI_HOST=0.0.0.0
MULE_DOCTOR_UI_PORT=18080
```

## Current Gaps

What is documented here but still not ideal in implementation:

- the managed-instance config template is not yet documented elsewhere as a first-class operator contract
- base-template values for managed rust-mule instances are not currently exposed through their own env vars
- the full rust-mule readiness contract is still being aligned with the new `200 + ready: true/false` upstream behavior

Those are tracked backlog items, not hidden behavior.
