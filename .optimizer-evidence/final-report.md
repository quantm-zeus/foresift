# §30 Final report — throughput-optimization task (evidence-based)

All 35 required points, each backed by a named durable artifact. Companion
files: `prA-diagnosis-stranded-running-package.md`, `prB0-diagnosis-silent-noop-resume.md`,
`postrecovery-proof.md`, `prerecovery-snapshot.txt`, `baseline-product-run-health.md`,
`prB1-control-plane.md`, `prB2-workflow-integration.md`, `benchmarks-before-after.md`.

## Recovery

1. **Original failed G0 run** — Archon run `b0a82481a8c9da9bf3bb372372f26c1d`
   (branch `foresift/g0-contracts-data-truth`, log spans 2026-08-23T03:43–07:10Z,
   846 events; final status failed → later retired to `cancelled` via supported
   `workflow abandon` during recovery).
2. **Exact failure classification** — HTTP 429 `"Rate limit exceeded:
free-models-per-day-stealth"` — a provider DAILY-quota exhaustion. The
   pre-fix classifier matched `'429'` → TRANSIENT; no daily-quota class existed.
3. **Stranded-state root cause** — after the fatal escalation the supervisor's
   pausedFatal bookkeeping lost the tracked-run identity while the package row
   stayed status=RUNNING with activeRuns=[] — an unreachable-by-design state
   (`RUNNING ∧ activeRuns=[] ∧ pausedFatal=null`) that no automatic path could
   exit. Full proof: `prA-diagnosis…md`.
4. **Recovery PRs** — #13 (classification + durable quota pause + tracked
   recovery identity) and #16 (effect-verified resumes; recover tracked quota
   pauses; retire dead runs via supported abandon).
5. **Recovery merge SHAs** — #13 → `491cbd8`, #16 → `a385812`
   (both squash-merged after exact-head CI).
6. **New quota/backoff semantics** — QUOTA_DAILY classified before transient;
   never touches the 3-attempt transient budget; durable per-run quota pause;
   spaced probes 6 h base ×2 per failure capped 24 h, ≤3 automatic probes,
   provider reset times honored clamped [30 min, 48 h]; probe exhaustion
   escalates to operator-gated PAUSED_FATAL; every resume effect-verified
   against the run row (ack-ok-but-noop ⇒ recorded and escalated).
7. **Supported recovery mechanism** — stop unit →
   `node scripts/automation/foresift-autopilot.mjs --recover-fatal` → start
   unit (`pnpm autopilot:recover`). Verifies lifecycle/package identity/
   duplicates BEFORE any mutation; resumes the SAME Archon run; only if Archon
   refuses launches exactly ONE fresh continuation on the SAME branch/worktree.
8. **Pre-recovery product worktree evidence** — `prerecovery-snapshot.txt` +
   `postrecovery-proof.md`: product worktree
   `~/.archon/workspaces/quantm-zeus/foresift/worktrees/archon/task-foresift-g0-contracts-data-truth`
   HEAD `a2016da`, tasks.md 48/65 checked, only checkbox edits uncommitted.
   The worktree was never reset/cleaned/checked-out (READ-ONLY except the
   sanctioned in-place resume).
9. **Post-recovery product worktree evidence** — same worktree adopted by run
   `02b75461…`; by 11:09Z HEAD `a3b90f8` (T057 acceptance suites), tasks.md
   57/65 checked — work continued IN PLACE on the same branch.
10. **Prior implementation preserved** — commit chain intact from `a2016da`
    through T057 (`git log` continuous, no resets); tasks.md checkboxes only
    ever advanced; PRD-mandated artifacts (specs/, implementation) untouched
    by any optimizer operation.
11. **Supervisor tracking restored** — `operator_recovery_complete` event,
    mode=single-fresh-continuation, exit 0; `activeRuns=[02b75461…]`,
    pausedFatal=null; invariant guard (no RUNNING-without-live-run) holds.
12. **Recovered run ID/state** — `02b7546150d4ae0de3405d431b53f911`,
    Archon status=running, supervisor node observability live
    (plan loop iter 1 at 09:53Z → implement-iterate iteration 2 by 11:05Z).
13. **No duplicate product run** — runs table for the package: exactly one
    running row (`02b75461…`); predecessor `b0a82481…`=cancelled (cannot wake);
    no other launch of this package exists.
14. **Provider availability** — available at recovery time (09:50Z); the
    earlier daily quota had renewed. No retries were burned while unavailable
    (durable pause honored until the operator-initiated supported recovery).
15. **G0 progressed after recovery** — measured: 48→57 checked tasks
    (+9), HEAD a2016da→a3b90f8 (T057), run log events 345→388 with continuous
    tool activity through 11:09:54Z.

## Throughput

16. **Optimization PRs** — #17 (control plane: profiles, checkpoints, FAST/
    FULL tiers, attestation, proven-only dedupe, deterministic lander),
    #18 (workflow variant integration + invocation repair + runtime smoke),
    #19 (checkpoint absent-at-build fix found by §28 activation).
