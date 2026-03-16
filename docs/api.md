# mule-doctor API

This document covers the HTTP API served by mule-doctor's built-in operator console.

Base URL:

- `http://<MULE_DOCTOR_UI_HOST>:<MULE_DOCTOR_UI_PORT>`
- defaults to `http://127.0.0.1:18080`

Scope:

- browser login/logout endpoints
- authenticated JSON API under `/api/*`
- authenticated SSE streams under `/api/stream/*`

Not in scope:

- static frontend assets under `/static/operatorConsole/*`
- rust-mule's own upstream API under `RUST_MULE_API_URL` and `RUST_MULE_API_PREFIX` (normally `/api/v1`)

## Common Rules

Authentication:

- If `MULE_DOCTOR_UI_AUTH_TOKEN` is unset, the operator console is effectively unauthenticated.
- If `MULE_DOCTOR_UI_AUTH_TOKEN` is set, all API and protected UI routes require one of:
  - cookie `mule_doctor_ui_token`
  - `Authorization: Bearer <token>`
  - `X-Operator-Token: <token>`

Session/login:

- `POST /auth/login` accepts `application/x-www-form-urlencoded` with `token=<operator token>`.
- successful login returns `303` and sets `mule_doctor_ui_token`
- `POST /auth/logout` clears the cookie and returns `303`

Cross-origin protection:

- all `POST` routes require same-origin requests
- if an `Origin` header is present and does not match the request `Host`, mule-doctor returns `403`
- requests without an `Origin` header are allowed

Response conventions:

- success payloads include `"ok": true`
- error payloads include `"ok": false` and an `"error"` string
- timestamps are ISO 8601 strings
- log/file content is redacted before being returned to the client

Common status codes:

- `200` success
- `201` created
- `202` accepted
- `400` invalid input
- `401` authentication required / invalid token
- `403` cross-origin control request rejected
- `404` not found
- `405` method not allowed
- `501` feature unavailable in the current runtime configuration

## Route Summary

### Auth

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/login` | Create authenticated UI session cookie |
| `POST` | `/auth/logout` | Clear authenticated UI session cookie |

### Runtime / Observability

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Runtime, scheduler, observer, and path summary |
| `GET` | `/api/logs/app` | Tail redacted mule-doctor app logs |
| `GET` | `/api/logs/rust-mule` | Tail redacted rust-mule logs |
| `GET` | `/api/llm/logs` | List saved LLM log files |
| `GET` | `/api/llm/logs/{file}` | Read one LLM log file |
| `GET` | `/api/proposals` | List saved patch proposal files |
| `GET` | `/api/proposals/{file}` | Read one proposal file |
| `GET` | `/api/operator/events` | List recent operator timeline events |
| `GET` | `/api/discoverability/results` | List recent persisted controlled discoverability checks |
| `GET` | `/api/discoverability/summary` | Read compact recent discoverability summary |
| `GET` | `/api/search-health/results` | List recent persisted search lifecycle records |
| `GET` | `/api/search-health/summary` | Read compact recent search health summary |
| `GET` | `/api/stream/app` | SSE app-log stream |
| `GET` | `/api/stream/rust-mule` | SSE rust-mule-log stream |

### Observer Control

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/observer/target` | Read active diagnostic target |
| `POST` | `/api/observer/target` | Change active diagnostic target |
| `POST` | `/api/observer/run` | Trigger an immediate observer cycle |

### Managed Instances

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/instances` | List managed instances |
| `POST` | `/api/instances` | Create planned managed instance |
| `GET` | `/api/instances/{id}` | Get one managed instance |
| `GET` | `/api/instances/{id}/logs` | Tail managed-instance rust-mule log |
| `GET` | `/api/instances/{id}/diagnostics` | Get diagnostics snapshot |
| `GET` | `/api/instances/{id}/surface_diagnostics` | Get per-instance search/shared/download summary |
| `POST` | `/api/instances/{id}/analyze` | Run one-shot analysis |
| `POST` | `/api/instances/{id}/start` | Start instance |
| `POST` | `/api/instances/{id}/stop` | Stop instance |
| `POST` | `/api/instances/{id}/restart` | Restart instance |
| `GET` | `/api/instances/compare?left={id}&right={id}` | Compare two managed instances |
| `POST` | `/api/discoverability/check` | Run a controlled discoverability check between managed instances |

### Managed Instance Presets

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/instance-presets` | List available presets |
| `POST` | `/api/instance-presets/apply` | Create planned instances from a preset |
| `POST` | `/api/instance-presets/{prefix}/start` | Start preset group |
| `POST` | `/api/instance-presets/{prefix}/stop` | Stop preset group |
| `POST` | `/api/instance-presets/{prefix}/restart` | Restart preset group |

