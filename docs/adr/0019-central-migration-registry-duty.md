# ADR 0019: Central migration registry duty is a plan-sanctioned scope exception, enforced at graph build

Date: 2026-08-28
Status: Accepted
Deciders: Archon runtime recovery maintainer (maintenance mission, per operating contract)

## Context

`packages/persistence/test/migrator.spec.ts` asserts EXACTLY the full G0
migration script set (lexicographic, apply-on-PGlite, lease-fenced). Every G0
package that adds a `migrations/g0_<family>_<n>_*.sql` script must extend that
central registry in the same package — the mechanism earlier packages used
(g0-provider-lifecycle's tasks.md explicitly names the file and declares the
scope exception).

The g0-cost-capacity planning artifacts omitted the duty. Its wave therefore
landed four `g0_cost_*` scripts while the central suite legally refused every
repair that touched the registry: runs ac65cd8b and 10c189e4 each exhausted
their bounded fast-repair budgets (CODEX_REPAIR_EXHAUSTED) with 5 migration
suite failures the repair loop was never allowed to fix — a deterministic
non-convergence burned across repeated waves.

## Decision

1. The g0-cost-capacity tasks amend T011 to carry the central-registry duty
   (add the four `g0_cost_` scripts in lexicographic position), naming
   `packages/persistence/test/migrator.spec.ts` so the task-graph builder
   records the plan-sanctioned scope exception and demotes the unit into the
   serial core lane.
2. `build-implementation-task-graph.mjs` now refuses at graph build
   (`CENTRAL_MIGRATION_SUITE_UNREFERENCED`) when a package's tasks predict NEW
   migration scripts (paths not yet on disk) without naming the central suite.
   The refusal costs zero writer tokens, versus discovering the defect after
   three repair rounds.

## Consequences

- Every future migration-family package is forced to plan the registry update
  up front; the graph-build refusal names the exact missing duty.
- Existing packages are unaffected (their migration scripts already exist on
  disk; the guard only fires for not-yet-existing script paths).
- The central registry remains the single authority for the G0 script set —
  no ownership widening of `packages/persistence/**` beyond the per-package
  exact-path exception.
