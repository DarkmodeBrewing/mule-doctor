# mule-doctor

mule-doctor is an AI-assisted diagnostic and operator agent for rust-mule nodes.

It continuously observes node behavior through the rust-mule control plane (API), log files, optional source code access, and an operator-facing console. The system analyzes network health, detects anomalies, and reports observations to developers.

The tool is designed for debugging and research of Kademlia-based distributed hash table (DHT) behavior during development and soak testing.

---

## Architecture Overview

mule-doctor can run in two modes:

1. **external observation mode** for an already-running rust-mule node
2. **managed-instance mode** where mule-doctor supervises one or more local rust-mule test instances

In both modes, mule-doctor observes node behavior through three primary information sources:

1. rust-mule control plane API
2. rust-mule log files
3. historical diagnostic metrics

The system periodically gathers node state, evaluates network health, and
passes diagnostic context to an LLM capable of performing deeper analysis
through tool calls.

The LLM does not interact with the node directly. Instead, it uses a controlled
tool interface implemented by mule-doctor.

System architecture:

```text
mule-doctor
│
├─ operator console (web UI + API)
├─ observer loop
├─ tool registry
├─ LLM diagnostics
├─ history storage
├─ Mattermost reporting
└─ instance manager (managed local test instances)
   │
   ├─ rust-mule instance A
   ├─ rust-mule instance B
   └─ rust-mule instance C
```

The design intentionally separates:

- **data collection**
- **diagnostic reasoning**
- **reporting**

This keeps the system deterministic and easier to extend.

The tool-registry implementation is also split by responsibility now:

- `toolRegistry.ts` owns registry orchestration and tool-profile filtering
- core log/debug tools, runtime-store tools, rust-mule surface tools, and source tools are registered from separate modules
- the tool-registry test surface is split by those same domains so core/runtime/surface/source behaviors evolve independently

The rust-mule API client is also split by responsibility now:

- `rustMuleClient.ts` owns request flow and high-level operations
- `rustMuleClientTypes.ts` owns exported API response/value shapes
- `rustMuleClientShared.ts` owns normalization, polling, timeout/error helpers, and shared logging
- the client test surface is split the same way so read-only API coverage is separate from debug/write-path mutation coverage

The observer loop is also split by responsibility now:

- `observer.ts` owns scheduling, target resolution flow, and cycle orchestration
- `observerShared.ts` owns prompt/state/log helpers
- `observerSearchTracking.ts` owns observed-search lifecycle deduplication and persistence
- the observer test surface is split so context/target behavior and scheduler/control behavior stay isolated as the loop evolves

The managed-instance operator-console route surface is split by responsibility now:

- `serverManagedInstanceRoutes.ts` owns top-level dispatch only
- collection/preset/discoverability/manual-search routes live in `serverManagedInstanceCollectionRoutes.ts`
- per-instance detail/logs/diagnostics/lifecycle/shared-content routes live in `serverManagedInstanceItemRoutes.ts`

The managed-instance lifecycle layer is also split by responsibility now:

- `instanceManager.ts` owns lifecycle orchestration, reconciliation, and persistence flow
- `instanceManagerPlanning.ts` owns id/port planning, runtime-path materialization, binary checks, and rollback helpers
- the managed-instance test surface is split similarly so planning/config and lifecycle/reconciliation behaviors do not share one test monolith

The operator console is part of the architecture. It exposes a browser-accessible,
token-protected runtime view and already serves as the bounded control surface
for mule-doctor-managed local test instances, while external rust-mule nodes
remain strictly observer/advisor scope.

---

# Safety Policy

mule-doctor **never modifies an externally managed rust-mule instance automatically**.

The LLM may:

- analyze logs
- inspect source code
- propose patches
- build sandbox test binaries

The LLM must **never**:

- overwrite the running rust-mule binary
- modify configuration files
- restart rust-mule without explicit approval

All suggested patches are reported to developers for manual review.

Future automated testing will only occur in isolated sandbox instances.

---

## Threat Model and Failure Modes

mule-doctor is designed as an **observability and diagnostics tool**, not as a
control plane for rust-mule. Several safety boundaries are enforced to prevent
unintended interference with the running node.

### Potential Risks

LLM-driven diagnostics introduce several risks:

- incorrect interpretation of logs
- excessive API calls
- excessive token usage
- tool misuse
- unstable automated patch generation

### Mitigations

The following safeguards are implemented:

- read-only access to rust-mule runtime state
- no automatic modification of binaries or configuration
- sandbox-only compilation for experimental patches
- structured tool responses to prevent misinterpretation
- token usage logging and daily cost reporting