## Auth Endpoints

### `POST /auth/login`

Request body:

```text
token=<MULE_DOCTOR_UI_AUTH_TOKEN>
```

Behavior:

- if auth is disabled, redirects to `/`
- if token is valid, returns `303`, sets cookie `mule_doctor_ui_token`, redirects to `/`
- if token is invalid, returns `303` and redirects to `/?error=Invalid%20operator%20token.`

### `POST /auth/logout`

Behavior:

- requires existing authentication when auth is enabled
- clears the auth cookie
- returns `303` and redirects to `/`

## Runtime / Observability Endpoints

### `GET /api/health`

Response:

```json
{
  "ok": true,
  "startedAt": "2026-03-11T10:00:00.000Z",
  "now": "2026-03-11T10:05:00.000Z",
  "uptimeSec": 300,
  "scheduler": {
    "started": true,
    "cycleInFlight": false,
    "intervalMs": 300000,
    "currentCycleStartedAt": null,
    "currentCycleTarget": null,
    "lastCycleStartedAt": "2026-03-11T10:00:00.000Z",
    "lastCycleCompletedAt": "2026-03-11T10:02:00.000Z",
    "lastCycleDurationMs": 120000,
    "lastCycleOutcome": "success"
  },
  "observer": {
    "activeDiagnosticTarget": { "kind": "external" },
    "lastObservedTarget": { "kind": "external" },
    "lastRun": "2026-03-11T10:02:00.000Z",
    "lastHealthScore": 81,
    "currentCycleStartedAt": null,
    "currentCycleTarget": null,
    "lastCycleStartedAt": "2026-03-11T10:00:00.000Z",
    "lastCycleCompletedAt": "2026-03-11T10:02:00.000Z",
    "lastCycleDurationMs": 120000,
    "lastCycleOutcome": "success",
    "lastTargetFailureReason": null
  },
  "paths": {
    "rustMuleLogPath": "/data/logs/rust-mule.log",
    "llmLogDir": "/data/mule-doctor",
    "proposalDir": "/data/mule-doctor/proposals"
  }
}
```

Notes:

- `scheduler` is omitted if observer control is not configured
- `observer` is omitted if runtime-state access is not configured
- `lastCycleOutcome` is normalized to `success`, `unavailable`, or `error`

### `GET /api/logs/app?lines={n}`

Query parameters:

- `lines`: optional integer, default `200`, min `1`, max `2000`

Response:

```json
{
  "ok": true,
  "lines": ["...redacted log lines..."]
}
```

### `GET /api/logs/rust-mule?lines={n}`

Query parameters:

- `lines`: optional integer, default `200`, min `1`, max `2000`

Response:

```json
{
  "ok": true,
  "lines": ["...redacted log lines..."]
}
```

### `GET /api/llm/logs`

Response:

```json
{
  "ok": true,
  "files": [
    {
      "name": "LLM_2026-03-11T10-02-00.log",
      "sizeBytes": 1234,
      "updatedAt": "2026-03-11T10:02:01.000Z"
    }
  ]
}
```

Notes:

- only files matching `LLM_*.log` are listed

### `GET /api/llm/logs/{file}`

Response:

```json
{
  "ok": true,
  "file": "LLM_2026-03-11T10-02-00.log",
  "sizeBytes": 1234,
  "truncated": false,
  "content": "..."
}
```

Notes:

- reads are limited to the configured LLM log directory
- path traversal and drive-like paths are rejected
- large files may be truncated

### `GET /api/proposals`

Response:

