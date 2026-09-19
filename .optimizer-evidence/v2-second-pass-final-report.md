# V2 SECOND-PASS OPTIMIZATION — FINAL REPORT

Date: 2026-08-23 · Control-plane HEAD at report time: `1270534` (= origin/main after PR #26)
Method: every MEASURED value cites its artifact; in-vivo product metrics that
cannot exist yet (no OPTIMIZED package has started) are marked
NOT MEASURABLE IN VIVO — never estimated as fact.

## Items 1–45

1. **origin/main SHA before V2 work**: `084d21be94c7b75ebd5002b01b544d446a42876a`
   (PR #20).
2. **Active product package/run before work**: `g0-contracts-data-truth` · run
   `02b7546150d4ae0de3405d431b53f911` · node implement-iterate iter≥2.
3. **Product profile before work**: LEGACY (permanent invariant;
   g0-contracts-data-truth ⇒ LEGACY forever by
   `work-package-throughput-profile.mjs`).
4. **Proof no product run was disturbed**: the same supervisor PID tree kept
   running throughout; autopilot-state.json shows only supervisor-native
   recovery counters (resumeCount 1, restartCount 1 on the successor run
   `6953d02f…`, both mechanisms proven in #13/#16). Every V2 session action
   touched ONLY smoke workflows (`foresift-smoke-*`) and git/CI of control-plane
   PRs; zero stop/resume/launch was issued against any `foresift-work-package*`
   run. The run list at completion shows `6953d02f` still `running`.
5. **First-pass optimized baseline metrics** (measured @ 084d21b,
   `v2-second-pass-baseline.md`): clean-path FULL executions **3×**; clean-path
   non-implementation AI invocations **≥10** (create-pr 1, review ≈7, converge
   1, judge 1, ci-merge 1); convergence always ran (no skip); DAG nodes 11;
   checkpoint self-invalidation defect present; gate failures unstructured.
6. **Checkpoint self-invalidation verdict**: CONFIRMED (code read + regression
   fixture; order FAST→commit→checkpoint-build→tasks.md-edit invalidated every
   productive slice's own checkpoint because tasks.md is a hashed source).
7. **Checkpoint ordering fix** (PR C1): slice finalization now marks tasks.md,
   persists notes, commits ALL coherent changes, captures FINAL HEAD, builds
   the checkpoint against FINAL sources; next clean turn ⇒ VALID (regression
   CASE A/B/C in C1 suite; absent-at-build sources no longer invalidate while
   absent — #19 hardening carried forward).
8. **Context-capsule design** (C1): deterministically derived from authority —
   requirementIds/acceptanceIds resolved through the requirements manifest,
   PRD section/line references, ADR ids, Spec Kit artifacts, first unfinished
   task; no agent-supplied flags needed.
9. **Git-derived changeset design** (C1): touched-file scope from
   merge-base(HEAD, origin/main) diffs (`slice-changeset.mjs`), sorted,
   status-carrying; deletions/renames handled; no manual --file enumeration.
10. **FAST impact-classifier design** (C1 + C2.5): path-based categories
    CODE_JS_TS / DATABASE / AUTHORITATIVE_SPEC / ARCHON_CONTROL_PLANE /
    DOC_ONLY / ROOT_OR_UNKNOWN; unknown/root/lockfile/.github ⇒ escalateFull
    fail-closed; vitest-related step absolutizes paths and escalates on
    no-match (C2.5 closed the fail-open hole where bare repo-relative paths
    matched ZERO tests and passed).
11. **Initial FULL-attestation design** (C2): one exact-head FULL writes
    `full-gate-attestation.json` binding headSha + packageId + risk + profile
    - pnpm-lock hash + authority hashes + gate-code hashes + toolchain;
      `attestationDrift()` recomputes identity and fails closed on ANY change.
12. **FULL gate count before vs after (clean path)**: **3× → 1×**
    (MEASURED structurally; gate-router bare invocation eliminated, convergence
    gate eliminated by deterministic skip, ci-merge reuses attestation — CASE A
    fixture asserts ATTESTATION_REUSE with gateRuns=1).
13. **Structured gate failure manifest** (C2): `foresift/full-gate-result@1`
    with per-check {label, category, command, status} rows + failedCategories.
14. **Repair FULL-gate count before vs after**: full gate per repair edit →
    **targeted verification during repair + exactly ONE final FULL**
    (`planTargetedChecks` TARGETED-vs-ESCALATE_FULL; CASE B fixture).
15. **Deterministic convergence router** (C2): `decideConvergence()` requires
    ALL of APPROVED verdict, zero unresolved threads, HEAD unchanged across
    review window, valid undrifted exact-head attestation, implementation
    completeness; ANY miss ⇒ CONVERGENCE_REQUIRED (fail-closed).
16. **Convergence invocation count before vs after (clean path)**: **always ≥1
    (+judge) → 0** (CASE A fixture asserts DECISION_NOT_REQUIRED).
17. **Deterministic PR creation** (C3): `package-create-pr.mjs` composes
    title/body from checkpoint capsule + gate manifest mechanically; dirty-tree
    refusal guard; dry-run proves zero persistence.
18. **create-PR AI count before vs after**: **1 → 0** on clean path.
19. **Deterministic clean final landing** (C3/C2): `package-final-land.mjs`
    attestation-check → (reuse | at most one fresh FULL) → mechanical lander
    push/CI-wait/squash; bounded AI fallback exists ONLY off-clean-path.
20. **final-landing AI count before vs after (green clean)**: **1 → 0**
    (CASE E fixture: calls = [gateCheck, lander] only).
21. **Review-packet design** (C4): `review-packet.mjs` — byte-deterministic
    accelerator (no timestamp; freshness = reviewedHeadSha+treeHash), content-
    bound diffIdentity, degradation recorded never fabricated, never blocks
    review, validateReviewPacket fails closed on HEAD drift; wired into the
    optimized workflow pre-review-snapshot node; aggregateFindings merges EXACT
    duplicates only (occurrences) and never suppresses disagreement.
22. **Independent reviewer count/quality confirmation**: unchanged — the
    `archon-review-block` (scope/sync/reviewers/synthesize/fixer) is untouched
    by every V2 PR; packet is advisory context only.
23. **CI sequential-vs-parallel benchmark**: two-arm forced-completion
    benchmark under `taskset -c 0,1`: sequential 72 988 ms vs bounded-parallel
    72 453 ms (**~0.7 %, within noise**); real CI Verify job = 43 s end-to-end
    including install (`c4-ci-parallelism-benchmark.md`).
24. **Was CI parallelism retained?** **NO — DO NOT IMPLEMENT**, benchmark-
    negative and overhead-dominated; revisit trigger recorded (Verify > several
    minutes).
25. **Scheduler design / synthetic benchmark** (C4): IMPLEMENTED — pure
    priority ORDER (longestDownstreamPath desc → unlockedDownstreamCount desc
    → riskRank desc → id asc) among candidates already eligible via production
    `canStartPackage` adapter; memoized cycle-guarded DFS; G0 max=1 and
    CRITICAL serialization untouched (tests 42–46). Complex scheduler beyond
    this simple priority was NOT built — no measurable benefit demonstrated
    for milestone sizes that exist (tasking §29 rule).
26. **AI effort-routing changes**: NOT IMPLEMENTED — Archon v0.9.0 offers
    static per-node effort only; risk-conditional MEDIUM is not expressible
    simply and medium is unproven in vivo; all nodes stay `effort: high`
    (`c4-effort-routing-findings.md`).
27. **Provider fallback findings** (§19 P2): NOT SAFELY SUPPORTED today — no
    user-approved fallback config surface, no model identity in execution
    evidence (unauditable), phase-risk gating absent; pause-and-resume quota
    handling retained as the safe behavior (`c4-quota-fallback-findings.md`).
28. **New PR numbers**: #21 (C1), #23 (C2), #24 (C3), #25 (C2.5), #26 (C4),
    plus this report/fixtures PR (#27).
29. **Merge SHAs**: 21→`6dde56b`, 23→`aecf711`, 24→`17265fd`, 25→`bdfb119`,
    26→`1270534`.
30. **Regression test counts/results**: suite grew ~120 → **178 tests /
    14 files green locally** (173 at PR #26 + 5 new §25 CASE fixtures);
    includes required coverage items 39–46 and C1/C2 case matrices.
31. **pnpm spec:verify**: OK — 13 checks passed (exit 0) at every pushed PR
    HEAD.
32. **pnpm verify**: exit 0 — 13 files / 173 tests at PR #26 HEAD; re-run at
    final merge HEAD recorded below in Verification battery.
33. **autopilot:selftest**: PASS=106 FAIL=0 (includes S17: OPTIMIZED launches
    optimized DAG, LEGACY keeps original).
34. **Archon validation**: `archon validate workflows foresift-work-package-
optimized` — ok (1 valid, 0 errors); smoke workflows validated likewise.
35. **Throughput smoke**: 10/10 nodes at exact C4 HEAD `44736ff` — first fresh
    attempt failed at create-pr-dryrun-proof because the fresh run worktree
    pinned its branch at main (bdfb119) while overlaying feature files (dirty
    tracked tree REFUSED); re-pinned the disposable smoke worktree to the exact
    HEAD and resumed run `6c87c238` → completed successfully. Failure cause and
    fix recorded (memory: archon-smoke-run-worktree-pinning).
36. **New V2 smoke result**: same as 35 (the throughput smoke IS the V2-era
    hermetic runtime smoke; it exercises gate manifest, attestation reuse,
    targeted verify, router, deterministic PR composition end-to-end offline).
37. **CLEAN benchmark** (§25 CASE A): local FULL=1, convergence AI=0,
    create-PR AI=0, landing AI=0, ATTESTATION_REUSE, CI ≥1 exact-head —
    all asserted by `tests/automation/v2-second-pass-cases.spec.ts`; wall-clock
    in vivo: NOT MEASURABLE YET (no OPTIMIZED package has run); local proxies:
    FULL gate 37.5→29 s, pnpm verify 47.6→39 s (C2.5 AFTER.md).
38. **GATE REPAIR benchmark** (§25 CASE B): TARGETED plan from structured
    manifest + exactly one FINAL FULL asserted; in-vivo counts NOT MEASURABLE
    YET.
39. **REVIEW FINDING benchmark** (§25 CASE C): old attestation drifts non-null
    on HEAD change; APPROVED verdict cannot skip convergence; targeted checks
    during repair; FINAL FULL on new HEAD required — asserted.
40. **UNKNOWN IMPACT benchmark** (§25 CASE D): ROOT_OR_UNKNOWN escalates
    fail-closed with empty FAST plan and recorded reason; authoritative-spec
    lane takes authority-validate steps — asserted.
41. **Final production activation boundary** (§27): after PR #26 merged, main
    checkout updated (`1270534`); live product run inspected (still running);
    the next NOT-yet-started package is **g0-security-perimeter** (PENDING,
    deps on the RUNNING g0-contracts-data-truth); proven READ-ONLY that it
    resolves `OPTIMIZED` → `foresift-work-package-optimized`
    (`work-package-throughput-profile.mjs` + `workPackageWorkflow()`); NOT
    launched — supervisor remains the launcher. g0-contracts-data-truth keeps
    LEGACY behavior forever.
42. **Current live product status after work**: `g0-contracts-data-truth` run
    `6953d02f` RUNNING under supervisor management (resumeCount 1,
    restartCount 1 — supervisor-native recoveries); pausedFatal null; no
    operator intervention at any point.
43. **Measured second-pass improvement** (MEASURED, structural + local):
    clean-path FULL 3→1; clean-path AI invocations ≥10 → ~7 (review block
    only; converge/judge/create-pr/landing now 0 on clean); convergence cost
    on clean path eliminated entirely; FULL gate wall 37.5→29 s (−22 %);
    pnpm verify 47.6→39 s (−18 %); git spawns 543→375 (−31 %); test-authoring
    inner loop minutes → seconds (two-tier suites); CI Verify job 43–48 s
    unchanged-by-design.
44. **Expected production improvement** (EXPECTED IN PRODUCTION — estimate,
    clearly not measured): for each future OPTIMIZED package, eliminating 2
    redundant local FULL runs (~2 × 29 s) + converge/judge AI turns (minutes)
    - create-PR/landing AI turns (minutes) per clean package, and avoiding
      checkpoint-invalidated context rebuilds each slice (minutes-scale per
      slice); repair paths save one full gate per intermediate edit. These
      magnitudes follow from measured component costs but the end-to-end package
      wall-clock reduction is an ESTIMATE until the first OPTIMIZED package
      completes.
45. **Remaining bottlenecks ranked by measured impact**:
    1. LEGACY implementation iteration itself (~1030 s/iteration measured
       first-pass; dominates everything while G0 runs LEGACY);
    2. review block ≈7 AI invocations per package (untouched by design —
       quality boundary);
    3. GitHub CI wait on the clean path (48 s measured; AI no longer waits
       idly, but human-visible latency remains);
    4. FULL gate 29 s local (was 37.5 s; further gains need narrower suites);
    5. context reads inside review agents (packet should reduce broad reads —
       in-vivo effect NOT MEASURABLE YET).

## Verification battery at final merge HEAD `1270534`

| command                       | result                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| `pnpm spec:verify`            | OK — 13 checks (exit 0)                                                |
| `pnpm verify`                 | see PR #27 CI (exact-head) — recorded in comments                      |
| `pnpm autopilot:selftest`     | PASS=106 FAIL=0                                                        |
| `archon validate workflows …` | ok                                                                     |
| throughput smoke              | completed 10/10 at 44736ff content (identical tree modulo report docs) |
