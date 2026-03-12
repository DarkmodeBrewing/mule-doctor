# AGENTS.md

## Purpose

`mule-doctor` is an external diagnostics, orchestration, and observation tool for `rust-mule`.

Its responsibility is to:

- start, stop, and supervise `rust-mule` instances
- inspect health, logs, metrics, and debug endpoints
- analyze runtime behavior
- detect mismatches, failures, stalls, and regressions
- assist with testing and operational experiments

It is **not** part of the `rust-mule` protocol implementation.

---

## Core Principle

`mule-doctor` must treat `rust-mule` as an **observed system**, not as an internal library.

Prefer interaction through:

- documented HTTP endpoints
- metrics
- logs
- debug endpoints
- CLI entrypoints
- config files
- stable externally visible behavior

Avoid depending on undocumented implementation details.

---

## Allowed Cross-Repo Inspection

Agents may inspect the `rust-mule` repository to improve understanding of:

- expected runtime behavior
- message flow
- public/debug endpoint semantics
- log and metrics meaning
- configuration structure
- known protocol concepts relevant to diagnostics

This inspection is for **understanding**, not for creating hard dependencies on internals.

---

## Forbidden Coupling

Do **not** make `mule-doctor` depend directly on:

- private internal structs from `rust-mule`
- private helper function behavior
- undocumented log phrasing as the sole contract
- source file layout in `rust-mule`
- internal module names as operational dependencies
- implementation details that are not part of a stable external surface

If a needed behavior is only discoverable from internals, prefer proposing or using a proper debug or metrics surface instead.

---

## Preferred Integration Order

When adding new diagnostics or features, prefer these sources in order:

1. Existing documented endpoint or metric
2. Existing stable log/event output
3. Existing config or CLI surface
4. Existing debug endpoint
5. Proposal for a new explicit debug/metrics endpoint in `rust-mule`

The last resort is inference from internal source code.

---

## Architectural Rules

Keep `mule-doctor` separated into clear concerns:

- orchestration / process control
- data collection
- analysis / diagnosis
- reporting / handoff
- adapters for specific data sources

Do not collapse orchestration, parsing, analysis, and reporting into one large file.

Prefer small modules with explicit responsibilities.

---

## File and Module Discipline

- Prefer focused files and modules
- Avoid large monolithic files
- Keep parsing logic separate from diagnosis logic
- Keep transport/client code separate from analysis rules
- Keep `rust-mule`-specific adapters isolated behind clear interfaces

If a file grows large because of multiple responsibilities, refactor it.

---

## Diagnostics Philosophy

When diagnosing issues:

- prefer evidence over guesses
- cite the source of evidence: logs, metrics, endpoint output, config, or observed process state
- distinguish clearly between:
  - confirmed issue
  - probable issue
  - hypothesis
- avoid overstating conclusions

---

## Safe Agent Behavior

When implementing changes, agents should:

- first identify the observable contract being used
- verify whether the dependency is stable and external
- avoid binding logic to private `rust-mule` internals
- note any discovered mismatch or bug separately from the requested feature
- document opportunistic fixes in handoff notes and commit messages

---

## When a Missing Capability Is Found

If `mule-doctor` needs information that is only available by inspecting `rust-mule` internals, do one of the following:

- suggest a new debug endpoint
- suggest a new metric
- suggest a structured log/event
- suggest a config or CLI exposure

Prefer improving observability over scraping internals.

---

## Testing Expectations

New behavior should include tests where practical.

Prefer tests for:

- parsing
- diagnosis rules
- health evaluation
- failure classification
- orchestration edge cases

Do not rely only on manual runs if automated checks are feasible.

---

## Documentation Expectations

When adding or changing diagnostics behavior, update relevant documentation:

- expected inputs
- observable outputs
- assumptions
- limitations
- dependency on `rust-mule` external surfaces

---

## Practical Rule of Thumb

If a feature would break because `rust-mule` renamed an internal function or moved a file,
then `mule-doctor` is coupled too tightly.

If a feature continues to work because it relies on stable runtime surfaces,
then the boundary is probably correct.