```json
{
  "ok": true,
  "files": [
    {
      "name": "proposal-2026-03-11.patch",
      "sizeBytes": 4567,
      "updatedAt": "2026-03-11T10:03:00.000Z"
    }
  ]
}
```

Notes:

- only `.patch` files are listed

### `GET /api/proposals/{file}`

Response:

```json
{
  "ok": true,
  "file": "proposal-2026-03-11.patch",
  "sizeBytes": 4567,
  "truncated": false,
  "content": "..."
}
```

### `GET /api/operator/events?limit={n}`

Query parameters:

- `limit`: optional integer, default `30`, min `1`, max `200`

Response:

```json
{
  "ok": true,
  "events": [
    {
      "timestamp": "2026-03-11T10:04:00.000Z",
      "type": "managed_instance_control_applied",
      "message": "Operator restarted managed instance a.",
      "target": { "kind": "managed_instance", "instanceId": "a" },
      "actor": "operator_console"
    }
  ]
}
```

Current event types:

- `diagnostic_target_changed`
- `managed_instance_control_applied`
- `observer_run_requested`
- `observer_cycle_started`
- `observer_cycle_completed`

## Observer Control Endpoints

### `GET /api/observer/target`

Response:

```json
{
  "ok": true,
  "target": {
    "kind": "external"
  }
}
```

Target shape:

- external target: `{ "kind": "external" }`
- managed target: `{ "kind": "managed_instance", "instanceId": "a" }`

### `POST /api/observer/target`

Request body:

```json
{
  "kind": "managed_instance",
  "instanceId": "a"
}
```

Response:

```json
{
  "ok": true,
  "target": {
    "kind": "managed_instance",
    "instanceId": "a"
  }
}
```

Notes:

- unsupported kinds or missing `instanceId` for managed targets return `400`
- unavailable targeting support returns `501`

### `POST /api/observer/run`

Response on acceptance:

```json
{
  "ok": true,
  "accepted": true,
  "scheduler": {
    "started": true,
    "cycleInFlight": true,
    "intervalMs": 300000
  }
}
```

Error behavior:

- returns `409` if a run is already in flight or otherwise not accepted
- returns `501` if observer control is unavailable

## Managed Instance Endpoints

`ManagedInstanceRecord` shape:

```json
{
  "id": "a",
  "status": "running",
  "createdAt": "2026-03-11T09:00:00.000Z",
  "updatedAt": "2026-03-11T10:04:00.000Z",
  "apiHost": "127.0.0.1",
  "apiPort": 19001,
  "runtime": {
    "rootDir": "/data/instances/a",
    "configPath": "/data/instances/a/config.toml",
    "tokenPath": "/data/instances/a/api.token",
    "debugTokenPath": "/data/instances/a/debug.token",
    "logDir": "/data/instances/a/logs",
    "stateDir": "/data/instances/a/state",
    "metadataPath": "/data/instances/a/instance.json"
  },
  "preset": {
    "presetId": "lab",
    "prefix": "lab"
  },
  "currentProcess": {
    "pid": 1234,
    "command": ["rust-mule", "--config", "/data/instances/a/config.toml"],
    "cwd": "/opt/rust-mule",
    "startedAt": "2026-03-11T10:00:00.000Z"
  },
  "lastExit": {
    "at": "2026-03-11T09:55:00.000Z",
    "exitCode": 0,
    "signal": null,
    "reason": "stopped from operator console"
  },
  "lastError": null
}
```

Notes:

- console responses redact `runtime.logPath`
- valid `status` values are `planned`, `stopped`, `running`, and `failed`

### `GET /api/instances`

Response:

```json
{
  "ok": true,
  "instances": [{ "...": "ManagedInstanceRecord" }]
}
```

### `POST /api/instances`

Request body:

```json
{
  "id": "a",
  "apiPort": 19001
}
```

Response:

```json
{
  "ok": true,
  "instance": { "...": "ManagedInstanceRecord" }
}
```

Notes:

- returns `201` on success
- invalid IDs, duplicate IDs, or invalid ports return `400`

### `GET /api/instances/{id}`

Response:

```json
{
  "ok": true,
  "instance": { "...": "ManagedInstanceRecord" }
}
```

### `GET /api/instances/{id}/logs?lines={n}`

Query parameters:

