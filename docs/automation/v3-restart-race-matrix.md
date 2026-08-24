# V3 §30 — Restart race matrix (`--restart-package --fresh-generation`)

Every crash/concurrency window of the fresh-generation restart command
(`scripts/automation/foresift-autopilot.mjs`, `cmdRestartPackage`), the required
behavior, and the hermetic proof. All rows run at every pushed HEAD via
`pnpm verify` (PROVEN). Evidence: `GEN` = `tests/automation/v3-generations.spec.ts`
(`--restart-package CLI flows` describe for B/F/H; `§30 restart race matrix`
describe for A/C/E/J).

Ordering invariant preserved by the implementation: live-run safety refusals
precede every replay/idempotency path; anomalies on disk surface as refusals,
never as friendly no-ops.

| ID      | Window / fault                                                             | Required behavior                                                                                                                                                                                                                                    | Evidence                                                             |
| ------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A       | Second invocation while another autopilot process holds the singleton lock | Exit 3 refusal naming the lock rule; NOTHING mutated — no intent written behind the lock                                                                                                                                                             | GEN Case A                                                           |
| B       | Crash BEFORE the generation persist (intent written)                       | Rerun recomputes the same target, adopts the matching intent verbatim, converges on one receipt                                                                                                                                                      | GEN Case C test exercises the adopt path; intent-adoption asserted   |
| C       | Crash AFTER the persist, BEFORE the receipt                                | Intent target EQUALS milestone generation ⇒ resume AT that generation; receipt records the ORIGINAL transition; never re-increments                                                                                                                  | GEN Case C (+ guard row below)                                       |
| C-guard | Same as C but the persisted generation already launched                    | REFUSED "refusing to backfill a completed generation" — history is never laundered into paperwork                                                                                                                                                    | GEN Case C guard                                                     |
| E       | Crash between receipt write and intent deletion                            | Target-generation receipt replays AND consumes the surviving intent; a later genuine restart proceeds unblocked                                                                                                                                      | GEN Case E                                                           |
| F       | Duplicate invocation after completion (no launch since)                    | Prior receipt replayed; cannot create generation 2 (§7 hard rule)                                                                                                                                                                                    | GEN §7 replay test                                                   |
| F′      | Deliberate re-restart past a completed-but-unlaunched generation           | `--confirm-new-generation` advances explicitly                                                                                                                                                                                                       | GEN confirm-new-generation test                                      |
| H       | Stale/foreign intent targeting a different generation                      | Fail-closed refusal naming both files; the command never deletes a foreign intent (sticky until operator inspects)                                                                                                                                   | GEN stale-intent test                                                |
| I1      | Tracked live active run exists                                             | Refusal BEFORE any mutation ("stop/abandon it first")                                                                                                                                                                                                | GEN Case B test                                                      |
| I1′     | Tracked run whose Archon row PROVES terminal (completed/failed/cancelled)  | Reconciled on disk immediately (row dropped, `restart_reconciled_terminal_tracked_run` history event); restart proceeds — never forces an operator into a supervisor tick whose same-tick reconcile→launch order would relaunch retired generation 0 | GEN Case B′ (+B″ persistence-under-replay, B‴ still-running refusal) |
| I2      | Live current-generation run row in Archon                                  | Refusal BEFORE any mutation ("current-generation run(s) still live")                                                                                                                                                                                 | GEN live-row test                                                    |
| J1      | Salvage manifest unreadable (garbage bytes)                                | Refusal BEFORE touching anything; no intent, no mutation                                                                                                                                                                                             | GEN Case J1                                                          |
| J2      | Manifest schema ≠ `foresift/salvage-manifest@1`                            | Refusal naming both schemas BEFORE touching anything                                                                                                                                                                                                 | GEN foreign-schema test                                              |
| J3      | Manifest names ANOTHER package                                             | Refusal with the mismatch named                                                                                                                                                                                                                      | GEN Case J2                                                          |

Defects found and fixed while proving this matrix (2026-08-23, PR for this doc):

- **C used to refuse instead of converge** — every rerun after a
  persist-crash hit the stale-intent error, breaking the documented
  crash-safety contract.
- **E leaked a poison intent** — the replay left the intent on disk, so all
  FUTURE genuine restarts were refused until an operator hand-deleted it.
- **I1 could deadlock activation (found by the real gen-1 reset, 2026-08-23)** —
  the tracked-live gate trusted stale local bookkeeping over Archon truth: the
  retired G0 run was already `cancelled` upstream, yet the gate refused, and
  the ONLY supported unblock (a supervisor tick) would have relaunched retired
  generation 0 in the same tick. Fixed by reconciling proven-terminal rows
  inside the restart itself, persisted immediately so the §7 replay
  short-circuit cannot silently discard the reconciliation.
- **First tick after start raced the queued main refresh (found while preparing
  gen-1 activation, 2026-08-24)** — `tick()` enqueued its fetch+fast-forward
  but reconciled/selected against the working tree immediately, so starting
  the supervisor right after a state-chore merge read the PRE-reset milestone
  (`RUNNING` gen 0, every Archon row terminal) and latched a fatal pause
  instead of launching the fresh generation. Fixed by draining the serialized
  git queue before any reconcile/selection decision, and by making the
  fast-forward tracking-independent (`git merge --ff-only origin/main`, not
  bare `git pull --ff-only`, which silently no-ops without branch tracking
  config). Hermetic proof: first-tick fixture with `origin/main` ahead of the
  checkout asserts the CURRENT generation launches and no fatal pause latches
  (`v3-generations.spec.ts`, "first tick drains the queued main fast-forward").
