# Implementation Plan: g0-contracts-data-truth (generation 1 mirror)

**Branch**: `foresift/g0-contracts-data-truth-g1` | **Date**: 2026-08-24
**Spec**: `specs/g0-contracts-data-truth/spec.md` (scoped derivative; PRD-subordinate)
**Input**: Assigned requirements FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004,
FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002 from
`specs/implementation/current-milestone.json` (milestone G0, risk CRITICAL,
generation 1).

## Summary

Generation 0 of this package implemented all eight assigned requirements across
five workspace packages, eleven migrations, the full manifest-declared
acceptance/negative suites, and telemetry catalogs, then passed independent
review repair. That content is present on this branch as the adopted seed and is
byte-identical to the review-repaired generation-0 tip (`3367821`) inside every
package content scope (`packages/**`, `migrations/**`, `tests/fixtures/**`,
`tests/acceptance/**`, `tests/negative/**`, `telemetry/**`). Generation 1 is
therefore a **convergence generation**, not a build-out:

1. **Restore the remaining root-configuration deltas** versus the reviewed tip.
   An earlier baseline (at absorbed-main HEAD `5d098b8`) found four differing
   root-config files causing 105 TS5097 errors and five failing tests; since
   then this branch absorbed main's own tooling repair (`ac67972`), which
   already restored `tsconfig.json`'s converged include/exclude shape and
   `allowImportingTsExtensions` in `tsconfig.base.json`. Re-baselined at current
   HEAD `1cb934f`: typecheck GREEN (zero errors), full suite GREEN (63 files /
   444 tests). The remaining delta is exactly two functional edits — the
   `minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml` and root
   `package.json` devDependency ordering parity — plus one cosmetic ordering
   parity edit in `tsconfig.base.json`.
2. **Re-verify everything deterministically** after those edits: full
   `pnpm verify` (spec:verify, format:check, lint, typecheck, tests) plus the
   four package verification commands, at HEAD, leaving work uncommitted for
   review.

No requirement semantics change in this generation. The normative scope in
spec.md §2–§4 is restated for traceability; the engineering work below is the
minimal, evidence-backed path to a fully converged tree matching the reviewed
tip inside this package's write scopes.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (NodeNext, `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) on Node.js ≥24;
pnpm workspace.

**Primary Dependencies** (already installed and locked):

- `zod` — runtime validation for `packages/shared-schemas` (repository ADR-0013).
- `drizzle-orm` — typed access mirroring SQL migrations per product ADR-001.
- `@electric-sql/pglite` — deterministic in-process PostgreSQL test engine
  (repository ADR-0014).
- `vitest` — repo test runner, three projects incl. unit and integration.

**Storage**: PostgreSQL schema via `migrations/g0_data_*.sql` +
`migrations/g0_dr_*.sql` (source of truth) with Drizzle mirror
(`packages/persistence/src/generated/schema.ts`, parity-tested); content-addressed
object storage behind the `ObjectStoreAdapter` interface with a local filesystem
implementation and the §14.8 staged cross-store commit protocol.

**Testing**: Vitest at three layers — colocated package tests under
`packages/*/test/`; acceptance specs `tests/acceptance/AC-*.spec.ts`; negative
specs `tests/negative/AC-*.negative.spec.ts` — all 44 manifest-declared files
present and passing once the root-config defect is fixed. Golden fixtures under
`tests/fixtures/data/` and `tests/fixtures/dr/`.

**Target Platform**: Linux CI + local dev; single deployable modular monolith
(Constitution III).

**Performance Goals**: unchanged from generation 0 — persistence hot-path
benchmark fixtures assert §33-class internal overhead budgets with headroom
(AC-060 substrate).

**Constraints**: read-only product boundary (INV-001 / Constitution IV);
deterministic verification (XI); positive AND failure-path testing (XII);
every task traces to an assigned requirement or its acceptance criteria (X).

**Scale/Scope of remaining work**: two functional root-config edits
(`pnpm-workspace.yaml`, `package.json`), one cosmetic ordering edit
(`tsconfig.base.json`), verification of the two already-restored configs, then
the full deterministic re-verification. Zero changes to packages/, migrations/,
tests/fixtures, tests/acceptance, tests/negative, or telemetry are expected; if
verification surfaces one, it is fixed within writeScopes and recorded in
tasks.md.

