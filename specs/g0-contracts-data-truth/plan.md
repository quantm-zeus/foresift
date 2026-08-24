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
review repair. That content is present on this branch as the adopted seed; the
only in-scope divergence from the review-repaired generation-0 tip (`3367821`)
is four intentionally added per-package vitest runner configs plus three kept
newer shared-automation scripts (both documented below). Generation 1 is
therefore a **convergence generation**, not a build-out:

1. **Restore root-configuration parity** versus the reviewed tip. The original
   baseline (at absorbed-main HEAD `5d098b8`) found four differing root-config
   files causing 105 TS5097 errors and five failing tests; main's own tooling
   repair (`ac67972`, absorbed via `5d098b8`/`1cb934f`) restored the
   `tsconfig.json` include/exclude shape, and the convergence slice T101–T104
   landed the remaining edits — the `minimumReleaseAgeExclude` entry in
   `pnpm-workspace.yaml`, devDependency ordering parity in root
   `package.json`, and the `allowImportingTsExtensions` position check in
   `tsconfig.base.json` — plus four package-local vitest runner configs so the
   milestone-declared per-package verification commands collect their suites.
   All of that is committed on this branch as `0ee8f42`.
2. **Re-verify everything deterministically at the current head.** Main moved
   again after that landing (an automation-only absorb at `0adb46b`, touching
   nothing inside this package's write scopes). Re-baselined at HEAD
   `0adb46b`: typecheck GREEN (zero errors), full suite GREEN (64 files / 448 tests). Remaining generation-1 work: re-run the gates at
   whatever HEAD the implementation stage finds, fix any regression strictly
   within writeScopes, and commit coherent units additively — the
   implementation completion gate requires a committed tree and `create-pr`
   refuses a dirty one (absorbed defect #9 fix), so the complete state must
   never sit uncommitted.

No requirement semantics change in this generation. The normative scope in
spec.md §2–§4 is restated for traceability; the engineering work below is the
minimal, evidence-backed path to a fully converged, fully green tree at the
pushed HEAD inside this package's write scopes.

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
`packages/*/test/` (run through the per-package vitest runner configs);
acceptance specs `tests/acceptance/AC-*.spec.ts`; negative specs
`tests/negative/AC-*.negative.spec.ts` — all 44 manifest-declared files
present and passing on the converged tree. Golden fixtures under
`tests/fixtures/data/` and `tests/fixtures/dr/`.

**Target Platform**: Linux CI + local dev; single deployable modular monolith
(Constitution III).

**Performance Goals**: unchanged from generation 0 — persistence hot-path
benchmark fixtures assert §33-class internal overhead budgets with headroom
(AC-060 substrate).

**Constraints**: read-only product boundary (INV-001 / Constitution IV);
deterministic verification (XI); positive AND failure-path testing (XII);
every task traces to an assigned requirement or its acceptance criteria (X).

**Scale/Scope of remaining work**: the Phase-A config restorations are landed
and committed (`0ee8f42`); what remains is deterministic re-verification at the
current HEAD plus any in-scope regression fix it surfaces. Zero further changes
to packages/, migrations/, tests/fixtures, tests/acceptance, tests/negative,
or telemetry are expected; if verification surfaces one, it is fixed within
writeScopes and recorded in tasks.md.

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
| XVII Additive Git History             | PASS    | Coherent units are committed additively on the package branch (no amend/rebase/force); product source reaches main only through PRs gated by CI.            |
| XVIII No AI Claim Is Completion       | PASS    | Completion decided by `package-plan-complete.mjs` now and by `pnpm verify`/CI later.                                                                        |

## Current-State Baseline (re-verified 2026-08-24 at HEAD `0adb46b`, after a second automation-only absorb of main)

| Check                | Status    | Detail                                                                                                                                                                                        |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm spec:verify`   | GREEN     | 13 checks passed.                                                                                                                                                                             |
| `pnpm typecheck`     | GREEN     | Zero errors.                                                                                                                                                                                  |
| `pnpm test`          | GREEN     | 64 files / 448 tests passed, including `tests/acceptance/tooling-globs.spec.ts` and the three automation e2e specs.                                                                           |
| Content-scope parity | DELTA (+) | Versus the reviewed tip, exactly four files ADDED inside content scopes — the per-package vitest runner configs (detailed below).                                                             |
| Root-config parity   | CONVERGED | `tsconfig.json`, `tsconfig.base.json`, `pnpm-workspace.yaml` byte-identical to the reviewed tip; `package.json` differs only by the three intentionally kept newer shared-automation scripts. |

**Delta versus the review-repaired generation-0 tip** (`git diff HEAD 3367821 …`):

- `packages/{shared-schemas,persistence,evidence,object-store}/vitest.config.ts`
  — four files ADDED by this branch's convergence commit `0ee8f42`
  (test-infra parity). The repository-root vitest config's projects include
  only the root-level `tests/**` tree, so a package-cwd `vitest run` would
  collect nothing; these runner configs keep the milestone-declared per-package
  filter commands self-contained over each package's colocated `test/` suites,
  mirroring the root timeout budgets. Inside `packages/**` writeScopes;
  intentional and KEPT.
- `package.json` — differs from the tip only by three newer shared-automation
  scripts (`autopilot:restart-package`, `test:unit`, `test:integration`)
  postdating generation 0 — KEPT per material decision 2. devDependency
  ordering now matches the reviewed tip.
- `tsconfig.json`, `tsconfig.base.json`, `pnpm-workspace.yaml` — byte-identical
  to the reviewed tip; Phase-A restoration is complete.

All other differences between this branch and `3367821` are main's own shared
tooling, automation, and documentation evolution absorbed onto this branch —
outside this package's write scopes and not its delta.

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
tsconfig.json        # CONVERGED (byte-identical to reviewed tip; glob-driven include
                     #   shape verified) — re-check only if drifted, never redesign
tsconfig.base.json   # CONVERGED ("allowImportingTsExtensions": true present) — re-check only
pnpm-workspace.yaml  # CONVERGED (minimumReleaseAgeExclude entry present) — re-check only
package.json         # CONVERGED devDependency ordering; KEEP the three newer shared-
                     #   automation scripts (autopilot:restart-package, test:unit,
                     #   test:integration) that postdate generation 0
packages/{shared-schemas,persistence,evidence,object-store}/vitest.config.ts
                     # LANDED at 0ee8f42 — per-package vitest runner configs enabling the
                     #   milestone verification commands; keep, never weaken
```

Everything else inside content scopes is byte-identical to the review-repaired
tip: `packages/{domain,shared-schemas,persistence,evidence,object-store}/`,
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
errors (it is at the re-baselined HEAD `0adb46b`); the full suite stays green
(448 tests) and the three automation e2e specs stay green. If any check
turns red during final re-verification, classify per Constitution governance,
fix only what falls inside writeScopes, and record anything else in the run's
out-of-scope notes — `tests/automation/**` is outside this package's
writeScopes and must not be edited here.

## Risks

| Risk                                                                                                                                                                            | Mitigation                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Main absorbs further tooling changes mid-stage, shifting the baseline again.                                                                                                    | Re-run the four baseline checks before any edit; treat any new delta as main's shared tooling unless it falls inside this package's write scopes.                                                |
| Final re-verification surfaces a regression (type error, red test, drift).                                                                                                      | Fix strictly within writeScopes; classify per Constitution governance; anything outside writeScopes goes to the run's out-of-scope notes, never an out-of-scope edit.                            |
| A complete state left uncommitted blocks landing (absorbed defect #9: `create-pr` refuses a dirty tracked tree and the implementation completion gate demands a committed one). | Commit coherent units additively on the package branch as they converge; never end the stage with a dirty tree.                                                                                  |
| Silent divergence between the adopted seed and the reviewed tip inside package content scopes.                                                                                  | Guarded by construction: the content-scope diff vs `3367821` is confined to the four documented runner-config additions; tasks include a final divergence re-check before declaring convergence. |
| Divergence between the mirrored scoped-artifact directories (`specs/g0-contracts-data-truth/` vs `specs/g0-contracts-data-truth@g1/`).                                          | Material decision 4 keeps the two trios byte-identical (self-referential paths adapted); final consistency sweep verifies both.                                                                  |

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
5. **Package-local vitest runner configs**: convergence commit `0ee8f42` added
   a `vitest.config.ts` to each of the four packages that carry milestone
   verification commands (`shared-schemas`, `persistence`, `evidence`,
   `object-store`) because the repository-root vitest config's projects include
   only the root-level `tests/**` tree — without a local config,
   `pnpm --filter <pkg> test` resolves the root config upward and collects
   nothing. The runners mirror root timeout budgets, stay inside
   `packages/**` writeScopes, and change no requirement semantics; they are
   part of this package's delivered state and must not be weakened.
6. **Committed-tree completion** (absorbed main defect #9 fix): coherent units
   of this package's work are committed additively on the package branch as
   they converge; the stage never ends with a dirty tracked tree because
   `create-pr` refuses one and the implementation completion gate enforces a
   committed tree. Corrections remain additive commits; product source reaches
   `main` only through PRs gated by CI.

## Supporting changes outside writeScopes (justified)

1. `pnpm-lock.yaml` — mechanical regeneration via `pnpm install` after the
   scoped `package.json`/`pnpm-workspace.yaml` edits; no hand edits.
2. None otherwise planned. Anything discovered mid-implementation goes to the
   run's `out-of-scope-notes.md` instead of being fixed out of scope.