### Failure Modes

If mule-doctor fails or becomes unavailable:

- rust-mule continues running normally
- no runtime state is modified
- only observability and reporting are affected

If the LLM becomes unavailable:

- mule-doctor continues collecting metrics
- diagnostic reports are skipped until the model becomes available

### Design Principle

The core design rule is:

> mule-doctor must never be able to disrupt an external rust-mule node.

For externally managed nodes, the system operates strictly as an **observer and
advisor**, never as an automatic control mechanism.

For future managed local test instances started by mule-doctor itself, the
system may perform explicit lifecycle actions such as start, stop, and restart,
but only against those mule-doctor-owned instances and only through a bounded
instance-management layer.

# LLM Model Used

`gpt-5-mini`

---

# Observer Loop

mule-doctor runs a periodic diagnostic loop.

The observer must resolve an explicit active diagnostic target before each
scheduled cycle. The active target can be either:

- the externally configured rust-mule client
- one selected mule-doctor-managed local test instance

The selected target must be persisted in mule-doctor runtime state so restart
behavior is deterministic. If the selected managed instance is unavailable,
diagnostics should degrade gracefully and report that target as unavailable
without stopping mule-doctor itself.

Periodic reports and persisted observer state should identify the target that
was actually observed.

If target resolution fails before a full observation can run, mule-doctor
should still emit an explicit degraded/unavailable report and persist a zero
health score for that target rather than silently skipping the cycle.
The concrete failure reason should also be persisted so operators can see why
the scheduled target is unavailable without reading raw logs first.

Example workflow:

1. Collect node metrics from the rust-mule API
2. Retrieve recent log data
3. Calculate network health score
4. Pass diagnostic context to the LLM
5. Allow the LLM to call investigation tools
6. Generate a health report
7. Post the report to Mattermost
8. Append diagnostic data to history for trend comparison

Default interval: **5 minutes**

---

# Operator Console

The operator console is a built-in web surface served by mule-doctor.

Current phase:

- token-protected browser UI and API
- JSON API for health, logs, and proposal artifacts
- SSE streams for live app-log and rust-mule-log viewing
- bounded managed-instance controls for mule-doctor-owned local test instances:
  - create planned instance
  - start / stop / restart instance
  - apply preset
  - start / stop / restart preset group
  - selected-instance diagnostics / analysis / compare views
  - selected-instance shared-content and discoverability actions
  - set active diagnostic target

Current runtime-surface boundary:

- the console can show current search threads, shared-file publish markers, shared actions, and downloads for managed instances
- shared-file publish markers such as `keyword_publish_*` are treated as inferred per-file status only
- rust-mule does not currently expose a first-class active publish-job queue/surface
- operators should not read the current publish counters as a complete background job model; they are the best available file-level publish signals

Implementation note:

- the operator console frontend is served as static assets, kept separate from backend auth/API/SSE route logic
- the backend route surface is now split so `server.ts` owns auth, stream lifecycle, and server startup while focused route modules own general API reads vs managed-instance control routes
- the general operator-console API routing is further split between a small dispatcher, shared route context, control/history routes, and read-only log/runtime routes
- the browser-side selected-instance flow is now split between controller orchestration, runtime-surface rendering, and workflow/action modules so no single operator-console browser file carries the whole control plane
- the operator-console integration coverage is split across focused route/auth/SSE test files with shared stub fixtures so the test surface can keep growing without one monolithic file
- the managed-instance test-stub layer under the operator-console tests is split by lifecycle, diagnostics, workflow, and invocation concerns so route tests do not all depend on one oversized helper module
- the managed rust-mule config layer is split between a stable public entrypoint, shared contract/types helpers, parser/validation logic, and TOML rendering so config ownership rules do not live in one large file
- the source-code tool layer is split between a thin public coordinator, shared contracts/helpers, bounded filesystem operations, and git-blame parsing so source inspection logic does not all live in one module
- the observer runtime is split between scheduler/control flow in `observer.ts`, cycle execution in a dedicated runner, shared prompt/state helpers, and observed-search lifecycle tracking
- the rust-mule client layer is split between a public endpoint facade, request/token/poll transport, shared response normalization helpers, and shared types so the API surface stays stable while transport concerns remain isolated
- the managed-instance surface diagnostics layer is split between service orchestration, runtime-surface shaping/highlights, observed-search lifecycle recording, and shared snapshot/detail types
- the managed-instance manager is split between a catalog/queue facade and dedicated lifecycle/process reconciliation helpers so start/stop/reconcile behavior does not live in one file

