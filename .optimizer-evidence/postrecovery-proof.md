# G0 recovery proof — supported mechanism, post-PR-#16

Executed 2026-08-23T09:50–09:55Z. Follows `prB0-diagnosis-silent-noop-resume.md`.

## Sequence (all supported operations only)

```
git -C /home/minhquan_eth/foresift pull --ff-only          # main -> a385812 (PR #16 squash)
systemctl --user stop foresift-autopilot.service           # singleton lock
node scripts/automation/foresift-autopilot.mjs --recover-fatal
systemctl --user start foresift-autopilot.service
```

## Recovery trace (supervisor events)

| ts (UTC) | event                                | detail                                                                                                              |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 09:52:01 | `operator_recovery_resume_noop`      | resume of b0a82481 acked ok; run-row verification proved nothing restarted (the exact defect PR #16 fixes)          |
| 09:52:04 | `operator_recovery_retired_dead_run` | supported `workflow abandon` → b0a82481 status=cancelled (cannot wake behind the continuation)                      |
| 09:52:06 | `operator_recovery_fresh_launch`     | ONE fresh continuation, SAME branch `foresift/g0-contracts-data-truth`, ack conversationId cli-1787478725146-7q18ik |
| 09:52:08 | `operator_recovery_complete`         | mode=single-fresh-continuation, runId **02b7546150d4ae0de3405d431b53f911** (durable id in ack), exit 0              |

## §7 post-conditions

- **Identity unchanged**: same package g0-contracts-data-truth, same PR branch
  foresift/g0-contracts-data-truth, same product worktree
  (`working_path: …/task-foresift-g0-contracts-data-truth`).
- **Work preserved (READ-ONLY verified)**: product worktree HEAD a2016da
  (T001–T048), tasks.md 48/65 checked, only checkbox modifications uncommitted.
- **Exactly one active tracked run**: runs table for this package shows
  02b75461=running (only running row); b0a82481=cancelled; no duplicates.
  Supervisor activeRuns = [02b75461, paused=null, done=false].
- **Not PAUSED_FATAL**: pausedFatal=null.
- **Implementation progressing**: run status=running, `last_activity_at`
  advancing (09:53:24), live worker pid 122326, supervisor observability shows
  `node=scoped-plan-iterate iter=1 idle=0m` — the bounded plan loop
  rediscovering persisted work from disk/git.

## Residual risk & ownership

If the provider's daily pool is still exhausted, the fresh continuation will
fail with the same 429; the supervisor (post-#16) classifies QUOTA_DAILY,
retains the tracked entry in a durable quota pause (6 h base backoff, ≤3
probes), and never busy-loops. No operator action required either way.

## PR trail

- #13 (merged 491cbd8): QUOTA_DAILY classification, tracked pauses, structured
  pausedFatal identity, `--recover-fatal`, fail-closed `--clear-fatal`.
- #14/#15 (closed, unmerged): correct change set, but based on the pre-squash
  commit → merge refs conflicted with main → GitHub silently skipped their
  pull_request CI (no check-runs). Lesson: after a squash merge, branch from
  the updated main.
- #16 (merged a385812, exact head cb1b3e3 CI-green): resume-effect
  verification, no-op→single-fresh-continuation fallback, dead-run retirement,
  quota-pause recovery path, probe verification. Selftest 103/103, vitest 39/39.