- **`--clear-fatal` left a permanent selection deadlock behind the cleared
  pause (observed live during gen-1 activation, 2026-08-24)** — clearing the
  flag retained the fatal-paused entry, which occupies its package's selection
  slot forever; once the milestone has moved generations the row is neither
  resumable (`--recover-fatal` refuses cross-generation recovery, by design)
  nor splicable (terminal-row reconciliation ignores paused rows). Fixed:
  clearing now also untracks every fatal-paused row (recorded as
  `fatal_pause_entries_dropped`); stranded reconciliation rebuilds whatever
  tracking is still warranted against current truth next tick, and the
  pre-existing orphan refusal still guards RUNNING-without-live-track.
- **Reused run worktrees turned every post-mortem relaunch into a permanent
  crash-loop (observed live during gen-1 activation, 2026-08-24)** — Archon
  keeps ONE worktree per package+generation, so a dead run's residue (planning
  scratch, stale workflow materializations) survived into the next run and
  tripped adopt-generation-branch's dirty-tree refusal on every fresh launch;
  nothing in the supported lifecycle reset it, so recover-fatal → relaunch →
  refusal looped forever. Corollary: any OTHER worktree holding the generation
  branch (e.g. an operator seed worktree left over from ADR-0010 seed
  reconciliation) blocks adoption's `checkout -B` the same way. Fixed:
  every FRESH detached launch now deterministically resets the Archon-owned
  worktree on its target branch before spawning (`run_worktree_reset` audit
  event with the wiped manifest), guarded fail-closed — this checkout and
  non-Archon worktrees are never touched, and a branch origin cannot vouch
  for (missing ref or unpushed commits) is skipped so adoption's own refusal
  pauses for an operator instead of destroying possibly-real work. The
  adoption verdict (and any refusal text) is also teed into
  `$ARTIFACTS_DIR/adoption-verdict.json` because detached-run logs do not
  carry bash-node stderr; a blind refusal cost a full diagnosis cycle.
- **Every merge to main re-staled the generation seed, making adoption refuse
  forever without manual reconciliation (observed three times live during
  gen-1 activation, 2026-08-24)** — ADR-0010's currency gate refuses any seed
  that does not contain current origin/main, but control-plane work lands on
  main constantly (state chores land directly on main; the third refusal was
  caused by the defect-#6 fix itself). Hermetic reproduction exposed an even
  tighter intra-tick face: the supervisor's own PENDING→RUNNING chore commit
  raced and beat the workflow's currency check within one tick, re-staling a
  seed reconciled moments earlier. Fixed: the supervisor performs the ADR's
  own prescribed remediation automatically — every fresh launch merges
  updated origin/main into the stale seed as a normal merge commit and pushes
  (`generation_seed_reconciled` audit event), and any state-chore path
  re-runs the reconciliation BEHIND the chore on the serialized git queue
  (running inline would read pre-chore origin/main and no-op as 'current').
  Fail-closed: a merge CONFLICT aborts and leaves the seed stale so
  adoption's refusal pauses for an operator instead of forcing divergent
  history together; push failure rolls the worktree back to the pushed tip.
- **The gate-repair loop's verification step inherited archon's 120 s bash
  default, so any real repair died at re-verification (live run
  14ed21bdde69, 2026-08-24)** — `repair-targeted-recheck` declared no
  explicit `timeout:`; a targeted TESTS-category recheck measures ~282 s
  under contention on this box (the repair agent's own full-suite run), so
  the node was killed mid-verification on the loop's third iteration and the
  workflow failed with `repair-final-full` correctly skipped by trigger
  rule. Fail-closed held throughout — no attestation, no PR, everything
  downstream skipped — but the loop was structurally fail-always: no AI
  repair could ever be converted into a green verdict. The same latent gap
  existed at `converge-targeted-recheck` in the convergence loop (found by
  the structural regression, not by manual audit). Fixed: both nodes carry
  explicit 30-minute budgets matching their sibling FULL-gate nodes, and
  `tests/automation/workflow-node-budgets.spec.ts` pins the invariant that
  any bash node invoking `package-targeted-verify.mjs` or
  `package-full-gate.mjs` must declare an explicit budget ≥ 10 minutes.
  Before relaunching, the four committed-but-unpushed repair commits from
  the dead run were pushed to the generation branch (fast-forward) so
  adoption's `checkout -B` could not orphan real spend.
- **Implementation "complete" over an uncommitted tree moved the failure to
  the LAST node of the chain (live run 8061381a, 2026-08-24)** — the scoped
  plan told the implement agent to leave ALL changes uncommitted,
  misattributing the constraint to Constitution XVII (which actually mandates
  additive git history: commits included). `package-implement-complete.mjs`
  accepted the verdict (its git checks only rejected detached HEAD), the FULL
  gate passed on the dirty tree, and `create-pr`'s dirty-tree guard refused —
  after ~62 minutes of spend, with no earlier node the wiser. Fixed:
  completion now requires committed coherence (`git status --porcelain
-uall` empty when every other condition is met; error text names the paths
  and teaches the remediation). Partial slices keep their designed right to
  dirty trees across loop iterations. The gate-passed uncommitted state was
  preserved as commit `0ee8f42` on the generation branch before recovery so
  the supervisor's residue reset could not destroy verified spend. Machinery
  is authoritative over AI-authored plan text either way (Constitution XVIII).
