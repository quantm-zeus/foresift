# V4 THROUGHPUT CLOSEOUT — FINAL REPORT (§14)

Generated against the live production system. Fields marked `TBD` resolve
when the in-flight wave/tool-core proof completes; this file is finalized
and committed only once every field is concrete.

## Planning → wave handoff

- POST_PLANNING_GAP_CONFIRMED: YES
- ROOT_CAUSE: defect #20 — bootstrap planning verified milestone
  completeness at one path but the launch seam consumed it from another,
  so a completed planning run never reached the sharded-wave launcher;
  waves only started via incidental re-entry.
- HANDOFF_DESIGN: first-class crash-safe handoff — same-tick ordered
  sequence [pre-launch worktree advance → `planning_handoff_complete`
  (completeness verified at the run's `working_path`) → specs-promotion
  chore → wave launch LAST], additive commits, fail-closed recovery doors.
- HANDOFF_PR: #60 (squash-merged 2026-08-25T15:11:20Z)
- HANDOFF_MAIN_SHA: `5f52f8edf2fdf5a876db86e5d9b5d34856dd40f3`

## Old tool-core optimized run reconciliation

- CURRENT_TOOL_CORE_OLD_RUN: `699b29bb…` (optimized-profile run,
  CANCELLED — terminal)
- OLD_RUN_HAD_USEFUL_IMPL_WORK: YES
- OLD_WORK_PRESERVED: YES — durable tip `e9c0cdc` pushed to
  `refs/heads/foresift/g0-tool-core` (24-stage pipeline orchestrator T601
  plus T403–T404/T501–T503); discarded scratch reachable until GC.
- OLD_RUN_RETIRED: YES — cancelled through the supported door; supervisor
  itself flipped the package RUNNING→PENDING as an idempotent control
  chore (`c10fa8d`, event `run_cancelled_requeued`).

## Tool-core sharded-wave proof

- TOOL_CORE_PLANNING_COMPLETE: YES — planning artifacts seeded to origin
  main as chore `306b511` scoped exactly to `specs/g0-tool-core/*`;
  validator reads `complete:true` (42 tasks) against the main tree.
- TOOL_CORE_SHARDED_RUN_ID: `980e79223794124bd331a77caf82dce6`
  (launched by the supervisor itself at 2026-08-26T09:49:38Z, one tick
  after provider-lifecycle finalized PROVEN from merged truth PR #66)
- TOOL_CORE_SHARDED_RUN_STARTED: 2026-08-26T09:49:38Z
- TOOL_CORE_WAVE_PREP_PASSED: YES — branch-adoption
  `ADOPTED_WITH_MAIN_ABSORBED` (head `3202db25`, absorbed main incl.
  #62–#66), prep planned core+shard-1 lanes over 23 open units,
  `writer-shard-1-agy` (real AGY) + CLAUDE core dispatched. Required a
  maintainer worktree advance first: the task worktree sat at its
  seeding-era base lacking `wave-branch-adoption.mjs` entirely
  (incident #6, finding 9).

## Real product proof (provider-lifecycle waves)

- REAL_WRITER_LANE_EXECUTED: YES — wave 1 core lane: 4h17m real
  implementation, ~308k output tokens, 31 units on
  `foresift/wave/5f52f8edf2-core`; wave 3: both non-core lanes executed
  via real `agy` CLI (heads `07d7104`, `f0e382fb`) and CLAUDE core lane
  completed 10 commits through run lineage `f9ed4de6` → `ff96e2d0` →
  `b101f6c3` (two supported-door `--recover-fatal` cycles after novel
  guard-refusal surfaces, each advancing the task worktree base to
  fresh main; see findings 4–7).
- REAL_ADDITIVE_INTEGRATION: YES — twice. Provider run `b101f6c3`
  integrated all dispatched lanes additively (first full-guard pass of
  the sharded design); tool-core wave-1 run `980e7922` then passed BOTH
  lane guards with ZERO refusals (~100 ms each) and integrated shard-1
  additively (`f46f9c7`) over adopted tip `3202db25`.
- REAL_TRUE_FAST_GREEN: YES — tool-core wave-1 `980e7922` achieved it
  through the converged repair loop: RED at FAST on one misformatted
  file (`packages/shared-schemas/src/core.ts`, caught by the milestone
  gate's FORMAT category inside the e2e spawners) → repair iteration 1
  committed `dae5889` → serialized `fast-recheck` NODE reran the actual
  FAST tier to green (`wave-fast-verdict.json` `exitCode:0,
  phase:"recheck"`) under its 1 h budget — the exact structure landed in
  PR #65 after the bare-guard budget killed provider's identical repair.
  Durable checkpoint written (`implementation-checkpoint@2`, 20/42
  tasks, targetedChecks fast-verify PASS).

## Invariants

- IMPLEMENTATION_AI_IN_PLANNING_BOOTSTRAP: 0 (bootstrap used zero
  implementation providers; ~35 min deterministic planning)
- DUPLICATE_ACTIVE_TOOL_CORE_RUNS: NO (exactly one terminal cancelled row)
- G0_MAX_CONCURRENCY_STILL_1: YES (`maxParallelCodingPackagesFoundation: 1`
  honored by every observed selection)

## Semantics + hardening

- FINALIZE_FROM_MAIN_SEMANTICS_ALIGNED: YES — finalize authority is the
  CURRENT origin/main HEAD; reopen of a current-main package refused.
- CURRENT_MAIN_REOPEN_REGRESSION_PINNED: YES (dedicated spec coverage).
- CLAUDE_SCANNER_EXCLUSION_SAFE: YES
- SCANNER_GUARD_OR_NARROWING: prohibited-capability scanner never sweeps
  `.claude` tooling state (defect #19, PR #59, main commit `849f74f`);
  exclusion is path-narrowed to Claude Code's own state directories, not
  a blanket content exemption.

## Convergence

- FULL_VERIFY: green at closeout HEAD (final run logged here at finalize)
- EXACT_HEAD_CI: SUCCESS run 32911776717 @ main `9b8186844b…`
  (re-pinned at FINAL_MAIN_SHA during finalize)
- FINAL_MAIN_SHA: TBD (advances with wave-3 landing before finalize)
- AUTOPILOT_SERVICE: active (systemd --user, drop-in AGY opt-in loaded)
- PRODUCT_AUTONOMY_CONTINUING: YES
- FOLLOWUP_SESSION_SAFE_TO_RETIRE: TBD (set at finalize)

## Additive findings recorded during live operation

1. Wave prep should prune its predecessor's wave-scratch worktree
   registrations before `worktree add -B` (base-freeze collision).
2. WRITE-AUTHORITY VIOLATION deserves a dedicated failure class (resume
   budget currently burns before the converging fresh restart).
3. agy result-event errors should surface in the node_error line (stderr
   tail alone is empty for in-stream failures).
4. Guard-refusal coverage is only as complete as the task-graph
   collector's collectible-path set. Emergent shared surfaces — root
   `package.json` devDependencies links (PR #63) and an emergent shared
   test helper `tests/helpers/prov.ts` (PR #64) — were unplannable and
   therefore unrecordable until the collector was extended and the
   surfaces recorded as scope exceptions from live guard evidence. A
   fourth novel surface should trigger the systematic fix: declare the
   helpers family in milestone writeScopes.
5. Bare `until_bash` guards carry a short default wall budget (~3 min
   observed live). Heavy verification must live in a serialized node
   with an explicit timeout; the guard stays a sub-second verdict read
   fed by textual substitution (PR #65, gate-repair-loop idiom).
6. Production env leaks into test processes are a recurring hermeticity
   class: `FORESIFT_AGY_LANES` (manager env → emitEngineFiles ambient
   fallback) and `ARTIFACTS_DIR` (ADR-0004 regular-node export → child
   env-fallback modes) both changed test outcomes only inside the wave
   process tree. Tests must inject env explicitly via the DI contract,
   never inherit ambient state.
7. E2E budgets that embed a FULL nested suite track suite growth, not
   gate cost: C2.5-era 600 s budgets became deterministic false REDs by
   pure timeout at ~1500 tests (PR #65 raised to 1 800 000 ms with
   dated rationale).
8. Recovery gap (incident #5, run `49d7cc1a`): a relaunch after
   implementation-complete-but-pre-landing death produces a VACUOUS
   wave — the graph builder counts open units from the task worktree's
   tasks.md (all 33 already checked at tip `f3d4481`), branch-adoption
   trusts only pushed launch branches, so prep plans 0 shards/briefs
   and the workflow completes in ~14 s; the supervisor correctly pauses
   on completed_without_merge. Resolution path used: land through a
   normal PR (#66) and let the supervisor reconcile PROVEN from merged
   truth (`finalizeCompletedRun`). Workflow-level fix remains open.
9. Task worktrees are pinned at their seeding-era base forever unless
   something advances them (incident #6, run `efd9b5f5`): tool-core's
   task worktree predated `wave-branch-adoption.mjs`, so the wave died
   at MODULE_NOT_FOUND in 70 ms. The recover-fatal door's advance skips
   on divergence, which cannot heal this class. Maintainer fix:
   fast-forwarded the worktree to a reconciled tip containing both its
   implementation lineage and current main (`0a953ce`). Same family as
   the smoke-run pinning law; launch-time worktree freshness remains an
   open workflow-level gap.
10. The sharded wave is implementation-only by design ("the
   authoritative FULL gate stays downstream"): every settled wave ends
   without a merged PR, and continuation happens through further waves.
   When the supervisor's per-row resume/restart budget is already
   spent, that design point latches paused_fatal instead of continuing.
   Continuation sequence proven live on `980e7922` → `4a827e39`:
   publish the slice's commits to the package branch FIRST, then
   `--recover-fatal` — adoption absorbs the published tip and the next
   wave plans only remaining open units. Landing-only-continuation
   (finding 8) still applies once units reach zero.
