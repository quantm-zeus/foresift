# C4 — bounded CI parallelism: benchmark and decision

Tasking constraint: split the Verify check into bounded-parallel stages/jobs
**only if benchmark-positive**; otherwise keep sequential and document why.
Required contract if split: preserve the required check
`Verify (spec, format, lint, types, tests)` via a deterministic aggregate
required job; cancelled/skipped must never produce green.

## Measured evidence (2026-08-23, branch optimizer/v2-c4-review-ci-scheduler)

### 1. Constrained-core stage benchmark (local, `taskset -c 0,1`, green tree)

Both arms execute every stage to completion (failures recorded, never
short-circuiting the arm), so the comparison is apples-to-apples:

| arm                                                 | spec   | format+lint+types            | tests     | total         |
| --------------------------------------------------- | ------ | ---------------------------- | --------- | ------------- |
| sequential (current)                                | 801 ms | 3909 + 3133 + 2610 = 9652 ms | 62 521 ms | **72 988 ms** |
| bounded parallel (`{format‖lint‖types}` after spec) | 805 ms | 7866 ms (concurrent)         | 63 770 ms | **72 453 ms** |

Saving from parallelizing the three cheap checks: **~535 ms of 73 s (~0.7%)**
— within run-to-run noise. The pipeline is dominated by `tests` (62.5 s under
2 cores), which vitest already parallelizes internally across workers; three
sub-4 s checks offer almost nothing to overlap.

(An earlier unconstrained probe showed the same shape: checks sum ≈ 10 s vs
tests ≥ 12 s even before the C2.5 runtime wins landed.)

### 2. Real CI cost structure (run 32648286158 on `main`)

The entire required check is ONE job:

```
Verify (spec, format, lint, types, tests)   started 15:21:20Z → completed 15:22:03Z
```

Wall time ≈ **43 s including checkout, pnpm setup, install, and all five
stages.** Any job split multiplies that fixed per-job overhead (checkout +
setup + restore + install ≈ 25–35 s) once per extra job, while the measurable
stage-overlap win is ≤ ~2 s. Splitting N ways is strictly slower end-to-end at
this pipeline scale, independent of runner core count.

### 3. Contract risk without a corresponding benefit

Splitting would additionally require a deterministic aggregate required job so
the branch-protection contract stays exactly `Verify (…)`, plus explicit
fail-closed handling so a cancelled or skipped shard can never surface green.
That machinery would be permanent attack/race surface protecting a change
measured at noise level.

## Decision: DO NOT IMPLEMENT

Keep the single sequential Verify job unchanged:

- Benchmark-negative: ≤ 0.7% local saving under constrained cores; negative
  end-to-end on real CI once per-job overhead is counted.
- The required-check contract stays byte-identical — no aggregate-job shim, no
  cancelled/skipped-green hazard.
- Revisit trigger (recorded for the future): only if total Verify wall time on
  CI grows past several minutes (e.g. test suite > 5 min), where per-job
  overhead becomes negligible relative to stage walls. Re-benchmark then with
  the same two-arm protocol above.

## Scheduler note (same tasking section)

The critical-path priority scheduler WAS implemented
(`scripts/automation/milestone-scheduler.mjs`) because it is pure, small, and
covered by regression tests 42–46; it adds deterministic ORDER among eligible
candidates only — every eligibility constraint remains owned by
`schema.mjs canStartPackage`. G0 foundation concurrency is untouched
(maxParallelCodingPackagesFoundation = 1).
