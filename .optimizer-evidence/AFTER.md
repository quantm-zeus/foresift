# C2.5 AFTER — measured on merged C2.5+C3 HEAD (post #24 squash, `17265fd`)

All numbers measured locally on this branch's HEAD with `export PATH=$HOME/.local/bin:$PATH`,
same box as `.optimizer-evidence/BASELINE.md`. Nothing is extrapolated.

## Headline comparison

| Metric (FULL authority) | Baseline @aecf711 | After (C2.5) | Δ |
| --- | --- | --- | --- |
| `pnpm test` wall (median of ≥3) | 37.5 s (37.9/37.5/37.3) | **29 s** (30/29/29/30/28) | −22% |
| `pnpm verify` wall | 47.6 s | **39 s** (38, 39) | −18% |
| git process spawns per FULL run (PATH shim count) | 543 | **375** | −31% |
| test files collected | 10 (incl. 4 stale worktree files) | 11 (zero stale) | pollution removed |
| tests executed per FULL run | 180 reported (≈60 were stale-worktree duplicates ⇒ ≈120 real) | **150** (all real) | +25% real evidence |

The baseline "180 tests" included 60 duplicate stale copies from
`.claude/worktrees/foresift-throughput/**` running OLD specs against CURRENT scripts —
the source of the baseline's intermittent false reds. Excluding them (`**/.claude/**`)
is a correctness fix, not a coverage reduction.

## Tier walls (measured individually)

| Tier | Command | Wall | Contents |
| --- | --- | --- | --- |
| unit | `pnpm test:unit` | 5 s | 8 files, 146 tests, threads + isolate:false |
| integration | `pnpm test:integration` | ~25–27 s | 3 files, 4 real executions run CONCURRENTLY |
| authoring loop (one affected file) | `vitest run tests/automation/v2-throughput.spec.ts` | 2 s | 33 tests |
| authoring loop (whole unit tier) | `pnpm test:unit` | 5 s | replaces the old 37.5 s inner loop |

Integration tier pays exactly one nested FULL suite per gate E2E (green milestone gate,
red package gate); the two gate files overlap each other and the targeted-router file,
so serial-36 s became ~25 s concurrent WITHOUT removing any real execution.

## Git spawn accounting (shim recount, one FULL run)

- Baseline: 543 total — 373 inside real gates (irreducible: gates genuinely exercise
  git), 100 in v2-throughput fixtures (~12 fixtures × ~8 spawns), 62 control-plane, 8 throughput.
- After: **375 total.** Fixture cost collapsed to ~6 spawns PER WORKER (seeded template +
  bare origin built once) instead of ~8 per fixture; every fixture materialization is a
  filesystem copy (0 spawns). The remaining spawns are dominated by the irreducible
  in-gate work plus genuinely-git behaviors that still use real git by design.
- Recount method identical to baseline: `/tmp/foresift-gitshim/git` wraps `/usr/bin/git`
  and appends one line per invocation to `.optimizer-evidence/git-spawn-count`.

## Discovery delta vs baseline (`vitest list --filesOnly --run`)

Baseline snapshot: `.optimizer-evidence/baseline-discovery.txt`.
After snapshot: this run collected 11 files:

```
[unit]        spec-verify, control-plane, test-tiers*, throughput, until-bash-guards,
              v2-gate-convergence, v2-throughput, v3-mechanical-landing (from C3)
[integration] gate-e2e-green*, gate-e2e-red*, targeted-router-e2e*
```

Intentional deltas only:
1. REMOVED: 4× `.claude/worktrees/foresift-throughput/tests/*` (stale duplicates — hygiene fix).
2. ADDED: `test-tiers.spec.ts` (meta-guards for tier config + discovery hygiene),
   3 integration files (the split real-execution specs, same behaviors as before),
   `v3-mechanical-landing.spec.ts` (arrives from merged C3, not a C2.5 change).

No previously-collected real spec was dropped or renamed away.

## Stability (repeat-run requirement)

After fixing three measured failures discovered during bring-up (see below),
consecutive green FULL runs: runs 7,8,9,10 (27/28/28/37 s) then post-C3-merge runs
1–5 (30/29/29/30/28 s) = **9 consecutive green FULL runs**, plus 2 green `pnpm verify`.

## Measured failures found & fixed during C2.5 (each is itself regression-guarded)

1. **Fork-bomb via unguarded red-gate spec**: the red package gate runs its TESTS
   category (full `pnpm test`) BEFORE failing at PACKAGE, so an unguarded copy inside a
   nested suite re-spawned gates without bound (observed: unbounded process tree, killed).
   Fix: `itE2e` sentinel guard restored on the split file; nested suites register skips.
2. **Empty-suite failure**: Vitest 4 fails a suite with zero registered tests, so
   sentinel-skipped dedicated files turned the nested TESTS category red ("No test found
   in suite"). Fix: `itE2e` registers `it.skip` instead of nothing.
3. **Load-dependent 5 s timeout false red**: pre-existing `spec-verify.spec.ts` mutation
   case timed out while a nested gate suite ran concurrently. Fix: explicit per-project
   `testTimeout: 30_000` (root-level `testTimeout` does NOT inherit into Vitest 4 project
   configs — verified empirically). A hang still fails; only scheduling noise is removed.

## Bonus fail-closed fix found by C2.5 measurement (in scope: §12 FAST composition)

`vitest related <repo-relative-path>` matches NOTHING (exit 0, "No test files found") —
and git changesets yield exactly repo-relative paths. The JS/TS FAST step therefore ran
ZERO tests and reported PASS (fail-open). The database step already escalated on
"No test files found"; now every `vitest-related` step does, and changed paths are
absolutized before invocation (`runVitestRelatedStep`, pure-tested positively AND
negatively in `v2-throughput.spec.ts`). End-to-end proof (real CLI):

```
FAST ▸ ./node_modules/.bin/vitest related /home/minhquan_eth/foresift/scripts/automation/fast-impact.mjs --run
escalated: false ; result: PASS (29 related tests matched) ; total 5.5 s
```

## Requirement / acceptance evidence equivalence (§16)

- Every behavior evidenced at baseline remains evidenced: parse/planner/router matrices,
  executor E2Es (green/red/escalate), collector degradation, REAL gate green+red E2Es —
  all retained; the real-gate ones moved to dedicated integration files (same assertions).
- Added evidence not present at baseline: tier-config meta-guards, fixture-factory
  proofs (isolation, identity, zero-spawn determinism), FAST related-step positive +
  negative escalation coverage, live-discovery hygiene assertion.
- No test was deleted without a deterministic replacement covering the same invariant;
  the only removals are stale duplicate copies that never should have been collected.
