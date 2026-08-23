# §24 Before/after benchmark evidence

Every number below is measured from a named durable artifact (run logs, check
runs, git history). Nothing is projected or invented. Where no factual
evidence exists for a metric, that is stated and the metric is marked
**not yet measurable** rather than estimated.

## Measured sources

| Artifact                                                               | What it covers                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Archon run log `b0a82481a8c9da9bf3bb372372f26c1d`                      | original G0 run (846 events, 03:43–07:10Z), the 429 incident                       |
| Supervisor state + `prA-diagnosis-stranded-running-package.md`         | retry-burn timeline of the incident                                                |
| Archon run log `02b7546150d4ae0de3405d431b53f911`                      | recovered G0 run (345 events at analysis time), per-node durations, tool histogram |
| GitHub check-runs on merged heads of PRs #13/#16/#17/#18/#19           | CI wall-clock per PR                                                               |
| Smoke runs `1aceff13`(failed)→`e4e26088`(failed)→`d02dbcb8`(completed) | §28 activation, control-plane tools in the real runtime                            |

## BEFORE (measured)

**Rate-limit retry behavior (the incident).** `classifyFailure` matched
`'429'` → TRANSIENT with no daily-quota distinction. All 3 automatic resume
attempts were burned against the daily-quota 429 within ~58 minutes
(06:31→07:29 window, backoff 120 s base); each resumed run re-hit the same
429 within minutes; the run then escalated to PAUSED_FATAL with its package
left stranded as RUNNING-with-no-run. Source:
`prA-diagnosis-stranded-running-package.md` timeline table.

**AI invocations / iteration duration (G0, recovered run).**
`scoped-plan-iterate`: 537 s wall-clock; `implement-iterate` first loop
iteration: 1030 s; deterministic bash nodes (`preflight`, `plan-status`,
`plan-recheck`, `impl-status`): ≤3 s each. Tool calls inside AI iterations:
252 total — Bash 149, Read 29, Write 41, Edit 40 (i.e. 110 file-tool
operations). Assistant messages: 83 across the analyzed window. Source: run
log `02b75461…` node_start/node_complete pairs and tool events.

**FULL-gate executions so far: 0.** No G0 run has reached a gate node yet —
which is exactly why the `pnpm foresift:gate -- --package` invocation defect
(exits 2: pnpm forwards the bare `--` to the script) was latent rather than
historical. There is therefore **no measured "before" gate-repair burn**;
the claim is limited to: the defect provably existed (exit-2 repro) and every
future gate phase would have hit it once per gate node.

**Duplicate CI work (before PR #17/#18).** The CI workflow ended with an
"Aggregate verification" step re-running `pnpm verify` after identical steps
had already run in the same job — one redundant full verification per PR,
plus non-cancellation of superseded heads (no concurrency group). Historical
per-PR Verify wall-clock (single combined job, exact-head): #13 33 s,
#16 32 s, #17 21 s, #18 25 s (check-run started_at→completed_at).

**Repeated context loading.** Before checkpoints there was no durable
between-iteration index: each fresh loop iteration re-derived context from
disk/git without a validated cache to consult. Not separately measurable in
retrospect (no instrumentation existed); the mechanism count is structural:
0 durable checkpoints before vs the `implementation-checkpoint.json` schema
after.

## AFTER (measured)

**Rate-limit retry behavior.** QUOTA_DAILY classified before transient;
quota pauses never touch the 3-attempt transient budget; probes are spaced
6 h→12 h→24 h (max 3 automatic) honoring provider reset times; every resume
is effect-verified (silent no-op ⇒ escalation instead of budget burn).
Live proof: the supported recovery executed 09:50–09:55Z
(`postrecovery-proof.md`) restored tracking under run `02b75461…` with zero
JSON edits, and G0 progressed 48→57 checked tasks (HEAD a2016da→a3b90f8,
T057 suites) by 11:09Z.

**CI duplication removed (PRs #17/#18).** Aggregate duplicate step deleted;
`concurrency: cancel-in-progress` added so obsolete PR heads stop running.
Post-change Verify wall-clock: #19 25 s
(11:06:05→11:06:30Z). Exact-head CI retained: lander pins HEAD and polls
check-runs AT that SHA.

**Deterministic landing (dogfood, measured twice).** PR #17: push → PR →
exact-head CI wait ~31 s → drift guard → squash merge, exit 0. PR #18:
same path, CI wait ~25 s, exit 0. PR #19: same, exit 0. Three merges
executed by the tool with zero AI turns spent waiting on CI.

**Checkpoint semantics proven live (§28 smoke `d02dbcb8`).** Build→validate
valid; tampered source invalidated it; hash invalidation drove a second
iteration which rebuilt from authority and passed the same guard —
2 iterations minimum observed, `guard-last.json` valid:true. Full-gate
`--check` failed closed with no attestation; dedupe classifier emitted 23
verdicts over real milestone metadata, all UNIQUE_MANDATORY (correct today:
no package currently meets the strict proof chain).

**Selftest scale.** 106 assertions PASS / 0 FAIL including S17 profile
selection; vitest 60/60 throughput regressions (§25 items 11–23 covered).

## Unchanged quality invariants

- FULL gate mandatory pre-PR and post-convergence; FAST never authorizes
  merge (`mergeAuthorized:false` hard-coded, tested).
- Exact-head CI mandatory; stale-head green never lands (lander polls the
  pinned SHA; red CI exits nonzero).
- Independent review blocks CRITICAL/HIGH findings; G0 coding stays serial
  (CRITICAL non-parallelizable, selftested).
- Prohibited-capabilities scan always executes — never deduplicated
  (classifier hard-codes UNIQUE_MANDATORY, tested).
- LEGACY lane structurally untouched: shared DAG file and command bodies are
  byte-identical for g0-contracts-data-truth.

## Expected throughput impact (qualitative, bounded by evidence above)

Where the OPTIMIZED lane applies (every package after g0-contracts-data-truth):
mechanical PR/CI/merge stops consuming AI turns (measured: three dogfood
merges, zero AI wait); per-slice FAST verification replaces whole-suite reruns
inside implementation loops while FULL gates stay at their mandatory
positions; proven-duplicate package tests skip only with the full proof chain;
obsolete CI heads cancel; checkpoints give fresh iterations a validated
resumption index instead of blind rediscovery. For g0-contracts-data-truth
itself the expected impact is zero by design (LEGACY), plus the incidental
gate-invocation correctness fix.

## Remaining risks

1. Throughput gains on real OPTIMIZED packages are not yet measured in vivo —
   none has run yet (G0 must finish first). The first optimized package will
   provide the first end-to-end numbers.
2. Dedupe currently reports everything UNIQUE (23/23) because the proof chain
   demands byte-exact shapes; savings begin only when packages actually match
   the chain.
3. Checkpoint value depends on slice discipline (~8–12 tasks); oversized
   slices would weaken invalidation granularity.
4. Archon task worktrees pin creation-time main (observed in activation);
   long-running packages won't see control-plane fixes merged mid-flight —
   recovery identity and additive fixes remain the answer.
