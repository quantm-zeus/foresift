# C2.5 baseline measurements (measured, not estimated)

Environment: repo @ origin/main = aecf711, node v22.23.2 (local; supervisor uses 24),
vitest 4.1.11, NO vitest config file before C2.5, 4-core GCP VM.
Date: 2026-08-23. Git-spawn counting via PATH shim wrapping `/usr/bin/git`
(.git-spawn-count increments per exec).

## Suite inventory

| metric      | value                                                   |
| ----------- | ------------------------------------------------------- |
| test files  | 10 (6 at this base incl. only pre-C3 set; listed below) |
| total tests | 180                                                     |
| test LOC    | 2183                                                    |

Files: control-plane(54), throughput(40), until-bash-guards(18),
v2-gate-convergence(33), v2-throughput(29), spec-verify(6).

## Wall-clock (repeated runs)

| measurement   | runs                                  |
| ------------- | ------------------------------------- |
| `pnpm test`   | 37.9s / 37.5s / 37.3s (stable ~37.5s) |
| `pnpm verify` | 47.6s                                 |

## Isolated per-file runtime (single-file `vitest run <file>`)

| file                                                           | wall    | notes                                                                                                              |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| v2-gate-convergence.spec.ts                                    | **36s** | 2 REAL-gate E2E tests, run SERIALLY in one file; each spawns a nested FULL `pnpm test` via the gate (~17-20s each) |
| spec-verify.spec.ts                                            | 5s      | spawns node CLI                                                                                                    |
| control-plane / throughput / until-bash-guards / v2-throughput | 2s each | mostly pure                                                                                                        |

## Process classification

| class               | evidence                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pure-unit           | checkpoint validate/build matrices, capsule, classifier tables, planner/router decision matrices, parser rejection matrices                                                                                                                                                |
| process/integration | 2 real-gate E2E (spawn full gates incl. nested suite), 3 targeted-executor E2E (spawn vitest/tsc), router CLI E2E, collector fixtures (1 temp git repo), slice-changeset real-git fixtures (v2-throughput: ~12 repos × 8 git ops), control-plane lander/preflight fixtures |
| archon smoke        | foresift-smoke-throughput workflow (not part of vitest)                                                                                                                                                                                                                    |
| full gates          | pnpm verify / wp:full-gate                                                                                                                                                                                                                                                 |

## Git spawn count (full `pnpm test`, PATH-shim measured)

| scope                           | spawns                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| whole suite                     | **543**                                                                                                                                               |
| v2-gate-convergence.spec.ts     | 373 (dominated by git invoked INSIDE the spawned real gates: spec:verify/format/lint/typecheck/test chains — irreducible without weakening the gates) |
| v2-throughput.spec.ts           | 100 (≈12 fixture repos × 8 git ops: init, 2×config, bare-origin init, remote add, add, commit, push)                                                  |
| control-plane.spec.ts           | 62                                                                                                                                                    |
| throughput.spec.ts              | 8                                                                                                                                                     |
| until-bash-guards / spec-verify | 0                                                                                                                                                     |

Fixture pattern today (`gitFixture()`): per-test `init -q` + 2×`config` +
`init --bare` origin + `remote add` + `add/commit/push` = 8 spawns per fixture,
repeated for logic that is often provable purely (parsers/classifiers already
have direct table tests; the fixtures back changeset/base-resolution
integration behavior).

## Existing affected-test routing (§12 state)

fast-impact.mjs already maps CODE_JS_TS → eslint(touched) + `vitest related
<touched> --run` + tsc; DATABASE → related(+escalations); ARCHON yaml →
prettier+archon validate; ROOT_OR_UNKNOWN → full-suite escalation.
package-fast-verify.mjs executes that plan with fail-closed defaults. No second
impact engine needed; C2.5 must preserve this composition under any vitest
config change.

## Identified levers (ranked by measured impact)

1. Parallelize the two real-gate E2E tests by splitting the file (36s serial →
   ≈max of the two concurrently) — zero evidence change.
2. Vitest projects (unit/integration) so dev loops target the fast tier while
   `pnpm test` remains FULL authority; per-project pool/isolation tuning.
3. Seeded-template git fixtures (build once per worker, cpSync per test,
   env-based identity, on-demand origin) → −150+ spawns, faster setup.
4. Table-driven consolidation where invariants are literally identical;
   obligation-based authoring policy for future packages.
