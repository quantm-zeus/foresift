# ADR 0007: Workflow variant selection by throughput profile, and the `foresift:gate` invocation repair

- Status: Accepted
- Date: 2026-08-23
- Relates to: [ADR 0006](./0006-throughput-profiles-proven-dedupe-attestation.md) (profiles, dedupe, attestation)

## Context

ADR 0006 introduced LEGACY/OPTIMIZED profiles but left every package running
the same Archon workflow (`foresift-work-package`). Its throughput behaviors
(slices, checkpoints, FAST verification, deterministic landing) live in command
bodies; putting them into the SHARED workflow would change the DAG's prompt
surface for `g0-contracts-data-truth` — the LEGACY lane that must keep its
behavioral implementation profile forever.

Separately, a latent invocation defect was discovered while copying the
workflow: `pnpm foresift:gate -- --package <id>` exits 2 (usage error) because
pnpm forwards the bare `--` separator to the script as a positional argument
(verified empirically 2026-08-23). The gate-router, gate-rerun, and gate-iter
nodes — plus two commands and the gate's own usage string — used that form.
No prior run ever reached those nodes (G0 is still mid-plan), so the defect was
latent, not historical.

## Decision

1. **Workflow variant per profile.** A new packaged workflow
   `foresift-work-package-optimized` carries the OPTIMIZED lane: byte-identical
   DAG topology and guards (the empirically verified v0.9 semantics are not
   re-tested by variation), with exactly two command-body swaps:
   `foresift-wp-implement` → `foresift-wp-implement-optimized` and
   `foresift-wp-ci-merge` → `foresift-wp-ci-merge-optimized`. The supervisor's
   deterministic `workPackageWorkflow(packageId)` picks the variant from
   `throughputProfile()` for launches AND stranded-run adoption; tracked
   entries record the actual workflow name so recovery identity stays exact.
   `g0-contracts-data-truth` keeps launching the original workflow unchanged.
2. **Gate invocation repair at the source.** The gate parser now tolerates a
   bare `--` positional, and all call sites were normalized to the canonical
   `pnpm foresift:gate --package <id>` / `--milestone` form. For the LEGACY
   workflow this is a correctness repair restoring intended behavior (the gate
   phase was always meant to execute), not an optimization; both forms are now
   equivalent.
3. **Runtime smoke proof.** `foresift-smoke-throughput` (bash-only, no provider
   spend) proves inside the real Archon runtime: checkpoint build→validate is
   valid; hash invalidation actually DRIVES loop iteration (tamper → guard
   fails → auto-iteration → rebuild → guard passes); `package-full-gate
--check` fails closed with no attestation; the dedupe classifier runs
   fail-closed over real milestone metadata.

## Consequences

- The LEGACY lane is protected structurally again: its DAG file and its command
  bodies are untouched by throughput work.
- New OPTIMIZED behavior ships without touching proven loop semantics,
  shrinking the smoke surface to the swapped command bodies plus the new bash
  smoke workflow.
- Every future gate phase (any profile) no longer risks a guaranteed-fail
  repair-loop burn on the `--` forwarding defect.

## Verification

- `archon validate workflows` / `commands`: all ok (27 workflows, 52 commands).
- Selftest S17: LEGACY fixture launches `foresift-work-package`; OPTIMIZED
  fixture launches `foresift-work-package-optimized`; adoption path matches the
  profile-correct name. Suite 106/106.
- Live smoke run of `foresift-smoke-throughput` after merge (activation step,
  §28) — recorded in `.optimizer-evidence/prB2-workflow-integration.md`.
