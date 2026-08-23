# ADR-0009: Durable execution generations and supported fresh-generation restart with salvage

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** Foresift V3 control-plane mission (task spec §6–§8; live override §§4–16)
- **Scope:** Control plane only — no product behavior, no change to the
  read-only product boundary.

## Context

The retired generation-0 execution of `g0-contracts-data-truth` reused ONE
execution identity — package id `g0-contracts-data-truth`, branch
`foresift/g0-contracts-data-truth`, worktree message `g0-contracts-data-truth` —
across five successive Archon runs (stale-abandon handoffs, fatal pauses,
operator recoveries, one automatic fresh restart). Because every identity
surface was identical, "is this the same execution?" was unanswerable, stale-run
adoption was a live hazard (a lagging runs-table row could be re-adopted as if
it were the current attempt), and there was no supported way to say "this
execution is dead; start over" without silently continuing the same identity.

At the same time, that retired generation produced verified PRODUCT work (~31
commits, T-series implementation, migrations, acceptance/negative tests) on PR
#22. Execution identity is not product code: the runs are dead forever, but the
verified product work is salvage where it still satisfies current authority.

## Decision

1. **Durable per-package execution generations** (`scripts/automation/package-generations.mjs`).
   `packages[].generation` in the version-controlled milestone state
   (absent ⇒ 0, non-negative integer, validated by `schema.mjs`) participates in
   EVERY identity surface:
   - branch: `foresift/<id>` (gen 0) vs `foresift/<id>-g<N>` (gen ≥ 1)
   - Archon correlation message: `<id>` vs `<id>@g<N>`
     The message doubling as the correlation key is load-bearing: runs-table
     discovery/adoption matches on workflow+message, so a generation-N lookup can
     never adopt a generation-M row. Stale identities are invisible to fresh ones
     BY CONSTRUCTION, not by filtering.
2. **Generation-aware workflow routing** (§8). Generation ≥ 1 always launches
   the single optimized topology (`foresift-work-package-optimized`). Generation
   0 keeps the historical LEGACY/OPTIMIZED profile table unchanged — the retired
   `g0-contracts-data-truth` remains LEGACY forever as forensic truth. There is
   exactly ONE optimized workflow; no second copy exists or may be created.
3. **A supported deterministic restart command**
   (`--restart-package <id> --fresh-generation [--reason …] [--salvage-manifest …]`),
   never hand-edited state:
   - crash-safe via an intent record written BEFORE any mutation and adopted
     verbatim on rerun;
   - idempotent: a completed receipt replays with exit 0; a second identical
     invocation CANNOT create another generation (duplicate gate keyed on
     receipt-for-current-generation + absence of launch evidence), with
     `--confirm-new-generation` as the deliberate operator override;
   - refuses when anything of the current generation is still live (tracked run
     or runs-table row); retires older-generation rows via the supported
     abandon lifecycle only;
   - bumps `generation` exactly once through the normal versioned-commit path
     (unconditional persist — `setPackageStatus` alone would short-circuit for
     an already-PENDING package and silently drop the bump);
   - emits a schema'd receipt (`foresift/restart-receipt@1`) on stdout as the
     only stdout payload; all supervisor logging goes to stderr.
4. **Salvage as a first-class, deterministic phase** (`generation-salvage.mjs`,
   override §§4–13): CURRENT V3 MAIN WINS for every control-plane surface;
   root manifests reconcile additively (never copied over current main);
   lockfile state settles ONLY through the package manager; product paths and
   package-spec artifacts transplant path-level from the salvage tip; colliding
   ADR numbers renumber above the union of both sides; task checkboxes
   reconstruct fail-closed (a checked task whose acceptance criteria lack
   locatable test evidence REOPENS). When a salvage manifest accompanies a
   restart, the new `foresift/<id>-g<N>` branch is SEEDED at final-V3-main
   origin/main inside a dedicated linked worktree, transplanted, lockfile-settled,
   and pushed BEFORE any agent launches, so the launcher pins a pre-seeded
   generation branch instead of creating an unseeded one from main.

## Consequences

- Cross-generation resume/refusal is enforced in `--recover-fatal`: a paused
  identity from a different generation must go through the restart protocol,
  never resume.
- Restart receipts carry full provenance (retired runs/branch, final main head,
  source PR/branch/head, seed head, commit/task reuse counts), making every
  generation transition auditable from git + state alone.
- The duplicate gate makes "restart" and "re-invoke" distinguishable by
  evidence rather than operator memory; history trimming plus a lost receipt
  could in principle mask launch evidence — the documented remedy is the
  explicit confirm flag, which is auditable in the receipt trail.
- Salvage classification is deliberately conservative: UNKNOWN paths refuse
  the apply phase until inspected (fail-closed).

## Verification

- `tests/automation/v3-generations.spec.ts` — identity math, schema validation,
  salvage units (classification / additive reconciliation / ADR renumbering /
  task reconstruction incl. idempotency), and CLI flows against seeded git
  fixtures + stub archon: success-with-seed (branch pushed, obsolete control
  plane excluded, colliding ADR renumbered, tasks reopened fail-closed),
  §7 duplicate replay, deliberate confirm advance, tracked-live-run refusal,
  live current-generation row refusal, stale-intent refusal, foreign-manifest
  refusal, usage refusal, cross-generation recovery refusal.
- `supervisor-selftest.sh` S17 continues to prove LEGACY/OPTIMIZED routing at
  generation 0.
