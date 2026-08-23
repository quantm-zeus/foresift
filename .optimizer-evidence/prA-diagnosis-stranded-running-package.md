# PR A diagnosis — stranded RUNNING package after PAUSED_FATAL (proven from source + live state)

Captured READ-ONLY 2026-08-23T08:07–08:20Z, worktree foresift-throughput @ db4c2e5.

## Live stranded state (observed)

`~/.local/state/foresift/autopilot-state.json`:

```
activeRuns: []                       <- tracking lost
milestoneRuns: []
pausedFatal: { reason: "run b0a82481a8c9da9bf3bb372372f26c1d (g0-contracts-data-truth)
               exhausted recovery policy: failed: ... Rate limit exceeded:
               free-models-per-day-stealth ...", runId: b0a82481…, since: 1787470136796 }
```

`specs/implementation/current-milestone.json` (main checkout): g0-contracts-data-truth = **RUNNING**.
`pnpm autopilot:status` prints ⛔ PAUSED_FATAL and the RUNNING package with no run line.
Archon: run b0a82481a8c9da9bf3bb372372f26c1d status=failed, metadata.error = 429
"Rate limit exceeded: free-models-per-day-stealth".

## Timeline from state history

| ts (ms)                   | event                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| 1787456622567 (03:43:42Z) | work_package_launched (run b0a82481 discovered via runs-table)       |
| 1787469062944 (~06:31)    | resume_scheduled attempt 1 (backoff 120s) — 429 classified TRANSIENT |
| 1787469189679             | resumed                                                              |
| 1787469253705             | resume_scheduled attempt 2 (240s)                                    |
| 1787469505801             | resumed                                                              |
| 1787469569841             | resume_scheduled attempt 3 (480s)                                    |
| 1787470072750 (~07:27)    | resumed                                                              |
| 1787470136796 (~07:28)    | **paused_fatal** (transient budget exhausted)                        |

All three automatic resumes were burned against a _daily_ quota error inside ~58 minutes.
Each resumed run re-hit the same 429 within minutes (last_activity_at froze 06:32:25).

## Root cause chain (code)

1. `classifyFailure()` (scripts/automation/schema.mjs:133) matches `'rate limit'` /
   `'429'` → **TRANSIENT**. There is _no_ daily-quota distinction, so a provider
   daily-quota exhaustion consumed the ordinary transient retry budget
   (RESUME_LIMIT=3, backoff 2/4/8 min capped 15 min — scripts/automation/foresift-autopilot.mjs:47,204).
2. On exhaustion `attemptResume()` sets `st.pausedFatal = {reason, runId, since}`
   and returns true (foresift-autopilot.mjs:277-283) → `actOnEntry` true →
   `tick()` marks the entry `done` → the filter `st.activeRuns.filter(e => !e.done)`
   (foresift-autopilot.mjs:772) **drops the only durable tracking record**. Nothing
   resets the package status, so `current-milestone.json` keeps status RUNNING.
3. Result: `package=RUNNING ∧ activeRuns=[] ∧ pausedFatal≠null`.
4. Legacy `--clear-fatal` (foresift-autopilot.mjs:789-794) only nulls pausedFatal.
   Next tick, `selectAndLaunch` never re-selects the package because
   `packageEligible()` requires status PENDING (schema.mjs:175) →
   `package=RUNNING ∧ activeRuns=[] ∧ pausedFatal=null` — permanently stranded.
5. The pausedFatal record preserves no structured recovery identity (no
   workflow/branch/message/packageId), so even a hand-crafted resume cannot be
   reconciled by the supervisor from state alone.

## Pre-recovery product evidence (READ-ONLY, §7)

- Product worktree: `~/.archon/workspaces/quantm-zeus/foresift/worktrees/archon/task-foresift-g0-contracts-data-truth`
- Worktree branch: `archon/task-foresift-g0-contracts-data-truth`; supervisor-tracked
  PR branch: `foresift/g0-contracts-data-truth`
- HEAD: `a2016dab55b0ce0517742a82ae72d014be943454`
- Log (implementation commits): 3acc8b2 T001–T003 tooling roots · 7c6ce21 T004–T011 domain ·
  35f1440 T012–T014 shared-schemas · 49bc025 T015–T022 migrations/migrator ·
  bf92d4e T023–T029 identity/observation/replay repos · 7ab228f T030–T037 quality/source/feature repos ·
  4998c6a T038–T041 object-store · a2016da T042–T048 recovery tiers/backup governance/drills
- Uncommitted: `M specs/g0-contracts-data-truth/tasks.md` (task checkboxes only)
- tasks.md: **48 completed / 17 remaining** (65 total)
- Run metadata: id b0a82481a8c9da9bf3bb372372f26c1d, workflow foresift-work-package,
  started 2026-08-23 03:43:40, completed(failed) 07:10:17, worker cli-1787456619810-hiarpb
- Autopilot: service active/running (PID 69292 since 03:43:39), PAUSED_FATAL,
  g0-contracts-data-truth = RUNNING, activeRuns = []

## Fix design (implemented in PR A)

- `classifyFailure` gains a distinct **QUOTA_DAILY** class matched BEFORE transient
  patterns (evidence tokens: free-models-per-day, per-day quotas, "quota exhausted",
  "daily rate limit", provider reset timestamps). Transient 429 throttling stays TRANSIENT.
- QUOTA_DAILY never consumes the transient resume budget. It enters a durable
  **quota pause** on the retained tracked entry: conservative exponential probe
  schedule (base 6 h, ×2 per probe, cap 24 h, max 3 automatic probes; provider
  reset-at honored when present, clamped [30 min, 48 h]). Probes are supervisor-owned
  `workflow resume` calls — no busy-loop, no sleeping inside Claude processes.
  Probe-budget exhaustion escalates to PAUSED_FATAL **with structured identity**.
- PAUSED_FATAL / quota pauses **retain the tracked entry** in activeRuns (marked
  `paused`), preserving runId/packageId/workflow/branch/message — recovery identity survives.
- New supported operator command **`--recover-fatal [runId]`**: under the singleton
  lock, verifies pausedFatal + Archon run lifecycle + milestone package identity +
  no-duplicate-run, resumes the SAME Archon run (fallback: exactly one fresh
  continuation on the SAME branch/worktree), restores authoritative activeRuns
  tracking, ensures package RUNNING, clears pausedFatal atomically (all reads and
  verifications precede any mutation). No JSON hand-editing.
- `--clear-fatal` becomes **fail-closed**: refuses (exit 1, no mutation) when
  clearing would orphan a RUNNING package (RUNNING with no non-paused tracked run),
  directing the operator to `--recover-fatal`.
- Defense-in-depth `reconcileStrandedPackages()` tick guard: any package left
  RUNNING with no tracked run is re-adopted from the Archon runs table (live run)
  or converted into a tracked fatal pause (dead/unknown run) — the supervisor can
  no longer settle into `RUNNING ∧ activeRuns=[] ∧ pausedFatal=null`.