- `lines`: optional integer, default `200`, min `1`, max `2000`

Response:

```json
{
  "ok": true,
  "instance": {
    "id": "a",
    "status": "running"
  },
  "lines": ["...redacted log lines..."]
}
```

### `GET /api/instances/{id}/diagnostics`

Response:

```json
{
  "ok": true,
  "snapshot": {
    "instanceId": "a",
    "observedAt": "2026-03-11T10:04:00.000Z",
    "available": true,
    "nodeInfo": {},
    "peerCount": 12,
    "routingBucketCount": 8,
    "lookupStats": {},
    "networkHealth": {
      "score": 72,
      "components": {
        "peers": 20
      }
    }
  }
}
```

### `GET /api/instances/{id}/surface_diagnostics`

Returns a mule-doctor-owned summary over the stable rust-mule surfaces for one managed instance:

- `/api/v1/searches`
- `/api/v1/shared`
- `/api/v1/shared/actions`
- `/api/v1/downloads`

Response:

```json
{
  "ok": true,
  "diagnostics": {
    "instanceId": "a",
    "observedAt": "2026-03-16T09:00:00.000Z",
    "summary": {
      "searches": {
        "ready": true,
        "totalSearches": 2,
        "activeSearches": 1,
        "stateCounts": {
          "running": 1,
          "completed": 1
        }
      },
      "sharedLibrary": {
        "totalFiles": 4,
        "keywordPublishQueuedCount": 1,
        "keywordPublishFailedCount": 0,
        "keywordPublishAckedCount": 3
      },
      "downloads": {
        "queueLen": 2,
        "totalDownloads": 2,
        "activeDownloads": 1,
        "stateCounts": {
          "queued": 1,
          "completed": 1
        }
      }
    }
  }
}
```

### `POST /api/instances/{id}/analyze`

Response:

```json
{
  "ok": true,
  "analysis": {
    "instanceId": "a",
    "analyzedAt": "2026-03-11T10:04:30.000Z",
    "available": true,
    "summary": "..."
  }
}
```

### `POST /api/instances/{id}/start`

### `POST /api/instances/{id}/stop`

### `POST /api/instances/{id}/restart`

Response:

```json
{
  "ok": true,
  "instance": { "...": "ManagedInstanceRecord" }
}
```

Notes:

- these endpoints append operator timeline audit events on success
- missing instance returns `404`
- unsupported lifecycle transition semantics are enforced by the managed-instance layer

### `GET /api/instances/compare?left={id}&right={id}`

Query parameters:

- `left`: required managed-instance ID
- `right`: required managed-instance ID

Response:

```json
{
  "ok": true,
  "comparison": {
    "left": {
      "instance": { "...": "ManagedInstanceRecord" },
      "snapshot": { "...": "ManagedInstanceDiagnosticSnapshot" }
    },
    "right": {
      "instance": { "...": "ManagedInstanceRecord" },
      "snapshot": { "...": "ManagedInstanceDiagnosticSnapshot" }
    }
  }
}
```

Error behavior:

- `400` if either side is missing
- `400` if `left` and `right` are the same
- `404` if either instance is not found

## Discoverability and Search Health Endpoints

### `POST /api/discoverability/check`

Runs a controlled search/discoverability check between two mule-doctor-managed instances.

Request body:

```json
{
  "publisherInstanceId": "lab-a",
  "searcherInstanceId": "lab-b",
  "fixtureId": "probe",
  "timeoutMs": 60000,
  "pollIntervalMs": 2000
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "publisherInstanceId": "lab-a",
    "searcherInstanceId": "lab-b",
    "fixture": {
      "fixtureId": "probe",
      "token": "mule-doctor-lab-a-probe",
      "fileName": "mule-doctor-lab-a-probe.txt",
      "relativePath": "mule-doctor-lab-a-probe.txt",
      "absolutePath": "/data/instances/lab-a/shared/mule-doctor-lab-a-probe.txt",
      "sizeBytes": 64
    },
    "query": "mule-doctor-lab-a-probe",
    "dispatchedAt": "2026-03-13T12:00:00.000Z",
    "searchId": "feedfacefeedfacefeedfacefeedface",
    "readinessAtDispatch": {
      "publisherStatusReady": true,
      "publisherSearchesReady": true,
      "publisherReady": true,
      "searcherStatusReady": true,
      "searcherSearchesReady": true,
      "searcherReady": true
    },
    "peerCountAtDispatch": {
      "publisher": 3,
      "searcher": 4
    },
    "states": [
      {
        "observedAt": "2026-03-13T12:00:01.000Z",
        "state": "running",
        "hits": 0
      },
      {
        "observedAt": "2026-03-13T12:00:03.000Z",
        "state": "running",
        "hits": 1
      }
    ],
    "resultCount": 1,
    "outcome": "found",
    "finalState": "running"
  }
}
```