## Constitution Check

_GATE: must pass before implementation. Re-checked after design._

| Principle                             | Verdict | Evidence                                                                                                                                                    |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I Product-Contract Authority          | PASS    | Scope limited to the eight assigned requirements; `docs/spec/**` untouched; spec.md marked subordinate.                                                     |
| II Greenfield Architecture            | PASS    | Generation-0 design was derived from PRD §§11/13/14/34/45 + Appendix D ADRs; this generation restores convergence state, it does not import foreign design. |
| III Modular-Monolith-First Simplicity | PASS    | No new services, brokers, or abstractions; restoring existing config only.                                                                                  |
| IV Read-Only Product Boundary         | PASS    | No execution/custody/signing/key-handling capability anywhere in restored configs or code; negative tests assert absence.                                   |
| V Point-in-Time Correctness           | PASS    | Replay boundary enforced in storage contract and query layer (AC-020 suite).                                                                                |
| VI Event-Time / Earliest-Availability | PASS    | `event_at` preserved; `available_at` = earliest proven availability; backfill receipts carry availability proofs.                                           |
| VII Provenance & Evidence             | PASS    | Availability-provenance classes, lineage records, content hashes all present and tested.                                                                    |
| VIII Fail-Closed Integrations         | PASS    | Unknown provenance class, missing quality code, unverified restore → refuse; verified by negative suites.                                                   |
| IX Provider/Capability Abstraction    | PASS    | Object store and clock behind internal interfaces; no vendor SDK leakage.                                                                                   |
| X Requirement Traceability            | PASS    | tasks.md maps each task to requirement IDs; validator-enforced.                                                                                             |
| XI Deterministic Verification         | PASS    | All gates are code (`pnpm verify`, package filters) run identically locally and in CI.                                                                      |
| XII Positive AND Failure-Path Testing | PASS    | All 22 assigned ACs keep acceptance + negative specs per manifest testRefs.                                                                                 |
| XIII Replay/Recovery/Idempotency      | PASS    | Fenced checkpoints, idempotent canonical-event constraints, replay-safe drill harness remain tested.                                                        |
| XIV Durable Resumable Operations      | PASS    | This plan itself persists continuation state on disk; migration state in `_foresift_schema_migrations`; drill state on disk.                                |
| XV Security & Least Privilege         | PASS    | No secrets introduced; key references only, never key material; policy tests enforce separation.                                                            |
| XVI Autonomous-Agent Governance       | PASS    | Material decisions recorded here and as accepted ADRs; out-of-scope gaps routed to the run's notes file.                                                    |
| XVII Additive Git History             | PASS    | Work stays uncommitted for review in this stage; landing goes through PR; no amend/rebase/force.                                                            |
| XVIII No AI Claim Is Completion       | PASS    | Completion decided by `package-plan-complete.mjs` now and by `pnpm verify`/CI later.                                                                        |

## Current-State Baseline (re-verified 2026-08-24 at HEAD `1cb934f`, after absorbing main's tooling repair)