Primary purpose:

- inspect mule-doctor runtime health
- inspect rust-mule logs and LLM logs
- review saved patch proposals
- provide a future home for controlled local test-instance management

Required runtime controls:

- disabled by default
- explicit auth token required when enabled
- no direct exposure on untrusted networks without additional access control
- secrets must be redacted from rendered content

---

# Mattermost Integration

Color codes:

green `#2ecc71` healthy
yellow `#f1c40f` warning
red `#e74c3c` degraded
blue `#3498db` informational

Example payload:

```
{
  "username": "mule-doctor",
  "icon_emoji": ":robot_face:",
  "text": "rust-mule health report",
  "attachments": [
    {
      "title": "Node Metrics",
      "color": "#2ecc71",
      "text": "Peers: 142\nLookup success: 84%\nAverage hops: 9"
    },
    {
      "title": "Observations",
      "color": "#3498db",
      "text": "- Routing buckets balanced\n- Peer churn low"
    }
  ]
}
```

Implementation note:

- `mattermost.ts` owns webhook transport, timeout handling, and inbound command flow
- payload/attachment construction is split into focused helpers so report formatting stays separate from posting and rate-limit/audit flow

---

# Historical Metrics

File location:

`/data/mule-doctor/history.json`

This JSON file stores approximately **500 historical metric snapshots** which allow the LLM to compare the current state with historical trends.

Example history entry:

```
{
  "timestamp": "...",
  "peer_count": 148,
  "routing_balance": 0.92,
  "lookup_success": 0.83,
  "avg_hops": 8,
  "health_score": 89
}
```

Older entries should be removed when the history exceeds the configured limit.

---

# LLM State Handling

File:

`/data/mule-doctor/state.json`

The state file contains operational metadata required for the observer loop.

State includes:

- last run timestamp
- last health score
- log read offset
- last alert issued
- active diagnostic target
- last observed target
- last target failure reason
- current cycle start time
- current cycle target
- last cycle start/completion timestamps
- last cycle duration
- last cycle outcome

Example state object:

```
{
  "lastRun": "2026-03-05T12:05:00Z",
  "lastHealthScore": 89,
  "logOffset": 2483291,
  "lastAlert": "routing_imbalance",
  "activeDiagnosticTarget": {
    "kind": "external"
  },
  "lastObservedTarget": {
    "kind": "external"
  },
  "lastTargetFailureReason": "Managed instance a is stopped",
  "currentCycleStartedAt": "2026-03-05T12:10:00Z",
  "currentCycleTarget": {
    "kind": "external"
  },
  "lastCycleStartedAt": "2026-03-05T12:05:00Z",
  "lastCycleCompletedAt": "2026-03-05T12:05:08Z",
  "lastCycleDurationMs": 8000,
  "lastCycleOutcome": "success"
}
```

Example observer code:

```
const state = await runtimeStore.loadState();

const health = getNetworkHealth(metrics);

await runtimeStore.appendHistory({
  timestamp: new Date().toISOString(),
  healthScore: health.score,
});

await runtimeStore.updateState({
  lastHealthScore: health.score,
});
```

---

# Operator Event Timeline

File:

`/data/mule-doctor/operator-events.json`

This JSON file stores a bounded recent timeline of operator and scheduler events, separate from
metric history and separate from raw logs.

Event classes include:

- active diagnostic target changes
- operator-triggered scheduled runs
- observer cycle start
- observer cycle completion with outcome

Example event entry:

```
{
  "timestamp": "2026-03-05T12:10:00Z",
  "type": "observer_cycle_completed",
  "message": "Observer cycle completed successfully for managed instance a",
  "target": {
    "kind": "managed_instance",
    "instanceId": "a"
  },
  "outcome": "success",
  "actor": "operator_console"
}
```

---

# Managed Instance Comparison

The operator console may compare two managed local rust-mule instances side by side using
on-demand diagnostics snapshots. This is intentionally read-only and does not alter:

- the active scheduled diagnostic target
- the single-target observer loop
- Mattermost scheduler/reporting semantics

The comparison surface should be built from existing managed-instance diagnostics collection rather
than introducing concurrent scheduled observation across multiple targets.

---

# Managed Instance Presets

The operator console may also expose bounded cluster presets for rapid local test setup.

Initial preset scope should remain intentionally small:

- `pair`
- `trio`

Preset definitions should carry concise operator-facing metadata:

