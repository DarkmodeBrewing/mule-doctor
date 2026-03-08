# mule-doctor

mule-doctor is an AI-assisted diagnostic agent for rust-mule nodes.

It continuously observes node behavior through the rust-mule control plane (API), log files, and optional source code access. The system analyzes network health, detects anomalies, and reports observations to developers.

The tool is designed for debugging and research of Kademlia-based distributed hash table (DHT) behavior during development and soak testing.

---

## Architecture Overview

mule-doctor runs alongside a rust-mule node and observes its behavior through
three primary information sources:

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
rust-mule
│
├─ API (/api/v1)
├─ logs
│
└── mule-doctor
    │
    ├─ observer loop
    ├─ tool registry
    ├─ LLM diagnostics
    ├─ history storage
    └─ Mattermost reporting
```

The design intentionally separates:

- **data collection**
- **diagnostic reasoning**
- **reporting**

This keeps the system deterministic and easier to extend.

---

# Safety Policy

mule-doctor **never modifies the running rust-mule instance automatically**.

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

> mule-doctor must never be able to disrupt a running rust-mule node.

The system operates strictly as an **observer and advisor**, never as an
automatic control mechanism.

# LLM Model Used

`gpt-5-mini`

---

# Observer Loop

mule-doctor runs a periodic diagnostic loop.

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

Example state object:

```
{
  "lastRun": "2026-03-05T12:05:00Z",
  "lastHealthScore": 89,
  "logOffset": 2483291,
  "lastAlert": "routing_imbalance"
}
```

Example observer code:

```
const state = loadState();

const health = getNetworkHealth(metrics);

state.history.push({
  timestamp: new Date().toISOString(),
  score: health
});

if (state.history.length > 200) {
  state.history.shift();
}

state.lastHealthScore = health;

saveState(state);
```

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

Searches rust-mule logs using ripgrep.

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
/data              runtime state
/data/token
/data/logs
```

---

# Example Dockerfile

```
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    build-essential \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# install rust
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /opt

RUN git clone --depth 1 https://github.com/DarkmodeBrewing/rust-mule.git

WORKDIR /opt/rust-mule
RUN cargo fetch
RUN cargo build --release

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

COPY entrypoint.sh /
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
```

---

# Example Entrypoint

```
#!/usr/bin/env bash
set -e

echo "Starting rust-mule..."

/opt/rust-mule/target/release/rust-mule \
  --config /data/config.toml &

RUST_PID=$!

echo "Waiting for API token..."

while [ ! -f /data/token ]; do
  sleep 1
done

echo "Starting mule-doctor..."

node /app/dist/index.js

wait $RUST_PID
```

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