| Check                | Status | Detail                                                                                                                        |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm spec:verify`   | GREEN  | 13 checks passed.                                                                                                             |
| `pnpm typecheck`     | GREEN  | Zero errors (absorbed main commit `ac67972` restored the glob-driven include shape and `allowImportingTsExtensions`).         |
| `pnpm test`          | GREEN  | 63 files / 444 tests passed, including `tests/acceptance/tooling-globs.spec.ts` (4/4) and the three automation e2e specs.     |
| Content-scope parity | GREEN  | `git diff --name-only 3367821 HEAD -- packages migrations telemetry tests/fixtures tests/acceptance tests/negative` is empty. |
| Root-config parity   | DELTA  | Exactly three files differ from the reviewed tip inside this package's root-config scopes (detailed below).                   |

**Remaining delta versus the review-repaired generation-0 tip** (`git diff HEAD
3367821 -- tsconfig.json tsconfig.base.json pnpm-workspace.yaml package.json`):

- `pnpm-workspace.yaml`: missing `minimumReleaseAgeExclude:
['@electric-sql/pglite@0.5.6']` — the mechanically emitted pnpm entry that was
  part of the reviewed state. Functionally inert while no release-age policy is
  configured, but its absence breaks parity with the reviewed tip and fresh
  installs would drift if a policy is re-enabled.
- `package.json`: devDependencies are listed in a different order than the
  reviewed tip (workspace packages after vitest instead of before `@types/*`);
  main-postdating scripts (`autopilot:restart-package`, `test:unit`,
  `test:integration`) are correctly present and KEPT per material decision 2.
- `tsconfig.base.json`: `allowImportingTsExtensions: true` is present but
  positioned after `verbatimModuleSyntax` instead of after `moduleResolution`;
  functionally identical — cosmetic ordering only.

All other differences between this branch and `3367821` are main's own shared
tooling, automation, and documentation evolution absorbed through
`5d098b8`/`1cb934f` — outside this package's write scopes and not its delta.

## Project Structure

### Documentation (this feature)

```text
specs/g0-contracts-data-truth/
  spec.md      # scoped derivative (PRD-subordinate)
  plan.md      # this file
  tasks.md     # ordered traceable breakdown
```

The scoped trio exists in TWO mirrored directories:
`specs/g0-contracts-data-truth/` (bare milestone id) and
`specs/g0-contracts-data-truth@g1/` (generation-1 execution identity,
authoritative), because the deterministic guards (`package-plan-complete.mjs`,
`package-implement-complete.mjs`) resolve `specs/<bare-id>/` while the Archon AI
commands read `specs/<id>@g<N>/`; divergent copies would let one surface see a
complete plan while another sees stale state. The two trios are kept identical
except for self-referential paths; every change to one is mirrored to the other.

### Source deltas (all inside binding writeScopes)

```text
tsconfig.json        # VERIFY converged shape already present (absorbed main):
                     #   include packages/*/src/**/*.ts, packages/*/test/**/*.ts,
                     #   tests/**/*.ts; exclude node_modules, dist — restore only if drifted
tsconfig.base.json   # VERIFY "allowImportingTsExtensions": true present (it is);
                     #   align its position with the reviewed tip (cosmetic ordering only)
pnpm-workspace.yaml  # ADD minimumReleaseAgeExclude entry for @electric-sql/pglite@0.5.6
package.json         # devDependency list ordering parity with the reviewed tip;
                     #   KEEP main's newer automation scripts (autopilot:restart-package,
                     #   test:unit, test:integration) that postdate generation 0