Notes:

- on success, mule-doctor also:
  - appends an operator timeline event
  - stores a sanitized discoverability record
  - stores a normalized search-health lifecycle record
- persisted history intentionally omits sensitive fixture fields such as absolute paths and tokens
- this endpoint is intended for mule-doctor-managed local instances only
- missing managed discoverability support returns `501`

### `GET /api/discoverability/results?limit={n}`

Query parameters:

- `limit`: optional integer, default `20`, min `1`, max `200`

Response:

```json
{
  "ok": true,
  "results": [
    {
      "recordedAt": "2026-03-13T12:05:00.000Z",
      "result": {
        "publisherInstanceId": "lab-a",
        "searcherInstanceId": "lab-b",
        "fixture": {
          "fixtureId": "probe",
          "fileName": "mule-doctor-lab-a-probe.txt",
          "relativePath": "mule-doctor-lab-a-probe.txt",
          "sizeBytes": 64
        },
        "query": "mule-doctor-lab-a-probe",
        "dispatchedAt": "2026-03-13T12:00:00.000Z",
        "searchId": "feedfacefeedfacefeedfacefeedface",
        "readinessAtDispatch": {
          "publisherStatusReady": true,
          "publisherSearchesReady": true,
          "publisherReady": true,
          "searcherStatusReady": true,
          "searcherSearchesReady": true,
          "searcherReady": true
        },
        "peerCountAtDispatch": {
          "publisher": 3,
          "searcher": 4
        },
        "states": [],
        "resultCount": 1,
        "outcome": "found",
        "finalState": "running"
      }
    }
  ]
}
```

Notes:

- returns the sanitized persisted discoverability history
- fixture `token`, fixture `absolutePath`, and publisher-side shared snapshots are not exposed here
- unavailable discoverability history returns `501`

### `GET /api/discoverability/summary?limit={n}`

Query parameters:

- `limit`: optional integer, default `20`, min `1`, max `200`

Response:

```json
{
  "ok": true,
  "summary": {
    "windowSize": 8,
    "totalChecks": 8,
    "foundCount": 5,
    "completedEmptyCount": 2,
    "timedOutCount": 1,
    "successRatePct": 62.5,
    "latestRecordedAt": "2026-03-13T12:05:00.000Z",
    "latestOutcome": "found",
    "latestQuery": "mule-doctor-lab-a-probe",
    "latestPair": {
      "publisherInstanceId": "lab-a",
      "searcherInstanceId": "lab-b"
    },
    "lastSuccessAt": "2026-03-13T12:05:00.000Z"
  }
}
```

Notes:

- this is a compact derived view over recent discoverability history
- used by both the operator console and Mattermost periodic reporting

### `GET /api/search-health/results?limit={n}`

Query parameters:

- `limit`: optional integer, default `20`, min `1`, max `200`

Response:

```json
{
  "ok": true,
  "results": [
    {
      "recordedAt": "2026-03-13T12:05:00.000Z",
      "source": "controlled_discoverability",
      "query": "mule-doctor-lab-a-probe",
      "searchId": "feedfacefeedfacefeedfacefeedface",
      "dispatchedAt": "2026-03-13T12:00:00.000Z",
      "readinessAtDispatch": {
        "publisher": {
          "statusReady": true,
          "searchesReady": true,
          "ready": true
        },
        "searcher": {
          "statusReady": true,
          "searchesReady": true,
          "ready": true
        }
      },
      "transportAtDispatch": {
        "publisher": {
          "peerCount": 3,
          "degradedIndicators": []
        },
        "searcher": {
          "peerCount": 4,
          "degradedIndicators": []
        }
      },
      "states": [],
      "resultCount": 1,
      "outcome": "found",
      "finalState": "running",
      "controlledContext": {
        "publisherInstanceId": "lab-a",
        "searcherInstanceId": "lab-b",
        "fixture": {
          "fixtureId": "probe",
          "fileName": "mule-doctor-lab-a-probe.txt",
          "relativePath": "mule-doctor-lab-a-probe.txt",
          "sizeBytes": 64
        }
      }
    }
  ]
}
```

