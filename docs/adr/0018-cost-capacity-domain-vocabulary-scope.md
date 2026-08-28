# ADR 0018: g0-cost-capacity owns a packages/domain/** vocabulary extension

Date: 2026-08-28
Status: Accepted
Deciders: Archon runtime recovery maintainer (maintenance mission, per operating contract)

## Context

The merged planning artifacts for `g0-cost-capacity` (seeded by PR #82) assign
task T004/T006 to extend the shared domain vocabularies
(`packages/domain/src/cost.ts`, `packages/domain/src/index.ts`,
`packages/domain/test/cost.spec.ts`). The package's `writeScopes` in
`specs/implementation/current-milestone.json` did not include
`packages/domain/**`, so the wave guard rejected the core writer's work
deterministically (run 2dcf58d2 and run 265f6fe1 both failed with
`WRITE-AUTHORITY VIOLATION in core: packages/domain/src/cost.ts,
packages/domain/src/errors.ts`) and the package stalled in `paused_fatal`.

`packages/domain` is the established shared-vocabulary home: every G0 family's
enums and parse helpers live there (`chain.ts`, `asset.ts`, `pool.ts`,
`launch.ts`, `tool.ts`, `quality.ts`, ...), and both prior packages that needed
new vocabularies (`g0-contracts-data-truth`, `g0-tool-core`) own
`packages/domain/**` in their writeScopes. No pending package lists
`packages/domain/**`, so the widening cannot collide with future G0 waves.

## Decision

1. `packages/domain/**` is added to `g0-cost-capacity`'s `writeScopes`, making
   the merged plan's vocabulary task legal without exception bookkeeping.
2. The planning artifacts are corrected where they contradicted themselves:
   T004's relative backtick (`src/cost.ts`) becomes the full repo-relative path
   (the task-graph builder drops relative backticks, which is why the file was
   in neither `allowedWritePaths` nor `scopeExceptions`), T001 no longer
   instructs vitest runner config files (Bun Test is the test authority;
   existing packages carry no runner config), and T045's writeScope-exclusivity
   note names the domain extension.
3. No other package's scopes change; `packages/tool-core/**` remains outside
   this package's write authority (T018/T022 consume proven seams, never edit
   them).

## Consequences

- The wave guard's package-scope check admits the planned domain vocabulary
  extension; cross-lane ownership (`othersPredicted`) still prevents collisions
  inside a wave.
- Future packages that need new domain vocabularies should list
  `packages/domain/**` in their own writeScopes at milestone planning time;
  relying on planner prose to widen authority after the fact is what produced
  this failure chain.