```

Everything else already exists byte-identical to the review-repaired tip:
`packages/{domain,shared-schemas,persistence,evidence,object-store}/`,
11 migrations, `telemetry/data.catalog.json`, `telemetry/dr.catalog.json`,
fixtures, and all 44 acceptance/negative spec files.

## Data Model

Unchanged from generation 0 (fully implemented): identity tables
(chains/dexes/asset_representations/assets+pools/pairs/launches/migrations/
token_decimal_observations), append-only observations with immutability
triggers + revision chains + compensating reorg events + backfill receipts +
watermarks, field-quality codes against the §13.9 vocabulary, source
identities/independence groups/dependence edges, feature definitions/values
with online-offline parity through a single shared computation module,
evidence acquisition decisions with write-before-retrieval ordering,
content-addressed object artifacts with staged commit states, fenced collector
checkpoints + gap registry + canonical event keys, recovery tiers
(≤15 min / ≤60 min / ≤24 h ceilings) + protected asset registry + backup
policies/runs + restore drills + recovery health states. Authoritative DDL:
`migrations/g0_data_0001…0007_*.sql`, `migrations/g0_dr_0001…0004_*.sql`;
Drizzle mirror parity-tested against information_schema.

## Verification Strategy (per acceptance criterion)

All 22 assigned ACs already have their manifest-declared positive and negative
specs; generation-1 verification re-executes them on the converged tree. The
engine stack is unchanged: PGlite in-process Postgres, real SQL migrations
applied by the migrator, ClockPort-injected deterministic time for availability
and RPO measurement.

| AC group                                   | Re-verification on the converged tree                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-020/021/022/023 (point-in-time-data)    | `tests/{acceptance,negative}/AC-02*.spec.ts` green via package filters + full suite; tooling-globs suite additionally proves glob-driven tooling. |
| AC-240…249 (temporal-evaluation substrate) | Corresponding acceptance+negative pairs green; frozen-count and placebo controls re-proven on the restored config.                                |
| AC-060/061/062 (operations-recovery)       | Benchmark fixtures and drill harness suites green under `pnpm --filter @foresift/persistence test`.                                               |
| AC-260…264 (recovery-traceability)         | Destructive-drill, clean-environment verifier, degraded-state, checkpoint/gap, and backup-policy suites green.                                    |
| Cross-cutting                              | `pnpm verify` (all five stages) + the four package verification commands from current-milestone.json, all green at HEAD.                          |

Regression guards specific to this generation: `pnpm typecheck` stays at zero
errors (it already is at the re-baselined HEAD; the remaining config edits must
not regress it); the full suite stays green (444 tests) and the three automation
e2e specs stay green. If any check turns red after the remaining edits, classify
per Constitution governance and record in the run's out-of-scope notes —
`tests/automation/**` is outside this package's writeScopes and must not be
edited here.

## Risks

| Risk                                                                                                                                   | Mitigation                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The remaining config edits (`pnpm-workspace.yaml`, `package.json`) regress the currently green typecheck/tests.                        | Both edits are non-semantic (an inert pnpm exclusion entry and dependency-list ordering); typecheck + full suite re-run immediately after them must stay at zero errors / 444 green. |
| Lockfile drift when touching package.json/pnpm-workspace.yaml.                                                                         | Run `pnpm install` after edits so `pnpm-lock.yaml` regenerates mechanically; no hand edits; verify the diff is confined to the known entries.                                        |
| Silent divergence between the adopted seed and the reviewed tip inside package content scopes.                                         | Guarded by construction: the content-scope diff vs `3367821` is empty today; tasks include a final diff re-check before declaring convergence.                                       |
| Main absorbs further tooling changes mid-generation, shifting the baseline again.                                                      | Re-run the four baseline checks before editing; treat any new delta as main's shared tooling unless it falls inside this package's write scopes.                                     |
| Divergence between the mirrored scoped-artifact directories (`specs/g0-contracts-data-truth/` vs `specs/g0-contracts-data-truth@g1/`). | Material decision 4 keeps the two trios byte-identical (self-referential paths adapted); final consistency sweep verifies both.                                                      |

## Material decisions

1. **Companion flag over import rewrite**: enable `allowImportingTsExtensions`
   rather than rewriting ~105 import statements. The `.ts`-suffix style is the
   repository convention (NodeNext ESM, vitest-executed), was green at the
   reviewed generation-0 tip, and requires `noEmit` — true for every tsconfig in
   the repo. Recorded here; no new ADR needed (mechanical restoration of
   reviewed state).
2. **Keep main-postdating scripts in package.json**: `autopilot:restart-package`,
   `test:unit`, `test:integration` arrived on main after generation 0 landed and
   belong to shared automation, not to this package's delta. Only devDependency
   ordering is aligned; deleting newer main tooling would be an unjustified
   out-of-scope regression.
3. **pglite release-age exclusion restored**: `minimumReleaseAgeExclude:
['@electric-sql/pglite@0.5.6']` is the mechanically emitted pnpm entry that
   lets installs resolve while the workspace enforces minimum release age;
   without it fresh CI checkouts can fail dependency installation.
4. **Mirrored scoped-artifact directories**: the deterministic guards receive
   the bare package id (`${ARGUMENTS%%@g*}` in the optimized workflow) and read
   `specs/g0-contracts-data-truth/`, while the Archon AI commands interpolate
   raw `$ARGUMENTS` and read `specs/g0-contracts-data-truth@g1/` (authoritative
   for generation 1). Both surfaces must present ONE coherent plan, so the two
   directories carry byte-identical trios with only self-referential paths
   adapted, and every change to one is mirrored to the other. This is a
   workflow-consistency measure inside the planning surface; it changes no
   requirement semantics and is recorded here rather than as an ADR because it
   binds only this package's planning artifacts.

## Supporting changes outside writeScopes (justified)

1. `pnpm-lock.yaml` — mechanical regeneration via `pnpm install` after the
   scoped `package.json`/`pnpm-workspace.yaml` edits; no hand edits.
2. None otherwise planned. Anything discovered mid-implementation goes to the
   run's `out-of-scope-notes.md` instead of being fixed out of scope.