- display name
- short description of intended use
- node-layout summary derived from suffixes such as `a`, `b`, and `c`

Preset application should:

- create multiple **planned** managed instances in one backend operation
- require an operator-supplied instance-id prefix such as `lab`
- produce stable ids such as `lab-a`, `lab-b`, and `lab-c`
- preserve existing `InstanceManager` invariants for ids, ports, runtime paths, and rollback behavior

Preset application must not:

- start the created instances automatically unless an explicit future control flow adds that behavior
- change the active scheduled diagnostic target
- change the single-target observer/reporting model

The purpose of presets is to shorten repeated local cluster setup, not to widen scheduler scope.

Preset-driven lifecycle actions may later include bounded bulk operations such as
`start preset group`, `stop preset group`, and `restart preset group`, but those actions must still:

- run through explicit backend services rather than browser-side loops
- keep partial instance-start failures local to the group operation
- avoid changing the scheduled observer target implicitly

The operator console should present preset-created groups as first-class cluster views rather than
only as a flat list of instances. Group cards should summarize:

- planned/running/stopped/failed counts
- member instances
- recent failure reasons when any member is in a failed state

This improves operator readability without changing the single-target observer model.

The preset-application UI should also surface the selected preset description and layout summary
before creation so operators do not need to infer what `pair` or `trio` means from ids alone.

The group view may also provide shortcuts into the existing managed-instance comparison surface so
operators can compare two members of the same preset-created cluster without manually rebuilding the
selection each time.

Cluster cards and grouped member cards may also provide bounded shortcuts into the existing operator
timeline by pre-filling the current client-side group and instance filters, rather than introducing
separate event APIs or timeline storage semantics.

The operator timeline may be filtered in the browser by preset group, managed instance, and event
type so operators can understand local control/history flows without scanning the full global event list.

The timeline renderer should also present event-type-specific summaries and badges for target and
outcome so operators can distinguish target changes, run requests, successes, unavailable targets,
and failed cycles without mentally parsing raw event text first.

To reduce noise during active testing, the browser may also group adjacent repeated events with a
client-side collapse/expand control while still allowing operators to fall back to the raw
chronological list.

The browser may additionally expose quick density controls for high-signal event classes such as
target changes, run requests, and failed/unavailable cycles, layered on top of the existing
timeline filters rather than replacing them.

If operators repeatedly use the same combinations, the browser may also expose a small set of
built-in timeline views that apply those controls in one action while still leaving the underlying
filters editable.

---

# LLM Tools

### getHistory

Returns the contents of `history.json`.

### getNodeInfo

Returns node identity and runtime statistics.

### getPeers

Returns currently connected peers.

### getRoutingBuckets

Returns routing table bucket distribution.

### searchLogs

Searches recent rust-mule logs using safe bounded substring matching.

### triggerBootstrap

Triggers a bootstrap attempt.

### traceLookup(target_id)

Initiates a lookup for a provided or random key.
Records every hop and returns the lookup path.

---

# Tool Output Format

All tools must return **structured JSON**.

Example:

```
{
  "tool": "getNodeInfo",
  "success": true,
  "data": {
    "peer_count": 142,
    "lookup_success": 0.84
  }
}
```

If a tool fails:

```
{
  "tool": "getNodeInfo",
  "success": false,
  "error": "debug endpoints disabled"
}
```

Structured responses ensure the LLM reasons over machine-readable data instead of parsing free text.

---

# Managed Instance Architecture

Current versions of mule-doctor support bounded lifecycle management for
multiple mule-doctor-owned local rust-mule instances from the operator console
for integration and soak testing.

This capability is intended for **mule-doctor-managed local test instances**
only, not for external production nodes.

Design rules:

- mule-doctor may supervise zero or more local rust-mule instances
- each managed instance must have a stable instance id such as `a`, `b`, or `c`
- each managed instance must have an isolated runtime directory
- all lifecycle actions must flow through an explicit `InstanceManager`
- the operator console should be the primary control surface

Per-instance runtime isolation:

```text
/data/instances/<id>/
├─ config.toml
├─ token
├─ debug.token
├─ logs/
├─ state/
└─ runtime metadata
```

Per-instance requirements:

- dedicated API port
- dedicated log path
- dedicated token/debug-token files
- dedicated persisted mule-doctor observation namespace

The rust-mule binary should normally be shared from the container build output
rather than copied per instance. Configuration and runtime state, not the
binary itself, define each managed instance.

The `InstanceManager` is responsible for:

