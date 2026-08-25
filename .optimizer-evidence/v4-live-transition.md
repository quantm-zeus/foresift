# V4 closeout — live production transition log (2026-08-25)

Running record of the post-merge production activation (directive §12), kept
while the proof is in flight; final values land in `v4-final-report.md`.

## Control-plane state

| Fact                                   | Value                                    | Evidence                    |
| -------------------------------------- | ---------------------------------------- | --------------------------- |
| PR #60 (defect #20 handoff)            | squash-merged                            | origin/main `5f52f8e`       |
| FULL local `pnpm verify` @ merged main | EXIT=0, 1289/1289 tests                  | `/tmp/full-verify-main.log` |
| CI on exact current main HEAD          | SUCCESS run 32868713743 @ `32f9c8f`      | gh run list                 |
| G0 coding concurrency policy           | `maxParallelCodingPackagesFoundation: 1` | roadmap.json policy         |
| Supervisor service                     | active, PID 1789709, code @ merged main  | systemctl                   |

## Old g0-tool-core optimized run — reconciled

- Run `699b29bb` cancelled via supported door after its tip was preserved.
- Durable tip `e9c0cdc` (24-stage pipeline orchestrator T601, plus prior
  T403–T404/T501–T503 commits) pushed to `refs/heads/foresift/g0-tool-core`.
- Supervisor itself flipped the package RUNNING→PENDING as an idempotent
  control-plane chore (`c10fa8d`, event `run_cancelled_requeued`).
- Planning artifacts promoted to origin main through the operator door
  `--seed-package-planning` → chore `306b511` scoped exactly to
  `specs/g0-tool-core/{plan,spec,tasks}.md`; validator reads
  `complete:true` (42 tasks) against the main tree.
- Duplicate active tool-core runs: **0** (one terminal cancelled row).

## Why provider-lifecycle took the first slot (not an anomaly)

At the 15:27 selection, tool-core's cancelled→PENDING flip existed only in
the working tree; defect #11's committed-state discipline makes selection
read the _committed_ milestone, so tool-core deferred one tick by design and
the next-ranked committed-PENDING package (`g0-provider-lifecycle`) launched
into planning bootstrap. C4 ranking snapshot (live computation):
`g0-tool-core {LDP:3, UDC:4}` strictly dominates all pending packages, so
tool-core is first in line once the slot frees.

## First live first-class handoff — g0-provider-lifecycle (15:54Z)

1. `supervisor_started` PID 1789709 re-adopted bootstrap `7d238c0f` cleanly
   (no duplicate launch) across the seed-window restart.
2. Bootstrap completed planning (~35 min, zero implementation providers).
3. One tick, ordered: pre-launch worktree advance **skipped (dirty)** on the
   untracked fresh planning output → `planning_handoff_complete`:
   completeness verified at the run worktree (`working_path`), specs
   promoted as chore `32f9c8f`, wave `foresift-sharded-wave` run
   `e736b1cd` launched last ⇒ same-tick wave routing under G0=1.
4. Wave DAG: `branch-adoption` executed clean (archon node cwd is the
   workspace `source` checkout @ `32f9c8f`) → `FRESH_FROM_MAIN`
   (origin branch absent — correct), admission gates ok, prep pinned BASE,
   briefs built, engines `CLAUDE`+`CLAUDE`.
5. Writer lanes `writer-shard-1`, `writer-shard-2`, `writer-core` running
   since 15:54:54 against private worktrees `wt/shard-1`, `wt/shard-2`,
   `wt/core`.

## Why the first production wave routed shards to CLAUDE (AGY diagnosis)

Mechanism (`exec-agy-writer.mjs`): prep writes `engine-<lane>.txt` via
`decideWriterEngine` — core lane always CLAUDE; a non-core lane routes AGY
only when **both** `FORESIFT_AGY_LANES` lists the lane **and** `agy`
resolves on PATH; anything else deterministically CLAUDE (fail closed).
The AGY writer nodes were then correctly `when`-skipped — not an agy
failure.

Runtime probes (2026-08-25 ~16:20Z):

| Check                         | Result                                             |
| ----------------------------- | -------------------------------------------------- |
| `command -v agy`              | `/home/minhquan_eth/.local/bin/agy`                |
| agy version                   | 1.1.19 (installed Aug 24)                          |
| agy auth/function             | live print-mode turn `status:"SUCCESS"` in 4.6 s   |
| Supervisor unit env           | only `PATH`/`HOME`; **`FORESIFT_AGY_LANES` unset** |
| archon serve / run-worker env | same (no opt-in); worker PATH resolves agy         |

Root cause: the opt-in variable was never propagated into the service
environment, so the default decided CLAUDE before any agy capability
mattered. Detached wave workers inherit the supervisor unit's environment
(`archon workflow run --detach` child of the supervisor, reparented to
`systemd --user`).

Smallest durable fix applied (16:27Z, live wave untouched):

- `~/.config/systemd/user/foresift-autopilot.service.d/agy-lanes.conf`:
  `Environment=FORESIFT_AGY_LANES=shard-1,shard-2` (+ `daemon-reload`);
