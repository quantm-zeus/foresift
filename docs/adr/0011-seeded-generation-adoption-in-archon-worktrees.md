# ADR-0011: Seeded-generation adoption in Archon run worktrees

## Status

Accepted (2026-08-23)

## Context

The V3 override requires generation 1 of `g0-contracts-data-truth` to start
from final V3 main with salvaged product work seeded onto
`foresift/g0-contracts-data-truth-g1` (via the supported restart command's
`--salvage-manifest` seeding), and explicitly demands that the pre-seeded
Archon path be tested BEFORE any real launch.

A live probe (`foresift/smoke-g1-seed-probe`, 2026-08-23) proved how Archon
v0.9.0 actually derives run worktrees: `archon workflow run --branch <b>`
creates a FRESH worktree on a new `archon/task-<b>` branch pinned at MAIN's
tip. A pushed branch named `<b>` is never consulted; its content is silently
absent from the execution while every supervisor identity surface still
records it as the package's branch. Two further gaps follow for generation ≥ 1
launches:

1. The launch message `<id>@g<N>` doubles as `$ARGUMENTS`; every workflow node
   passes it to scripts expecting a bare package id (milestone lookups would
   fail at the first gate).
2. The seeded branch would be invisible (above), defeating salvage.

Historical confirmation: even the retired G0 execution pushed
`archon/task-foresift-g0-contracts-data-truth` — the `--branch` launch flag
never bound the actual execution branch.

## Decision

Both gaps are bridged inside the ONE optimized workflow (the only lane that
ever sees an `@g<N>` message); the legacy lane is untouched:

1. `generation-adoption` runs FIRST, before preflight and all AI spend.
   `scripts/automation/adopt-generation-branch.mjs` parses `<id>@g<N>` and:
   - generation 0 → no-op;
   - no `foresift/<id>-g<N>` on origin → legitimate fresh start from main;
   - seed present → fail-closed unless it CONTAINS current origin/main
     (ADR-0010 semantics: stale seeds reconcile first), ancestry is
     verifiable (no shallow checkouts), and the worktree is clean; then
     ADOPTS it via `git checkout -B foresift/<id>-g<N> <sha>` so the
     execution branch, pushes, PR head, and landing all carry the real §6
     generation identity instead of `archon/task-*`.
2. All script call sites in the optimized workflow consume
   `${ARGUMENTS%%@g*}` so milestone-state lookups receive the bare id.
   Prose prompt mentions keep the suffixed label (cosmetic only).
3. `foresift-smoke-gen-adoption.yaml` — a deterministic zero-AI workflow —
   re-proves the whole path through real Archon machinery (seed marker must
   survive into the run worktree on the renamed branch). It is the mandatory
   pre-activation smoke for any generation ≥ 1 launch and after Archon
   upgrades.

## Consequences

- Salvage seeds are physically carried into execution or the run refuses —
  never silently discarded.
- Execution branches regain their §6 identity end-to-end (branch name, PR
  head, landing), instead of archon-internal task names.
- Adoption is deterministic and costs one fetch + one checkout before any AI
  spend; refusal modes are explicit and fail-closed.
- The behavior is pinned to Archon v0.9.0 worktree derivation; the smoke
  guards future Archon upgrades.

## Verification

- Hermetic fixtures: `tests/automation/v3-generations.spec.ts`
  (`adoptGenerationBranch`) — gen-0 no-op, fresh-start, happy adoption,
  stale-seed refusal, dirty-worktree refusal, unparseable message.
- Live probe: `foresift-smoke-gen-adoption` run via `archon workflow run`
  against a pre-seeded branch (evidence in the V3 report).