Notes:

- search-health records are mule-doctor-owned normalized lifecycle records
- current `source` values are limited to `controlled_discoverability`
- the goal of this surface is to preserve lifecycle evidence without requiring consumers to correlate raw upstream endpoints every time

### `GET /api/search-health/summary?limit={n}`

Query parameters:

- `limit`: optional integer, default `20`, min `1`, max `200`

Response:

```json
{
  "ok": true,
  "summary": {
    "windowSize": 8,
    "totalSearches": 8,
    "foundCount": 5,
    "completedEmptyCount": 2,
    "timedOutCount": 1,
    "dispatchReadyCount": 7,
    "dispatchNotReadyCount": 1,
    "degradedTransportCount": 2,
    "successRatePct": 62.5,
    "latestRecordedAt": "2026-03-13T12:05:00.000Z",
    "latestOutcome": "found",
    "latestQuery": "mule-doctor-lab-a-probe",
    "latestSource": "controlled_discoverability",
    "latestPair": {
      "publisherInstanceId": "lab-a",
      "searcherInstanceId": "lab-b"
    },
    "lastSuccessAt": "2026-03-13T12:05:00.000Z"
  }
}
```

Notes:

- this is the compact derived summary above recent search-health records
- used by the operator console, LLM tooling, and Mattermost periodic reporting
- unavailable search-health storage returns `501`

## Managed Preset Endpoints

### `GET /api/instance-presets`

Response:

```json
{
  "ok": true,
  "presets": [
    {
      "id": "lab",
      "name": "Lab Cluster",
      "description": "Three-node local cluster",
      "nodes": [
        { "suffix": "a" },
        { "suffix": "b" }
      ]
    }
  ]
}
```

### `POST /api/instance-presets/apply`

Request body:

```json
{
  "presetId": "lab",
  "prefix": "lab"
}
```

Response:

```json
{
  "ok": true,
  "applied": {
    "presetId": "lab",
    "prefix": "lab",
    "instances": [{ "...": "ManagedInstanceRecord" }]
  }
}
```

Notes:

- returns `201` on success
- invalid preset IDs or duplicate prefixes return `400` or `404` depending on cause
- applying a preset appends one operator audit event per created instance

### `POST /api/instance-presets/{prefix}/start`

### `POST /api/instance-presets/{prefix}/stop`

### `POST /api/instance-presets/{prefix}/restart`

Response:

```json
{
  "ok": true,
  "result": {
    "presetId": "lab",
    "prefix": "lab",
    "action": "restart",
    "instances": [{ "...": "ManagedInstanceRecord" }],
    "failures": [
      {
        "instanceId": "lab-b",
        "error": "..."
      }
    ]
  }
}
```

Notes:

- successful `start` also includes `"started": { ...same result... }` for backward compatibility
- missing preset-group prefix returns `400`
- invalid percent-encoding in the path returns `400`
- unknown preset group returns `404`
- unsupported action returns `404`
- successful preset actions append one operator audit event per affected instance

## SSE Streams

SSE endpoints require the same authentication as the JSON API.

### `GET /api/stream/app?lines={n}`

### `GET /api/stream/rust-mule?lines={n}`

Query parameters:

- `lines`: optional integer, default `50`, min `1`, max `500`

Event types:

- `snapshot`
- `line`

Snapshot payload:

```json
{
  "lines": ["...initial redacted lines..."]
}
```

Line payload:

```json
{
  "line": "...redacted appended line..."
}
```

Notes:

- mule-doctor sends periodic heartbeat comments to keep the stream alive
- app-log streaming requires in-memory app-log subscription support; otherwise returns `501`
- rust-mule log streaming polls the configured rust-mule log file

