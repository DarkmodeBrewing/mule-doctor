# mule-doctor LLM Tool Capability Reference

This document describes the tool surface that mule-doctor exposes to the LLM during diagnostic analysis.

Source of truth:

- [toolRegistry.ts](/home/coder/projects/mule-doctor/src/tools/toolRegistry.ts)
- [sourceCodeTools.ts](/home/coder/projects/mule-doctor/src/tools/sourceCodeTools.ts)

## Overview

mule-doctor does not let the LLM call rust-mule or the filesystem directly.
Instead, the LLM gets a bounded set of registered tools through the OpenAI tool-calling interface.

Each tool is exposed as a function definition with:

- a stable tool name
- a description
- a JSON-schema-like parameter object

Each invocation returns a structured envelope:

Successful result:

```json
{
  "tool": "getNodeInfo",
  "success": true,
  "data": {}
}
```

Failed result:

```json
{
  "tool": "getNodeInfo",
  "success": false,
  "error": "..."
}
```

Unknown tool names also return structured failure results instead of throwing into the LLM loop.

## Tool Categories

The current tool surface falls into two groups:

1. general diagnostic and source-inspection tools
2. rust-mule-specific runtime and debug tools

## General Tools

These tools are not tied to one specific rust-mule API endpoint. They provide mule-doctor history access, recent log inspection, and optional source-repository inspection.

### `getRecentLogs`

Purpose:

- returns recent rust-mule log lines from mule-doctor's recent log source

Arguments:

```json
{
  "n": 50
}
```

Notes:

- `n` is optional
- default `50`
- bounded to `1..1000`

### `getHistory`

Purpose:

- returns recent persisted mule-doctor history snapshots

Arguments:

```json
{
  "n": 50
}
```

Notes:

- only available when a runtime store is configured
- `n` is optional
- default `50`
- bounded to `1..1000`

### `getDiscoverabilityResults`

Purpose:

- returns recent persisted controlled discoverability checks recorded by mule-doctor

Arguments:

```json
{
  "n": 10
}
```

Notes:

- only available when a runtime store is configured
- `n` is optional
- default `10`
- bounded to `1..100`
- sanitizes returned records to a bounded summary shape instead of exposing the full stored payload
- fixture records omit sensitive fields like absolute paths and fixture tokens, even if older stored records still contain them

### `getDiscoverabilitySummary`

Purpose:

- returns a compact summary of recent controlled discoverability outcomes

Arguments:

```json
{
  "n": 10
}
```

Notes:

- only available when a runtime store is configured
- `n` is optional
- default `10`
- bounded to `1..100`
- returns derived counts/trends such as `found`, `completed_empty`, `timed_out`, success rate, latest outcome, and last success time

### `searchLogs`

Purpose:

- searches recent rust-mule logs using bounded literal substring matching

Arguments:

```json
{
  "query": "bootstrap",
  "n": 500,
  "limit": 50,
  "caseSensitive": false
}
```

Returns:

- original query
- scanned line count
- total match count
- bounded list of matching log lines

Notes:

- `query` is required and must be non-empty
- this is not regex search
- matching is safe bounded substring matching
- `n` defaults to `500`, bounded to `1..5000`
- `limit` defaults to `50`, bounded to `1..200`

## Optional Source-Inspection Tools

These tools are only registered when `RUST_MULE_SOURCE_PATH` is configured.

They are intended for read-only investigation plus patch proposal generation for human review.

### `search_code`

Purpose:

- searches source files under `RUST_MULE_SOURCE_PATH` for literal text matches

Arguments:

```json
{
  "query": "handshake"
}
```

Returns:

- original query
- scanned file count
- total match count
- bounded list of matches with `path`, `line`, and preview text

Notes:

- required non-empty `query`
- searches Rust-project text files only
- excludes directories such as `.git`, `node_modules`, `target`, `dist`, and `build`
- excludes sensitive paths such as `.env`, `.git`, and key/certificate-like files

### `read_file`

Purpose:

- reads one source file relative to `RUST_MULE_SOURCE_PATH`

Arguments:

```json
{
  "path": "src/lib.rs"
}
```

Returns:

- normalized relative path
- file size
- truncation flag
- bounded text content

Notes:

- `path` is required
- path must be relative
- path may not escape the source root
- sensitive paths are blocked
- binary files are rejected
- output is bounded

### `show_function`

Purpose:

- finds Rust function definitions by name

Arguments:

```json
{
  "name": "handshake"
}
```

Returns:

- function name searched
- scanned Rust-file count
- total match count
- matches with `path`, `line`, and signature text

Notes:

- `name` is required and must be non-empty
- currently Rust-specific: it scans `.rs` files and matches Rust `fn` signatures

### `propose_patch`

Purpose:

- stores a unified diff proposal artifact for human review

Arguments:

```json
{
  "diff": "diff --git a/src/a.rs b/src/a.rs\n..."
}
```

Returns:

- `mode: "proposal_only"`
- `applied: false`
- bytes and line count
- saved artifact path
- message explaining that no source files were modified

Notes:

