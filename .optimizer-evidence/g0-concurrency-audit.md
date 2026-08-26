# G0 package-level concurrency feasibility audit (2026-08-26)

Bounded follow-up per maintainer directive §5–§14. Deterministic, fail-closed;
every claim below cites committed truth or a rehearsed git operation. Companion
to the strengthened admission gate in `scripts/automation/schema.mjs`
(`canStartPackage`) and its regression pins in
`tests/automation/control-plane.spec.ts`.

## Existing machinery (found, not rebuilt)

The supervisor already owns a deterministic pairwise admission function —
`canStartPackage(roadmap, ms, candidate, runningPackages)` in
`scripts/automation/schema.mjs` — enforcing: policy caps (foundation=1,
standard=2), CRITICAL serialization both directions, parallelizable pairing,
direct/transitive dependency denial both directions, and declared writeScope
overlap denial. The selection loop re-runs it against the LIVE running set per
launch (dynamic slot filling), from COMMITTED milestone truth (defect #11 law).
This audit strengthens it; it does not replace it.

## Pair A: g0-tool-core × g0-provider-lifecycle

Dependency topology (committed current-milestone.json): tool-core deps =
[contracts✓, security✓]; provider deps = [contracts✓, security✓]. **No direct
or transitive relation** — the only G0 pair that is simultaneously launchable
today.

| Question                    | Verdict | Evidence                                                                                                                                                                                  |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEPENDENCY_SAFE             | YES     | no edge either direction                                                                                                                                                                  |
| WRITE_SCOPE_SAFE (declared) | NO      | both declare `packages/shared-schemas/**`, `tests/acceptance/**`, `tests/negative/**`                                                                                                     |
| ACTUAL_TASK_SCOPE_SAFE      | NO      | both plans mutate `packages/persistence/src/migrator.ts` (+ inventory spec); rehearsed CONFLICT                                                                                           |
| SHARED_SCHEMA_SAFE          | NO      | both add barrel exports in `packages/shared-schemas/src/index.ts` (provider landed in-wave; tool-core in adopted lineage)                                                                 |
| ROOT_FILE_SAFE              | YES     | neither declares root configs                                                                                                                                                             |
| LOCKFILE_SAFE               | NO      | both scaffold workspace packages ⇒ both regenerate `pnpm-lock.yaml` (order-sensitive; provider lane needed an explicit exception to do it lawfully)                                       |
| MIGRATION_SAFE              | NO      | shared migration filename-family registry: provider extends `(data\|dr\|sec)`→`+prov`; tool-core lineage ships `g0_core_*` requiring `+core` — same regex line, same inventory assertions |
| TEST_SCOPE_SAFE             | PARTIAL | AC-numbered acceptance/negative files and fixtures/ dirs are disjoint per family (narrowable false overlap); shared inventory-style test files are not                                    |
| INTEGRATION_SAFE            | UNKNOWN | concurrent landing semantics (squash-rewrite + absorb) never exercised; finalize-from-main requires current-main authority                                                                |
| CURRENT_RUNTIME_SAFE        | UNKNOWN | two full sharded waves = up to ~6 writer lanes; provider/CPU/disk ceilings unmeasured                                                                                                     |

Merge rehearsal (read-only `git merge-tree`, 2026-08-26 ~02:10Z): adopting
`foresift/g0-tool-core` tip `e9c0cdc` against the live provider wave core tip
`d9f3c549` yields **content conflicts in `packages/persistence/src/migrator.ts`
and `packages/persistence/test/migrator.spec.ts`** (both sides extend the same
alternation/inventory from the common ancestor).

### Verdict: REJECTED for concurrency

REAL_CONFLICT ×3 (migration registry, schema barrels, lockfile). These are true
shared architecture surfaces, not coarse-glob illusions — narrowing ownership
cannot remove them. Per directive §13/§21 the pair stays serial; this is a
correct fail-closed outcome, not a failure.

Documented unlock path (requires its own product-level mission, NOT this one):
make migration-family discovery data-driven/append-only (per-family manifests
unioned by the migrator instead of a single edited regex + enumerated test
inventory), generate barrel exports instead of hand-editing them, and adopt a
single lockfile-reconciliation strategy (directive §8 option A/B). Once those
land, the strengthened gate unlocks eligible pairs automatically — by
declaration, not by merge luck.

## Pair B: g0-first-party-observation × g0-mcp-surface

- Dependencies: both require cost-capacity (PENDING) — window not reachable yet.
- Committed task plans: none (planning happens at selection). Actual-path
  safety is therefore UNKNOWN ⇒ fail closed today, correctly.
- Declared overlaps of the same classes as pair A (`packages/shared-schemas/**`,
  `tests/acceptance/**`, `tests/negative/**`); mcp-surface additionally shares
  `packages/tool-core/**` with tool-core (irrelevant to THIS pair).
- The gate re-evaluates this pair deterministically at every future tick from
  whatever committed truth exists when the window opens. If plans declare
  disjoint families AND no root/shared surface claims, it may pass then.

## Gate strengthening landed with this audit

1. ROOT_SHARED_SURFACES rule: any package declaring `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`, `package.json`, `tsconfig.json`,
   `tsconfig.base.json`, or `eslint.config.js` in its writeScopes makes co-run
   impossible while it runs (global serialization claim).
2. Unknown-scope fail-closed: missing/empty writeScopes deny CO-RUN (unknown ≠
   safe-by-default); single-package serial start remains permitted.
3. `co_run_denied` supervisor event: every non-capacity pairwise refusal of an
   otherwise-eligible candidate is recorded once per process with its reason —
   concurrency refusals are evidence, not noise.

Roadmap policy intentionally UNCHANGED:
`maxParallelCodingPackagesFoundation` stays 1. Directive §15 permits raising
it only with a strong pair proof; this audit proves the opposite for the only
launchable pair. CRITICAL foundation serialization untouched.