## Feature Availability

Some endpoints depend on optional runtime wiring. If the corresponding subsystem is not configured, mule-doctor returns `501`.

Subsystem-gated routes:

- managed instances:
  - `/api/instances`
  - `/api/instances/{id}`
  - `/api/instances/{id}/logs`
  - `/api/instances/{id}/start`
  - `/api/instances/{id}/stop`
  - `/api/instances/{id}/restart`
- managed diagnostics:
  - `/api/instances/{id}/diagnostics`
  - `/api/instances/{id}/surface_diagnostics`
  - `/api/instances/compare`
- managed analysis:
  - `/api/instances/{id}/analyze`
- managed presets:
  - `/api/instance-presets`
  - `/api/instance-presets/apply`
  - `/api/instance-presets/{prefix}/{action}`
- managed discoverability:
  - `/api/discoverability/check`
- discoverability history:
  - `/api/discoverability/results`
  - `/api/discoverability/summary`
- search health history:
  - `/api/search-health/results`
  - `/api/search-health/summary`
- observer target control:
  - `/api/observer/target`
- observer run control:
  - `/api/observer/run`
- operator event history:
  - `/api/operator/events`
- app-log streaming:
  - `/api/stream/app`

## Upstream rust-mule API

mule-doctor also acts as an HTTP client of rust-mule, but it does not proxy that API through the operator console.

Current upstream dependency surface:

- base URL from `RUST_MULE_API_URL`
- prefix from `RUST_MULE_API_PREFIX`, default `/api/v1`
- bearer token loaded from `RUST_MULE_TOKEN_PATH`
- optional debug token loaded from `RUST_MULE_DEBUG_TOKEN_FILE` and sent as `X-Debug-Token`

Common rust-mule endpoints used by mule-doctor include:

- `GET /api/v1/health`
- `GET /api/v1/status`
- `GET /api/v1/searches`
- `GET /api/v1/searches/{search_id}`
- `GET /api/v1/shared`
- `GET /api/v1/shared/actions`
- `GET /api/v1/downloads`
- `GET /api/v1/events`
- `GET /api/v1/debug/routing/buckets`
- `POST /api/v1/debug/bootstrap/restart`
- `POST /api/v1/debug/trace_lookup`

Those routes belong to rust-mule, not mule-doctor, and should be documented separately in the rust-mule project.

## Current Upstream Search / Publish / Download Surface

The following section documents the currently known rust-mule surfaces that mule-doctor needs to integrate with for readiness gating, controlled discoverability checks, search diagnostics, publish diagnostics, and download diagnostics.

These are upstream rust-mule routes, not mule-doctor-served routes.

### `GET /api/v1/status`

Current behavior:

- returns `200`
- readiness is represented in the payload, not through `503`/`504`

Important fields currently present:

- `ready`
- flattened `KadServiceStatus`
- aggregate transfer fields:
  - `download_rate_bps_5s`
  - `download_rate_bps_30s`
  - `upload_rate_bps_5s`
  - `upload_rate_bps_30s`
  - `zero_fill_upload_rate_bps_5s`
  - `zero_fill_upload_rate_bps_30s`
  - `zero_fill_active_uploads`
  - `zero_fill_warning`

Important mule-doctor implication:

- `/api/v1/status.ready` is a real readiness signal
- mule-doctor should not rely on old `503`/`504` semantics

### `GET /api/v1/searches`

Current behavior:

- returns:
  - `ready`
  - `searches: KadKeywordSearchInfo[]`

Each search entry currently includes:

- `search_id_hex`
- `keyword_id_hex`
- `keyword_label`
- `state`
- `created_secs_ago`
- `hits`
- `want_search`
- `publish_enabled`
- `got_publish_ack`

Important mule-doctor implication:

- `/api/v1/searches.ready` is available directly and should be used directly for search-readiness gating
- it should not be inferred only from `/api/v1/status`

### `GET /api/v1/searches/{search_id}`

Current behavior:

- returns:
  - `search: KadKeywordSearchInfo`
  - `hits: KadKeywordHitJson[]`

Each hit currently includes:

