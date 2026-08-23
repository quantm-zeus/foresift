# ADR 0005: Provider daily-quota recovery policy and supported fatal-pause recovery

- Status: Accepted (2026-08-23)
- Context: G0 package `g0-contracts-data-truth`, run `b0a82481a8c9da9bf3bb372372f26c1d`
- Supersedes: the fatal-pause handling portions of the recovery policy in ADR 0001

## Context

On 2026-08-23 the product work-package run hit a provider **daily** quota wall
(`429 · Rate limit exceeded: free-models-per-day-stealth`) mid-implementation.
The supervisor's classifier matched the generic `'rate limit'`/`'429'` tokens
and classified it TRANSIENT, so all three automatic resumes (2/4/8 min backoff,
≤15 min cap) were burned against a once-a-day limit within ~1 hour. On
exhaustion, `attemptResume()` marked the tracked entry `done`; the tick filter
dropped it from `activeRuns`; nothing reset the package status. Result:

```
package g0-contracts-data-truth = RUNNING
activeRuns = []
pausedFatal = { reason, runId, since }   ← no workflow/branch/message identity
```

The legacy remedy `--clear-fatal` only nulled `pausedFatal`, leaving
`RUNNING ∧ activeRuns=[] ∧ pausedFatal=null`: permanently stranded, because
package selection requires status PENDING. Manual UI resume was unsafe for the
same reason — the supervisor would not regain authoritative tracking.

## Decision

1. **Three failure classes where there were two.** `classifyFailure()` now
   returns `QUOTA_DAILY` before the transient patterns are consulted (quota
   errors embed generic rate-limit wording; the daily-quota token is the
   discriminating evidence). Evidence tokens: `free-models-per-day`,
   `per-day`/`per day`, `daily quota`, `daily rate limit`, `daily limit`,
   `quota exhausted`, `quota exceeded`. FATAL evidence still wins when both
   appear.

2. **Quota exhaustion never spends transient retries.** A `QUOTA_DAILY`
   failure moves the run into a durable **quota pause**: the tracked entry is
   retained with `paused='quota'` and the supervisor owns a bounded probe
   schedule of widely spaced `archon workflow resume` calls:
   - provider reset time when supplied (`extractQuotaResetAt()`), clamped to
     [30 min, 48 h];
   - otherwise base 6 h, doubled per failed probe, capped at 24 h;
   - at most `QUOTA_PROBE_LIMIT = 3` automatic probes, then escalation to an
     operator-gated fatal pause.
     The supervisor owns waiting/retry timing; nothing sleeps inside a Claude
     process and nothing busy-loops a daily wall.

3. **Pauses preserve recovery identity.** Both pause kinds retain their tracked
   entry (never `done`-filtered). `pausedFatal` itself gains structured fields:
   `runId, kind, packageId, workflow, branch, message, since`.

4. **Supported operator recovery.** `--recover-fatal [runId]` (alias
   `pnpm autopilot:recover`) performs deterministic reconciliation under the
   singleton lock: verify pausedFatal → read the Archon run → cross-check
   milestone package identity and expected branch → refuse on any duplicate
   running workflow or identity mismatch → resume the SAME run (Archon supports
   resuming failed/paused runs from completed nodes) or, only if refused, launch
   exactly ONE fresh continuation on the SAME branch/worktree → restore the
   tracked entry → ensure package RUNNING → clear pausedFatal. All reads and
   verifications precede any mutation; refusals exit nonzero without mutating.
   The operator never hand-edits JSON.

5. **`--clear-fatal` is fail-closed.** It refuses (exit 1) when clearing would
   orphan a RUNNING package that has no non-paused tracked run.

6. **Invariant guard.** Each tick re-establishes tracking before selection: any
   RUNNING package without a tracked run gets its live Archon run re-adopted
   (state-loss recovery) or becomes a tracked fatal pause. `RUNNING ∧
activeRuns=[] ∧ pausedFatal=null` cannot survive a tick.

## Consequences

- A daily quota wall costs at most 3 automatic probe requests per ~42 h window
  instead of 3 resumes per hour plus a stranded package.
- Transient bursts keep exactly the previous policy (3 resumes, ≤15 min cap).
- Recovery preserves branch, worktree, commits, completed tasks, and Archon
  artifacts by construction; fresh continuations rediscover persisted work from
  disk/git per the existing architecture (no second orchestrator).
- Regression coverage: selftest scenarios S2 (recovery contract), S11–S14
  (quota pause, probe bound + escalation, invariant healing/adoption, refused-
  resume fallback) and unit tests for classification/reset extraction.