17. **Merge SHAs** — #17 → `40a1776`, #18 → `002687b`, #19 → `bcb2e23`.
18. **LEGACY/OPTIMIZED mechanism** — deterministic pure function
    `throughputProfile(id)` (LEGACY iff `g0-contracts-data-truth`); supervisor
    `workPackageWorkflow()` maps profile→workflow variant for launches AND
    stranded-run adoption; one orchestrator, no second control plane.
19. **G0 remains LEGACY** — live `pnpm autopilot:status` line:
    `g0-contracts-data-truth RUNNING risk=CRITICAL profile=LEGACY`; its run
    still executes the original shared workflow.
20. **Next package is OPTIMIZED** — same status output:
    `g0-security-perimeter PENDING risk=CRITICAL profile=OPTIMIZED` (and all
    seven remaining packages OPTIMIZED); selftest S17 proves the variant is
    what would launch.
21. **Slicing/checkpoint design** — coherent bounded slices (~8–12 tasks,
    20–45 min) in `foresift-wp-implement-optimized`;
    `implementation-checkpoint.json` schema `foresift/implementation-checkpoint@1`
    (CACHE/INDEX only) binds packageId+HEAD+sha256 source hashes; any mismatch
    ⇒ treated as absent; absent-at-build optional sources stable-while-absent,
    invalidate on appearance (PR #19). Checkpoint-first iteration starts:
    validate before reading anything else.
22. **Progress observability** — `autopilot:status` prints per-package
    profile and, for OPTIMIZED runs, slice id + completed/total/remaining task
    counters labeled INVALID with reasons when stale.
23. **Verification tier design** — FAST = spec:verify + eslint/vitest-related
    on touched files, hard-coded `mergeAuthorized:false`, escalates to full
    suite when no files selected; FULL = the deterministic gate, mandatory
    pre-PR AND post-convergence; FAST never gates a merge (tested both ways).
24. **Redundant gate executions removed** — exact-head attestation
    (`foresift/full-gate-attestation@1`) keyed on headSha/package/risk/profile/
    pnpm-lock/authority/gate-implementation/toolchain hashes; `--check` reuses
    only on zero drift; six single-field mutation tests prove any change
    invalidates; smoke proves fail-closed with none.
25. **Test-dedupe evidence** — classifier requires byte-exact command shape +
    `vitest run` script + NO local vitest config + enumerated default-include
    coverage; prohibited-capabilities scan hard-coded UNIQUE_MANDATORY;
    absence of proof = unique. Live milestone today: 23/23 verdicts
    UNIQUE_MANDATORY (nothing yet meets the proof chain — correct).
26. **CI duplication removed** — aggregate duplicate verify step deleted;
    concurrency group cancels superseded heads (#18). Measured Verify
    wall-clocks: #13 33 s, #16 32 s, #17 21 s, #18 25 s, #19 25 s.
27. **Deterministic PR/CI/merge design** — `wp:land`: clean-tree refusal →
    idempotent push → PR discover-or-create → pin HEAD → poll check-runs AT
    that SHA → red CI exits nonzero → no-check-runs diagnosis → drift guard →
    squash merge. Dogfooded three times (#17/#18/#19), zero AI turns waiting.
28. **Effort-routing changes** — HIGH-risk effort kept unchanged (spec: keep);
    mechanical operations routed away from AI via the lander and bash-only
    smoke; no risk-tier downgrades anywhere.
29. **Regression results** — §25 items 11–23 covered by 21 vitest cases in
    `tests/automation/throughput.spec.ts` (positive+negative pairs);
    selftest S17 covers 24–27 (serial G0 concurrency, optimized clean-turn
    continuation pre-existing smokes, LEGACY compatibility); full suites below.
30. **pnpm verify** — green at every merged head; latest: 60/60 vitest across
    4 files + spec:verify 13 checks (run at bcb2e23 build-up).
31. **Autopilot selftest** — PASS=106 FAIL=0 (main checkout, post-#18/#19).
32. **Archon validation** — workflows 27 valid / 0 errors; commands 52 valid /
    0 errors.
33. **Exact-head CI** — all five merges (#13/#16/#17/#18/#19) landed on CI
    green AT the pinned squash-head SHA; no stale-head authorization anywhere.
34. **Before/after measured evidence** — `benchmarks-before-after.md`
    (incident retry-burn timeline vs spaced verified probes; node durations;
    tool histograms; CI wall-clocks; dogfood merges; smoke proofs; explicit
    not-measurable markers where instrumentation didn't exist).
35. **Remaining limitations/risks** — (a) no OPTIMIZED package has run in vivo
    yet, so end-to-end gains await the first one; (b) dedupe savings start
    only once real commands match the proof chain (today 23/23 unique);
    (c) checkpoint granularity tracks slice discipline; (d) Archon task
    worktrees pin creation-time main — mid-flight control-plane fixes need a
    worktree refresh (documented activation rule); (e) G0 remains LEGACY by
    design, so it benefits only from the incidental gate-invocation repair.

## Success criteria cross-check (§29)

Recovery criteria: all seven met (points 1–15). Throughput criteria: profiles
live and proven (18–20), slices/checkpoints/progress/tiers/dedupe/CI-dedupe/
deterministic landing shipped with tests (21–29), FULL gate and exact-head CI
mandatory and enforced (23–24, 33), review quality and serial G0 untouched
(§25 S17, selftest), all verification green (30–32).