- allowed instance definitions
- integration point for `ManagedInstancePresetService`, which applies built-in or configured cluster presets via planned instance creation
- runtime directory creation
- generated per-instance `config.toml` ownership enforcement
- process start/stop/restart
- port allocation and conflict checks
- health and lifecycle state
- log locations
- cleanup of mule-doctor-owned test instances

Managed config ownership boundary:

- mule-doctor always generates and owns `sam.session_name`, `general.data_dir`, `general.auto_open_ui`, and `api.port`
- the managed template may supply shared defaults such as `sam.host`, `sam.forward_host`, logging settings, API auth/debug settings, and additional sharing roots
- the current operator-facing input surface for those shared defaults is one bounded JSON template env var plus the in-process template object used by `InstanceManager`
- direct template ownership of conflicting keys such as `sam.session_name`, `general.data_dir`, `general.auto_open_ui`, `api.port`, or `sharing.share_roots` is rejected explicitly
- `sharing.share_roots` is still rendered by mule-doctor with the managed shared directory first; operators may only append extra roots through the supported template field

The observer, runtime store, and reporting layers currently support
single-target managed-instance observation through an explicit active
diagnostic target. Broader concurrent per-instance observation/reporting
namespacing remains deferred.

When managed-instance observation is enabled, mule-doctor must still have a
single explicit active diagnostic target for the scheduled observer loop. The
operator console may inspect many instances, but the periodic analyzer/reporting
path should only observe one target at a time until broader multi-instance
comparison semantics are designed.

Mattermost reports should include the observed target label so operators can
distinguish external-node reports from managed-instance reports.

---

# Source Code Tools

Environment variable:

`RUST_MULE_SOURCE_PATH`

Available functions:

```
search_code(query)
read_file(path)
show_function(name)
propose_patch(diff)
git_blame(file, line)
```

Example implementation:

```
async function searchCode(query: string) {
  const { exec } = await import("child_process");
  return new Promise((resolve, reject) => {
    exec(`rg -n "${query}" /repos/rust-mule`, (err, stdout) => {
      if (err) reject(err);
      resolve(stdout);
    });
  });
}
```

---

# Network Health Module

File:

`healthScore.ts`

Function:

`getNetworkHealth()`

Example return value:

```
{
  "score": 84,
  "components": {
    "peer_count": 92,
    "bucket_balance": 88,
    "lookup_success": 79,
    "lookup_efficiency": 82,
    "error_rate": 91
  }
}
```

Example scoring weights:

```
score =
0.25 * peer_count_score
+
0.20 * bucket_balance_score
+
0.25 * lookup_success_score
+
0.15 * hop_efficiency_score
+
0.15 * error_rate_score
```

Example Mattermost notification:

```
mule-doctor

Node status: DEGRADED

Network health score: 63 / 100

Observations:
- peer count stable (148)
- routing buckets balanced
- lookup success dropped to 47%
- lookup hops increased to 14

Possible causes:
- slow peers
- timeout configuration too aggressive
```

---

# LLM Prompts

Example diagnostic instruction:

```
Perform a routine diagnostic check of the node using available tools.

Look for:

- peer count anomalies
- routing bucket imbalance
- lookup success degradation
- repeated errors in logs

Report a concise health summary.
```

---

# System Prompt

```
You are mule-doctor, a diagnostic assistant for rust-mule.

rust-mule is a Kademlia-based distributed hash table (DHT) node that participates in a decentralized peer-to-peer network.

Your job is to analyze node behavior, detect anomalies, and explain the health of the node and the surrounding network.

You are not a chatbot. You are a distributed systems diagnostic engineer.

You have access to tools that can query node state and retrieve logs. Prefer using tools instead of guessing.

Your goals:

1. Diagnose node health
2. Detect routing table issues
3. Detect peer churn or connectivity problems
4. Detect lookup failures or abnormal hop counts
5. Identify bootstrap instability
6. Identify log patterns that indicate network problems

When diagnosing the node consider:

- peer count
- routing bucket distribution
- lookup success rate
- average lookup hop count
- peer churn
- bootstrap attempts
- timeout or connection errors in logs

If information is missing, call a tool to retrieve it.

Do not invent node state or logs.

Use tools to retrieve:

- node information
- peer lists
- routing buckets
- lookup statistics
- recent logs

Use multiple tools if necessary before forming a conclusion.

When reporting results:

- Be concise
- Focus on actionable observations
- Explain anomalies clearly
- Avoid speculation without evidence

Structure diagnostic output as:

Node status:
(short summary)

Observations:
- bullet points describing detected patterns

Possible causes:
- likely explanations for observed behavior

Suggested actions:
- practical debugging or remediation steps

If the node appears healthy, report that clearly.

If debug endpoints are unavailable, continue analysis using available data.

Accuracy is more important than verbosity.
```

