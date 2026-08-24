# Implementation Plan: g0-contracts-data-truth@g1

**Branch**: `foresift/g0-contracts-data-truth-g1` | **Date**: 2026-08-24
**Spec**: `specs/g0-contracts-data-truth@g1/spec.md` (scoped derivative; PRD-subordinate)
**Input**: Assigned requirements FR-DATA-001, FR-DATA-002, FR-DATA-003, FR-DATA-004,
FR-DATA-005, FR-DATA-006, FR-DR-001, FR-DR-002 from
`specs/implementation/current-milestone.json` (milestone G0, risk CRITICAL,
generation 1).

## Summary

Generation 0 of this package implemented all eight assigned requirements across
five workspace packages, eleven migrations, the full manifest-declared
acceptance/negative suites, and telemetry catalogs, then passed independent
review repair. That content is present on this branch as the adopted seed.
Generation 1 is therefore a **convergence generation**, not a build-out:

1. **Restore the four root-configuration deltas** the seed adoption lost
   relative to the review-repaired generation-0 tip (`3367821` on
   `foresift/g0-contracts-data-truth`). Every source, migration, test, fixture,
   and telemetry file is already byte-identical to that tip; only
   `tsconfig.json`, `tsconfig.base.json`, `pnpm-workspace.yaml`, and
   `package.json` differ. The lost deltas are the root cause of every current
   failure: 105 TypeScript TS5097 errors (`.ts`-extension imports without
   `allowImportingTsExtensions`), two failing config-shape acceptance tests
   (`tests/acceptance/tooling-globs.spec.ts`: tsconfig include globs + exclude),
   and three failing automation end-to-end tests whose child processes run
   `pnpm typecheck`.
2. **Re-verify everything deterministically**: full `pnpm verify`
   (spec:verify, format:check, lint, typecheck, tests) plus the package
   verification commands, at HEAD, leaving work uncommitted for review.

No requirement semantics change in this generation. The normative scope in
spec.md §2–§4 is restated for traceability; the engineering work below is the
minimal, evidence-backed path to a green converged tree.

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

**Scale/Scope of remaining work**: four root-config files, then verification.
Zero changes to packages/, migrations/, tests/fixtures, tests/acceptance,
tests/negative, or telemetry are expected; if verification surfaces one, it is
fixed within writeScopes and recorded in tasks.md.

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

## Current-State Baseline (verified 2026-08-24 at HEAD `5d098b8`)

| Check                      | Status | Detail                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm spec:verify`         | GREEN  | 13 checks passed.                                                                                                                                                                                                                                                                                                                              |
| `pnpm format:check`        | GREEN  | All matched files formatted.                                                                                                                                                                                                                                                                                                                   |
| `pnpm lint`                | GREEN  | No findings.                                                                                                                                                                                                                                                                                                                                   |
| `pnpm typecheck`           | RED    | 105 × TS5097 ("import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled") across domain/evidence/object-store/persistence/shared-schemas sources reached from tests, and across tests/acceptance + tests/negative specs themselves.                                                                        |
| `pnpm test`                | RED    | 5 failed / 437 passed: `tests/acceptance/tooling-globs.spec.ts` ×2 (include globs miss synthetic future-package paths; no `exclude` array), `tests/automation/targeted-router-e2e.spec.ts`, `tests/automation/gate-e2e-green.spec.ts`, `tests/automation/gate-e2e-red.spec.ts` (each spawns a gate/executor child that runs `pnpm typecheck`). |
| Manifest testRefs coverage | GREEN  | All 44 unique manifest-declared test files exist.                                                                                                                                                                                                                                                                                              |

**Root cause (evidence)**: `git diff HEAD 3367821 -- tsconfig.json tsconfig.base.json pnpm-workspace.yaml package.json`
is the entire tree delta versus the review-repaired generation-0 tip. The g1
seed absorbed the package sources but retained bootstrap-era root configs
(`include: ["tests/**/*.ts"]`, no `allowImportingTsExtensions`, no pglite
release-age exclusion, older dependency ordering). The codebase consistently
uses `.ts`-extension imports (correct NodeNext ESM style, executed by vitest);
the compiler flag — valid because every tsconfig sets `noEmit: true` — is the
intended companion, as proven by generation 0's green gates at `3367821`.

## Project Structure

### Documentation (this feature)

```text
specs/g0-contracts-data-truth@g1/
  spec.md      # scoped derivative (PRD-subordinate)
  plan.md      # this file
  tasks.md     # ordered traceable breakdown
```

The generation-0 scoped trio remains at `specs/g0-contracts-data-truth/` as
historical planning record; this directory is authoritative for generation 1.

### Source deltas (all inside binding writeScopes)

```text
tsconfig.json        # include packages/*/src/**/*.ts, packages/*/test/**/*.ts,
                     #   tests/**/*.ts; exclude node_modules, dist
tsconfig.base.json   # add "allowImportingTsExtensions": true (valid under noEmit)
pnpm-workspace.yaml  # add minimumReleaseAgeExclude entry for @electric-sql/pglite@0.5.6
package.json         # devDependency list ordering parity with the converged tip;
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

Regression guards specific to this generation: `pnpm typecheck` must report
zero errors (proves TS5097 resolution); the three automation e2e failures must
return green (their children run `pnpm typecheck`; if any remains red after the
config fix, classify per Constitution governance, record in the run's
out-of-scope notes — `tests/automation/**` is outside this package's
writeScopes and must not be edited here).

## Risks

| Risk                                                                                                        | Mitigation                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restoring `allowImportingTsExtensions` globally could mask genuinely wrong extensionless imports elsewhere. | The flag only permits `.ts` suffixes; lint + verbatimModuleSyntax still enforce explicitness. Typecheck must go to exactly zero errors; any new error class stops the task.     |
| Root include-glob widening could pull generated or vendored files into typecheck.                           | `exclude` lists node_modules/dist; per-package tsconfigs stay intact; the widened include mirrors the exact set that was green at the reviewed tip.                             |
| Automation e2e failures might have a second, unrelated cause.                                               | Fix configs first, re-run; only if still red, classify (transient/fatal/environmental), document in out-of-scope notes, and never edit `tests/automation/**` from this package. |
| Lockfile drift when touching package.json/pnpm-workspace.yaml.                                              | Run `pnpm install` after edits so `pnpm-lock.yaml` regenerates mechanically; no hand edits; verify install is a no-op diff beyond the known entries.                            |
| Silent divergence between the adopted seed and the reviewed tip outside root configs.                       | Guarded by construction: `git diff` shows none today; tasks include a final diff re-check before declaring convergence.                                                         |

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

## Supporting changes outside writeScopes (justified)

1. `pnpm-lock.yaml` — mechanical regeneration via `pnpm install` after the two
   scoped manifest edits above; no hand edits.
2. None otherwise planned. Anything discovered mid-implementation goes to the
   run's `out-of-scope-notes.md` instead of being fixed out of scope.