- user-manager belt-and-braces: `systemctl --user set-environment` and
  `~/.config/environment.d/foresift-agy-lanes.conf` (boot persistence);
- supervisor restarted 16:27:58 (proven non-disruptive; wave re-adopted,
  zero duplicate launches). Live PID environ verified to carry the var;
  decision dry-run under it: shard-1→AGY, shard-2→AGY, core→CLAUDE,
  unset→CLAUDE.

Next eligible non-core shard: g0-tool-core's upcoming wave prep should emit
AGY for shard lanes — the intended real-production AGY proof point.

## First-wave guard refusal (honest checkpoint, 20:11Z)

All three writer lanes delivered real work (core: 4h17m, ~308k output
tokens, 31 units on `foresift/wave/5f52f8edf2-core`). At the gate,
`guard-core` refused fail-closed:

```
wave-guard: WRITE-AUTHORITY VIOLATION in core:
  - packages/persistence/test/migrator.spec.ts
  - pnpm-lock.yaml
```

Verdict verified CORRECT against recorded planning truth: package
writeScopes never cover `packages/persistence/test/**`; the only
persistence exception is `packages/persistence/src/migrator.ts` (source);
lockfiles are authorized nowhere. The lane overstepped (edited a
persistence test to unblock its e2e; lockfile drifted). Downstream nodes
skipped by trigger rules; no false green, no checkpoint after red.

Supervisor recovery engaged autonomously (`resume_scheduled`, class
UNKNOWN): resume deterministically re-hits the same guard while the
violating scratch persists; the bounded budget then escalates to a fresh
wave launch whose new run-artifacts dir yields clean writer worktrees.
Runtime finding recorded: WRITE-AUTHORITY VIOLATION has no dedicated
failure class, so resume attempts burn before restart (converges anyway;
minutes, not hours).

## Wave-restart worktree collision (defect finding, 20:19Z) + supported-door recovery

The fresh restart failed deterministically at prep: the archon `source`
checkout still pinned base `5f52f8e`, so the redo tried to reuse branch
names `foresift/wave/5f52f8edf2-*` while they were still checked out in the
FIRST run's preserved writer worktrees:

```
fatal: 'foresift/wave/5f52f8edf2-core' is already used by worktree at
  '.../runs/e736b1cd…/wt/core'
```

The pre-consumed restart budget (guard episode) escalated this to
operator-gated fatal pause. Recovery executed strictly through supported
doors: `git worktree remove` of the three TERMINAL-run scratch registrations
(lane branches persist — discarded scratch remains reachable at
core=`f5ac8d1`, shard-1=`916c5ba`, shard-2=`a241ea6`; core tip message
confirms the violating edit: "track manifest-declared g0_prov migrations in
migrator spec inventory") → service stop → documented
`--recover-fatal <runId>` (dead-run abandon + single fresh continuation) →
service start. New wave run `34067833`, pause cleared, supervisor active.
Finding for closeout PR: wave prep should prune its predecessor's
wave-scratch worktrees before `worktree add` (or pin base after a source
sync), and WRITE-AUTHORITY VIOLATION deserves a dedicated failure class.

## Corrected runtime model (runner-log evidence)

Archon v0.9 executes wave DAG nodes inside the REUSED per-task worktree
(`worktrees/archon/task-<pkg>`), logging
`worktree.reuse_base_branch_mismatch` when it is not based on current main.
That task worktree still carries the planning bootstrap's UNTRACKED
`specs/g0-provider-lifecycle/`, which (a) makes every supervisor pre-launch
advance skip (`skipped:"dirty"`), freezing the worktree at `5f52f8e`, so
prep always pins that stale base, and (b) caused the restart collision.
`wave-branch-adoption`'s pristine-tree guard sits on the ADOPT path only;
the `FRESH_FROM_MAIN` path returns before it, so a dirty cwd adopts nothing
and correctly proceeds. Recovery redo `34067833` therefore succeeded once
the stale lane-worktree registrations were removed (`-B` legally reset the
branches at the pinned base).

Operator-door env nuance: the recover-fatal relaunch inherited MY shell
environment (no `FORESIFT_AGY_LANES`), not the service unit's, so redo
lanes emitted CLAUDE again. Durable opt-in remains armed for all
service-spawned launches — g0-tool-core's upcoming service-tick selection
is the AGY proof point. Post-wave maintenance queued (never mid-run): after
this wave completes and before tool-core's selection, remove the task
worktree's untracked `specs/g0-provider-lifecycle/` (content verified
identical to promoted commit `32f9c8f`) so its next advance reaches current
main and future bases stop freezing.

## Pending at time of writing

- Provider wave: writer completion → additive integration → TRUE FAST →
  push/PR → merge → finalize RUNNING→PROVEN from main.
- Tool-core: top-ranked C4 ⇒ direct `foresift-sharded-wave` entry (routing
  verified: `admitWorkflowForLaunch(WAVE_WORKFLOW, true)` → wave), with
  branch-adoption restoring `e9c0cdc` and absorbing main.