- `diff` is required and must be non-empty
- mule-doctor does not apply the patch
- it writes a proposal artifact only
- proposal size is bounded
- default artifact directory is `/data/mule-doctor/proposals`
- if configured, mule-doctor also notifies Mattermost about the proposal artifact

### `git_blame`

Purpose:

- runs `git blame` for a single file and line

Arguments:

```json
{
  "file": "src/lib.rs",
  "line": 42
}
```

Returns:

- normalized path
- line number
- commit
- author
- author email
- optional author time
- commit summary
- blamed line content

Notes:

- both `file` and `line` are required
- file path must stay within `RUST_MULE_SOURCE_PATH`
- sensitive paths are blocked
- result is derived from porcelain blame output

## rust-mule-Specific Tools

These tools use mule-doctor's configured `RustMuleClient` and are directly tied to rust-mule runtime state or debug endpoints.

### `getNodeInfo`

Purpose:

- returns basic rust-mule node information from the status endpoint

Arguments:

```json
{}
```

Typical data:

- node ID
- version
- uptime
- raw status-derived fields

Notes:

- uses rust-mule `/status`
- mule-doctor normalizes `nodeId`, `version`, and `uptime`
- if the endpoint is transiently unavailable, mule-doctor may fall back to an `"unknown"` summary instead of hard-failing

### `getPeers`

Purpose:

- returns the currently connected peer list

Arguments:

```json
{}
```

Typical data:

- peer ID
- address
- optional latency and additional upstream fields

Notes:

- uses rust-mule `/kad/peers`
- mule-doctor normalizes peer IDs and addresses where possible
- transient read failures may degrade to an empty list

### `getRoutingBuckets`

Purpose:

- returns routing-table bucket state

Arguments:

```json
{}
```

Typical data:

- bucket index
- entry count
- normalized `size`

Notes:

- uses rust-mule debug endpoint `/debug/routing/buckets`
- requires bearer auth and, when configured, `X-Debug-Token`
- if the debug endpoint is disabled, rejected, missing, or transiently unavailable, mule-doctor returns an empty result rather than crashing the analysis loop

### `getLookupStats`

Purpose:

- returns aggregate lookup and event statistics

Arguments:

```json
{}
```

Typical data:

- total lookups
- successful lookups
- failed lookups
- derived ratios such as `matchPerSent` and `timeoutsPerSent`
- outbound shaper delay totals

Notes:

- uses rust-mule `/events`
- mule-doctor derives normalized summary fields from raw counters
- transient read failures degrade to a zeroed fallback result

### `triggerBootstrap`

Purpose:

- triggers debug bootstrap restart and polls until the job reaches a terminal state

Arguments:

```json
{
  "pollIntervalMs": 500,
  "maxWaitMs": 15000
}
```

Returns:

- rust-mule bootstrap job payload
- normalized `jobId`
- normalized terminal `status`

Notes:

- uses rust-mule debug endpoint `/debug/bootstrap/restart`
- then polls `/debug/bootstrap/jobs/{jobId}`
- requires debug endpoint access
- `pollIntervalMs` defaults to `500`, bounded to `10..30000`
- `maxWaitMs` defaults to `15000`, bounded to `100..300000`

### `traceLookup`

Purpose:

- starts a debug trace lookup and returns per-hop results

Arguments:

```json
{
  "target_id": "abcd",
  "pollIntervalMs": 500,
  "maxWaitMs": 15000
}
```

Returns:

- trace payload
- normalized `traceId`
- normalized terminal `status`
- normalized hop list

Notes:

- `target_id` is optional
- uses rust-mule debug endpoint `/debug/trace_lookup`
- then polls `/debug/trace_lookup/{traceId}`
- requires debug endpoint access
- hop fields are normalized where possible, including peer ID, distance, RTT, returned contacts, and error text

## Registration Conditions

Always registered:

- `getNodeInfo`
- `getPeers`
- `getRoutingBuckets`
- `getLookupStats`
- `getRecentLogs`
- `searchLogs`
- `triggerBootstrap`
- `traceLookup`

Conditionally registered:

- `getHistory`
- `getDiscoverabilityResults`
- `getDiscoverabilitySummary`
  - only when mule-doctor has a runtime store
- `search_code`
- `read_file`
- `show_function`
- `propose_patch`
- `git_blame`
  - only when `RUST_MULE_SOURCE_PATH` is configured

## Safety and Capability Boundaries

The tool surface is intentionally bounded.

Important limits:

- the LLM cannot issue arbitrary HTTP requests
- the LLM cannot execute arbitrary shell commands through the normal analysis tool surface
- source inspection is restricted to the configured source root
- sensitive files and paths are blocked from search/read/blame
- `propose_patch` does not modify source files; it writes review artifacts only
- rust-mule debug tools depend on the configured debug-token path and upstream debug endpoint availability

## Current Design Notes

Some tools are operationally tolerant by design:

- `getNodeInfo`
- `getPeers`
- `getRoutingBuckets`
- `getLookupStats`

Those tools may return fallback data instead of failing hard when rust-mule endpoints are temporarily unavailable. That keeps the observer/LLM loop running, but it also means callers should treat empty or unknown values as meaningful degraded-state signals rather than assuming the node is healthy.
