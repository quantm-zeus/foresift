# ADR 0022: The central migration registry duty is generation-agnostic

Date: 2026-09-02
Status: Accepted
Deciders: Archon milestone planning reviewer pass (per operating contract)

## Context

ADR-0019 made the central migration registry duty fail-closed at graph build:
`build-implementation-task-graph.mjs` refuses (`CENTRAL_MIGRATION_SUITE_UNREFERENCED`)
when a package's tasks predict NEW migration scripts without naming
`packages/persistence/test/migrator.spec.ts`. But the detection regex was
pinned to the G0 generation (`/^migrations\/g0_[a-z]+_\d+.*\.sql$/`), while the
central suite itself asserts the full script set across all generations.

Consequence: every G1 task writing `migrations/g1_*.sql` yields
`predictsNewMigrationScript === false`, so a planner that omits the registry
duty sails through graph build with the exception unrecorded. The wave guard
then legally refuses every repair touching the central suite, and the failure
surfaces only as a deterministic `persistence` test failure inside package
verification — the exact late, repair-budget-burning mode ADR-0019 exists to
prevent (two full runs exhausted on g0-cost-capacity before the tripwire).

The G1 plan (specs/implementation/current-milestone.json) serializes on this
duty for all eight packages; the independent plan review flagged the gap as
HIGH before the plan PR landed.

## Decision

1. The graph-build detection regex is widened to the generation-agnostic
   `/^migrations\/g\d+_[a-z]+_\d+.*\.sql$/`, so `CENTRAL_MIGRATION_SUITE_UNREFERENCED`
   fires for any generation's not-yet-existing script prediction.
2. The ADR-0019 duty statement is restated generation-agnostically: every
   package whose tasks predict new `migrations/g<N>_<family>_<n>_*.sql`
   scripts must extend the central suite in the same package (plan-sanctioned
   exact-path scope exception, unchanged).
3. A regression test in `tests/automation/impl-wave.spec.ts` pins the G1-class
   case (a `migrations/g1_m_0001_*.sql` prediction without the central suite
   is refused at graph build).

## Consequences

- Future milestones (G2+) inherit the enforcement with no further guard edits.
- Existing landed packages are unaffected: their migration scripts exist on
  disk, and the guard only fires for not-yet-existing script paths.
- No ownership widening of `packages/persistence/**`; the exception remains
  the per-package exact-path `packages/persistence/test/migrator.spec.ts`.