- `file_id_hex`
- `filename`
- `file_size`
- `file_type`
- `publish_info`
- `origin`

Practical diagnostic use:

- one-search detail
- terminal state confirmation
- zero-hit confirmation for completed-empty searches

### `GET /api/v1/shared`

Current behavior:

- returns:
  - `files: SharedFileEntry[]`

Each file currently includes:

- identity:
  - `file_name`
  - `relative_path`
  - `file_hash_md4_hex`
  - `file_size`
- publish/source state:
  - `source_count`
  - `local_source_cached`
  - `source_publish_attempts`
  - `source_publish_last_result`
  - `source_publish_last_attempt_unix_secs`
  - `source_publish_response_received`
  - `source_publish_first_response_latency_ms`
  - `keyword_publish_attempts`
  - `keyword_publish_queued`
  - `keyword_publish_failed`
  - `keyword_publish_last_result`
  - `keyword_publish_last_attempt_unix_secs`
  - `keyword_publish_total`
  - `keyword_publish_acked`
- activity:
  - `queued_downloads`
  - `inflight_downloads`
  - `queued_uploads`
  - `inflight_uploads`
  - `total_upload_requests`
  - `requested_bytes_total`
  - `last_requested_unix_secs`
  - `queued_upload_ranges`
  - `inflight_upload_ranges`
  - `active_request`

Practical diagnostic use:

- per-file keyword/source publish status
- per-file upload/download activity
- confirmation that a controlled shared fixture is actually indexed and publish-tracked

### `GET /api/v1/shared/actions`

Current behavior:

- returns:
  - `actions: SharedActionStatus[]`

Current action family includes operator-triggered jobs such as:

- `reindex`
- `republish_sources`
- `republish_keywords`

Important note:

- this is shared-operation job state
- it is not the same thing as a dedicated “active keyword publish jobs” surface

### `GET /api/v1/downloads`

Current behavior:

- returns queue-level fields plus `downloads: DownloadEntry[]`

Queue-level fields currently include:

- `queue_len`
- `recovered_on_start`
- `reserve_calls_total`
- `reserve_granted_blocks_total`
- `reserve_denied_cooldown_total`
- `reserve_denied_peer_cap_total`
- `reserve_denied_download_cap_total`
- `reserve_denied_state_total`
- `reserve_empty_no_missing_total`

Each download currently includes:

- `part_number`
- `file_name`
- `file_hash_md4_hex`
- `file_size`
- `state`
- `downloaded_bytes`
- `rate_bps_5s`
- `rate_bps_30s`
- `progress_pct`
- `missing_ranges`
- `inflight_ranges`
- `retry_count`
- `last_error`
- `source_count`
- `missing_range_spans`
- `inflight_range_spans`
- `created_unix_secs`
- `updated_unix_secs`

Practical diagnostic use:

- queue health
- per-download progress
- stalled/errored download investigation

## Current Upstream Share / Republish Workflow

To make a managed rust-mule instance publish a known file today, the current workflow is:

1. configure `sharing.share_roots` to include the folder containing the file
   - via config file
   - or via `PATCH /api/v1/settings` when that flow is available to the orchestrator
2. start or restart the instance, or trigger shared actions
3. rust-mule then:
   - canonicalizes share roots
   - indexes shared files
   - queues source publish
   - queues keyword publish

Current operator-triggered shared-action endpoints are:

- `POST /api/v1/shared/actions/reindex`
- `POST /api/v1/shared/actions/republish_sources`
- `POST /api/v1/shared/actions/republish_keywords`

Current mule-doctor implication:

- mule-doctor can likely orchestrate the basic share/publish flow once it has the right config/settings and control hooks
- but it does not yet have a first-class “managed instance share/publish” abstraction of its own

## Contract Stability Notes

Stable enough for current mule-doctor integration work:

- endpoint existence
- `ready` on `/api/v1/status`
- `ready` on `/api/v1/searches`
- the existence of search/shared/download surfaces

More likely to evolve:

- exact flattened `KadServiceStatus` field set on `/api/v1/status`
- exact search/download state strings
- exact publish counters and ack fields on `/api/v1/shared`
- whether background publish work is modeled through search-thread state or dedicated publish-job surfaces