---

# Container Layout

```
/opt/rust-mule     source + compiled binary
/app               mule-doctor code
/data              runtime volume
/data/token
/data/logs
/data/mule-doctor
/data/instances    managed rust-mule test instances
```

---

# Container Runtime Contract

The current container runtime uses a multi-stage Docker build:

- a Rust builder stage compiles `rust-mule`
- a Node builder stage compiles mule-doctor
- a slim runtime stage bundles:
  - `/opt/rust-mule`
  - `/app/dist`
  - `/entrypoint.sh`
  - `/app/scripts/container-healthcheck.sh`

The runtime image defaults to:

- `RUST_MULE_API_URL=http://127.0.0.1:17835`
- `RUST_MULE_TOKEN_PATH=/data/token`
- `RUST_MULE_LOG_PATH=/data/logs/rust-mule.log`
- `RUST_MULE_SOURCE_PATH=/opt/rust-mule`
- `MULE_DOCTOR_DATA_DIR=/data/mule-doctor`
- `MULE_DOCTOR_UI_ENABLED=false`
- `MULE_DOCTOR_UI_HOST=127.0.0.1`
- `MULE_DOCTOR_UI_PORT=18080`

It also declares:

- `VOLUME ["/data"]`
- `EXPOSE 17835 18080`
- a Docker `HEALTHCHECK`
- `USER mule`
- `CMD ["/entrypoint.sh"]`

---

# Entrypoint Contract

The container entrypoint is responsible for rust-mule bootstrap, not just mule-doctor startup.

At startup it:

1. creates runtime directories for logs and pid files
2. validates the rust-mule binary and config file
3. launches rust-mule
4. waits for the token file at `RUST_MULE_TOKEN_PATH`
   - it must exist, be readable, and be non-empty
5. exports `RUST_MULE_TOKEN_PATH`
6. launches mule-doctor
7. exits non-zero if either managed process exits unexpectedly

---

# Readiness Layers

mule-doctor runtime readiness is intentionally split into layers:

- `entrypoint.sh` handles process bootstrap and token-file wait semantics
- `src/startup/readiness.ts` validates mule-doctor runtime prerequisites such as:
  - readable token files
  - accessible rust-mule log parent directory
  - writable mule-doctor persistence and artifact directories
- the container `HEALTHCHECK` verifies steady-state process liveness and local HTTP readiness
- `scripts/smoke-compose.sh` is the canonical end-to-end validation path for the composed stack

This split is deliberate:

- bootstrap concerns stay in the shell/container boundary
- mule-doctor validates only the prerequisites it directly depends on
- ongoing health is handled by the Docker healthcheck and smoke harness, not by startup validation alone

---

# Operational Validation

- `npm run smoke:docker` is the canonical container-stack validation path.

That smoke run should prove:

- the image builds successfully
- the entrypoint launches rust-mule and mule-doctor in the expected order
- rust-mule reaches local readiness with `status.ready=true` and `searches.ready=true`
- the operator console responds with authenticated `GET /api/health` when enabled
- runtime artifacts are persisted under `/data`

---

# Logging

rust-mule should run with structured logging enabled when possible.

Example:

```
RUST_LOG=rust_mule=debug
```

Logs should be written to:

```
/data/logs/<rust-mule>.log
```

---

# LLM Call Logging

Stored in:

```
/data/mule-doctor/LLM_<timestamp>.log
```

Each LLM interaction records:

- timestamp
- model
- tokens_in
- tokens_out
- estimated_cost

---

# Usage Reporting

Once per day a summary of usage should be sent to Mattermost.

Example payload:

```
{
  "username": "mule-doctor",
  "icon_emoji": ":moneybag:",
  "text": "rust-mule spending report",
  "attachments": [
    {
      "title": "Today's spending",
      "color": "#f1c40f",
      "text": "..."
    },
    {
      "title": "Monthly total",
      "color": "#3498db",
      "text": "..."
    }
  ]
}
```

---

# Future Functionality

Future versions may allow the LLM to:

1. apply patches in a workspace copy of rust-mule
2. compile a test binary
3. launch a sandbox rust-mule instance
4. observe its behavior

The sandbox node will run separately from the primary node to avoid disrupting the live test network.
