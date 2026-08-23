# Follow-up diagnosis — `workflow resume` acks ok but silently does nothing

Captured 2026-08-23T08:47–09:20Z. Follow-up to `prA-diagnosis-stranded-running-package.md`.

## Observation (live)

First supported recovery (post-PR-#13 merge) at **08:47:12Z**:

```
operator_recovery_complete {"runId":"b0a82481a8c9da9bf3bb372372f26c1d",
 "packageId":"g0-contracts-data-truth","mode":"resume-same-run"}
```

Yet the run never restarted:

| Signal                          | Value                                                  | Reading                      |
| ------------------------------- | ------------------------------------------------------ | ---------------------------- |
| `archon workflow get b0a82481…` | status=`failed`, metadata.error = same 429             | row unchanged                |
| `last_activity_at`              | frozen at run's failure time (hours before the resume) | no engine activity since     |
| detached-run log dir            | no new writes after 07:10:17Z                          | no engine output             |
| `ps aux`                        | only `archon serve` + unrelated processes              | **no Claude worker process** |

Retrospective: the pre-fix supervisor's three `resumed` events (06:33, ~07:14,
~07:27 on 2026-08-23) show the same signature — the run row never moved after
any of them (`completed_at` stayed 07:10:17). **Archon 0.9 accepts
`workflow resume` for this failed DAG run and silently does nothing.**

Consequence: any flow that trusts the ack re-strands recovery. The supervisor's
stale-row classification then put the recovered entry into a safe-but-unhelpful
6 h quota pause (tracked, pausedFatal=null — system remained SAFE throughout).

## Fix (PR #14)

1. `resumeTookEffect()` — bounded (~15 s) run-row verification after every
   recovery/probe resume: effective ⇔ row left terminal state OR activity
   advanced past the resume moment. Stale terminal rows keep polling (slow
   starts must not false-negative).
2. Verified no-op ≡ refusal in operator recovery: late-wake adoption guard,
   then retire dead run via supported `workflow abandon`, then exactly ONE
   fresh continuation on the SAME branch/worktree.
3. Quota probes verified too; a no-op probe escalates to the operator-gated
   pause instead of burning budget (`quota_probe_resume_noop`).
4. `--recover-fatal` now reconciles TRACKED quota/fatal pauses without global
   `pausedFatal` (the exact live shape at capture time: entry paused='quota',
   next probe in ~333 min).
5. Post-recovery: fresh probe budget + 15-min stale-row shield.

## Pre-second-recovery live snapshot (09:16Z)

```
pausedFatal: null
activeRuns: [{runId b0a82481…, packageId g0-contracts-data-truth,
              branch foresift/g0-contracts-data-truth, paused:"quota",
              done:false, quotaProbes:0, nextProbeInMin:333}]
history tail: quota_pause_scheduled (08:47:24), supervisor_started (08:47:23),
              operator_recovery_complete (08:47:12), paused_fatal (07:28:56)
run b0a82481…: status=failed, same 429 metadata.error, workflow foresift-work-package
```

Product worktree untouched (READ-ONLY): HEAD a2016dab…, branch
archon/task-foresift-g0-contracts-data-truth, tasks.md 48/65 checked.
