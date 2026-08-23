#!/usr/bin/env node
// foresift-autopilot — thin external supervisor for the Foresift autonomous loop.
//
// Responsibilities (ONLY these): read implementation state, select eligible work
// packages, start Archon workflows, monitor runs, apply the concurrency policy,
// resume recoverable failed runs, invoke foresift-milestone-control when due,
// report status, sleep/poll. No product intelligence, no AI review logic, no
// worktree management, no direct database access — Archon CLI/JSON only.
//
// Usage:
//   node scripts/automation/foresift-autopilot.mjs             # supervisory loop
//   node scripts/automation/foresift-autopilot.mjs --once      # single tick (tests/cron)
//   node scripts/automation/foresift-autopilot.mjs --status    # operator status
//   node scripts/automation/foresift-autopilot.mjs --recover-fatal [runId]
//                                                              # supported operator recovery of a
//                                                              # PAUSED_FATAL pause (same run, same branch;
//                                                              # falls back to exactly ONE fresh continuation).
//                                                              # Stop the service unit first (singleton lock).
//   node scripts/automation/foresift-autopilot.mjs --clear-fatal
//                                                              # fail-closed: refuses when clearing would orphan
//                                                              # a RUNNING package (use --recover-fatal then)

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
  findPackage,
  packageEligible,
  canStartPackage,
  classifyFailure,
  extractQuotaResetAt,
} from './schema.mjs';

// Overridable for hermetic selftests (sandboxed fixture repo + state dir).
const REPO = process.env.FORESIFT_AUTOPILOT_REPO ?? join(import.meta.dirname, '..', '..');
const STATE_DIR =
  process.env.FORESIFT_AUTOPILOT_STATE_DIR ??
  join(process.env.HOME ?? '', '.local', 'state', 'foresift');
const STATE_FILE = join(STATE_DIR, 'autopilot-state.json');
const LOCK_FILE = join(STATE_DIR, 'autopilot.lock');
const POLL_INTERVAL_MS = 60_000;
const RESUME_LIMIT = 3; // workflow-level automatic resumes per §16
const FRESH_RESTARTS_LIMIT = 1;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 15 * 60_000;
// A "running" Archon row proves nothing about liveness; if a run shows no
// activity for this long we treat it as orphaned (§17).
const STALE_RUN_MS = 90 * 60_000;
// Detach acks carry no run id; discovery polls the runs table this often/at most.
const DISCOVERY_RETRY_MS = 30_000;
const DISCOVERY_LIMIT = 5;
// Daily/provider quota exhaustion (QUOTA_DAILY) never burns the ordinary
// transient resume budget. Instead the run enters a durable quota pause and the
// SUPERVISOR owns a small bounded schedule of widely spaced probe resumes:
// base 6 h, doubled per failed probe, capped at 24 h, at most QUOTA_PROBE_LIMIT
// automatic probes — then escalation to operator-gated PAUSED_FATAL. When the
// provider message carries a reset timestamp it is honored, clamped into
// [30 min, 48 h]. No busy-looping, no requests every few minutes against a
// once-a-day wall, no sleeping inside Claude processes.
const QUOTA_PROBE_BASE_MS = 6 * 60 * 60_000;
const QUOTA_PROBE_MAX_MS = 24 * 60 * 60_000;
const QUOTA_PROBE_LIMIT = 3;
const QUOTA_RESET_MIN_MS = 30 * 60_000;
const QUOTA_RESET_MAX_MS = 48 * 60 * 60_000;
// Runs-table window for re-adopting/identifying runs of an untracked RUNNING package.
const STRANDED_LOOKUP_CUTOFF_MS = 48 * 60 * 60_000;
// Archon 0.9 can acknowledge `workflow resume` with ok while leaving the run
// row untouched (observed live: ack ok, no worker process, no log activity,
// last_activity_at frozen hours earlier). Every resume that matters is
// therefore VERIFIED against the run row before anyone trusts it.
const RESUME_VERIFY_TRIES = 4;
const RESUME_VERIFY_GAP_MS = 5000;

const now = () => Date.now();
const log = (...m) => console.log(new Date().toISOString(), '[autopilot]', ...m);

/**
 * Normalize an Archon timestamp to epoch milliseconds.
 * Supports epoch-ms numbers, other numeric epochs (heuristic: < 1e11 ⇒ seconds),
 * numeric strings, and ISO strings ("2026-08-22 17:19:04", "…T…Z", offset forms;
 * missing timezone ⇒ UTC). Returns null when unparsable — callers must treat
 * unknown timestamps as "no opinion", never as "abandon the run".
 */
export function normalizeTimestampMs(v0) {
  if (v0 === null || v0 === undefined) return null;
  if (typeof v0 === 'number' && Number.isFinite(v0)) {
    return v0 < 1e11 ? Math.round(v0 * 1000) : Math.round(v0);
  }
  let v = String(v0).trim();
  if (!v) return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
  }
  v = v.replace(' ', 'T');
  if (!/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(v)) v += 'Z';
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Verify that a `workflow resume` actually restarted the run instead of
 * silently doing nothing. A resume counts as effective when the run row leaves
 * the terminal/paused state, or its activity timestamp advances past the
 * resume moment (engine restarted and re-failed fast — fresh failure
 * evidence). Polls a bounded window; unreadable polls keep trying rather than
 * concluding anything. `opts.getRow`/`opts.tries`/`opts.gapMs` exist for unit
 * tests; production callers use the defaults.
 */
export function resumeTookEffect(runId, resumeStartedAt, opts = {}) {
  const tries = opts.tries ?? RESUME_VERIFY_TRIES;
  const gapMs = opts.gapMs ?? RESUME_VERIFY_GAP_MS;
  const getRow = opts.getRow ?? ((id) => archonJson(`workflow get ${id} --json`));
  for (let i = 0; i < tries; i++) {
    if (i > 0) sleepSync(gapMs);
    const get = getRow(runId);
    const status = get?.status ?? get?.run?.status;
    if (get?._unparsed !== undefined || !status) continue; // unreadable: no opinion yet
    if (!['failed', 'paused', 'cancelled'].includes(status)) return true; // running/pending/completed
    const act = normalizeTimestampMs(get?.last_activity_at ?? get?.started_at);
    // Fresh failure evidence ⇒ the engine really restarted (tolerance absorbs clock skew).
    if (act != null && act >= resumeStartedAt - 1500) return true;
    // Stale terminal row: NOT decisive — the engine may still be spinning up,
    // so keep polling until the window closes.
  }
  return false;
}

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, { shell: true, cwd: REPO, encoding: 'utf8', ...opts });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
function archonJson(args) {
  const r = spawnSync(`archon ${args}`, { shell: true, cwd: REPO, encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  // Real CLI emits a single pretty-printed JSON document; tolerate stray log
  // lines by falling back to a scan for embedded JSON lines.
  try {
    return JSON.parse(out);
  } catch {}
  const line = out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('{') || s.startsWith('['))
    .pop();
  try {
    return JSON.parse(line);
  } catch {
    return { _unparsed: out, _stderr: r.stderr, _status: r.status };
  }
}

// ── runtime state ────────────────────────────────────────────────────────────
function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { activeRuns: [], milestoneRuns: [], pausedFatal: null, history: [] };
  }
}
function saveState(st) {
  mkdirSync(STATE_DIR, { recursive: true });
  st.updatedAt = now();
  writeFileSync(STATE_FILE, JSON.stringify(st, null, 2) + '\n');
}
function record(st, event, detail = {}) {
  st.history = [{ ts: now(), event, ...detail }, ...(st.history ?? [])].slice(0, 100);
  log(event, JSON.stringify(detail));
}

// Single-instance lock (stale-lock tolerant).
function acquireLock() {
  mkdirSync(STATE_DIR, { recursive: true });
  try {
    if (existsSync(LOCK_FILE)) {
      const pid = Number(readFileSync(LOCK_FILE, 'utf8').trim());
      if (pid && existsSync(`/proc/${pid}`)) return false;
      unlinkSync(LOCK_FILE);
    }
  } catch {}
  writeFileSync(LOCK_FILE, String(process.pid));
  process.on('exit', () => {
    try {
      unlinkSync(LOCK_FILE);
    } catch {}
  });
  return true;
}

// ── git / GitHub helpers ─────────────────────────────────────────────────────
let commitQueue = Promise.resolve();
const enqueue = (fn) => (commitQueue = commitQueue.then(fn, fn));

function refreshMain() {
  const dirty = sh('git status --porcelain -- specs/implementation');
  if (!dirty.ok || dirty.out) {
    log('main checkout has uncommitted implementation-state changes; committing first');
    commitState('specs/implementation', 'chore(autopilot): restore unsaved implementation state');
  }
  enqueue(() => {
    sh('git fetch origin main --quiet');
    const behind = sh('git rev-list --count main..origin/main');
    if (behind.ok && Number(behind.out) > 0 && !sh('git pull --ff-only').ok)
      log('WARN: could not fast-forward main');
  });
}
/** Commit + push implementation-state metadata directly (not product source). Serialized. */
function commitState(pathspec, message) {
  enqueue(() => {
    if (!sh(`git add ${pathspec}`).ok) return log('WARN: git add failed');
    if (sh('git diff --cached --quiet').ok) return; // nothing staged
    if (!sh(`git commit -m ${JSON.stringify(message)} -q`).ok) {
      sh('git reset -q');
      return log('WARN: state commit failed');
    }
    if (!sh('git push origin main --quiet').ok)
      log('WARN: push of state commit failed (will retry next tick)');
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

// ── package state transitions (version-controlled, machine-driven only) ──────
function setPackageStatus(ms, packageId, status) {
  const pkg = findPackage(ms, packageId);
  if (!pkg || pkg.status === status) return false;
  pkg.status = status;
  const file = join(REPO, 'specs', 'implementation', 'current-milestone.json');
  writeFileSync(file, JSON.stringify(ms, null, 2) + '\n');
  // Keep supervisor-written state Prettier-clean: these chore commits land
  // directly on main, and a raw JSON.stringify write would leave the next
  // PR failing format:check. Cosmetic only — never blocks the status flip.
  const fmt = sh(
    'npx --no-install prettier --write --log-level silent specs/implementation/current-milestone.json',
  );
  if (!fmt.ok) log('WARN: prettier-format of milestone state skipped (cosmetic only)');
  commitState(
    'specs/implementation',
    `chore(autopilot): ${ms.milestoneId}/${packageId} -> ${status}`,
  );
  return true;
}

// ── launching ────────────────────────────────────────────────────────────────
function launchDetached(workflow, branch, message) {
  const ack = archonJson(
    `workflow run ${workflow} --detach --branch ${branch} --json ${JSON.stringify(message)}`,
  );
  return ack;
}

// ── run bookkeeping ──────────────────────────────────────────────────────────
function backoffMs(attempt) {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

function trackRun(st, kind, entry) {
  (kind === 'milestone' ? st.milestoneRuns : st.activeRuns).push(entry);
}

async function finalizeCompletedRun(st, entry) {
  // Success = PR actually merged into main (never trust AI output alone).
  const gh = sh(
    `gh pr list --repo quantm-zeus/foresift --head ${entry.branch} --state merged --json number,url --limit 1`,
  );
  let merged = false;
  let mergedPr = null;
  try {
    const list = JSON.parse(gh.out || '[]');
    merged = gh.ok && list.length > 0;
    mergedPr = list[0]?.url ?? null;
  } catch {}
  if (entry.kind === 'milestone') {
    if (merged) record(st, 'milestone_workflow_completed', { runId: entry.runId });
    else
      record(st, 'milestone_workflow_completed_no_merge', {
        runId: entry.runId,
        note: 'verify planning PR',
      });
    return true; // done either way; next tick re-reads git state
  }
  if (!merged) {
    // Workflow reported success without a merged PR — treat as recoverable anomaly.
    entry.note = 'completed-without-merge';
    record(st, 'anomaly_completed_without_merge', entry);
    attemptResume(st, entry, 'workflow completed but PR not merged');
    return false;
  }
  refreshMain();
  const ms = loadCurrentMilestone(REPO);
  setPackageStatus(ms, entry.packageId, 'PROVEN');
  record(st, 'package_proven', { packageId: entry.packageId, pr: mergedPr });
  return true;
}

// ── pause states (tracked, recoverable) ─────────────────────────────────────
/**
 * Enter the operator-gated fatal pause. The tracked entry is RETAINED in
 * activeRuns/milestoneRuns (marked paused='fatal') so the durable identity
 * needed to resume the same logical package — runId, packageId, workflow,
 * branch, message — survives recovery exhaustion. tick() skips paused entries;
 * only the supported `--recover-fatal` command clears this state.
 */
function enterFatalPause(st, entry, reason) {
  st.pausedFatal = {
    reason,
    runId: entry.runId ?? null,
    kind: entry.kind ?? null,
    packageId: entry.packageId ?? null,
    workflow: entry.workflow ?? null,
    branch: entry.branch ?? null,
    message: entry.message ?? null,
    since: now(),
  };
  entry.paused = 'fatal';
  entry.lastPauseReason = String(reason).slice(0, 300);
  record(st, 'paused_fatal', { reason });
}

/**
 * Enter the durable quota pause for QUOTA_DAILY failures: no ordinary transient
 * resumes are consumed. The next automatic probe is the provider's reset time
 * when one is supplied (clamped to [30 min, 48 h]), otherwise a conservative
 * bounded backoff (6 h base, doubled per failed probe, capped at 24 h).
 */
function enterQuotaPause(st, entry, reason) {
  const probesSoFar = entry.quotaProbes ?? 0;
  const fallbackAt = now() + Math.min(QUOTA_PROBE_MAX_MS, QUOTA_PROBE_BASE_MS * 2 ** probesSoFar);
  const provided = extractQuotaResetAt(String(reason ?? ''));
  let probeAt = fallbackAt;
  let source = 'bounded-backoff';
  if (provided != null) {
    probeAt = Math.max(now() + QUOTA_RESET_MIN_MS, Math.min(provided, now() + QUOTA_RESET_MAX_MS));
    source = 'provider-reset-at';
  }
  entry.paused = 'quota';
  entry.lastPauseReason = String(reason).slice(0, 300);
  entry.quotaNextProbeAt = probeAt;
  record(st, 'quota_pause_scheduled', {
    runId: entry.runId,
    packageId: entry.packageId ?? null,
    probeInMinutes: Math.round((probeAt - now()) / 60_000),
    probe: probesSoFar,
    source,
    note: 'ordinary transient retry budget preserved',
  });
}

function escalatePausedQuota(st, entry, why) {
  enterFatalPause(
    st,
    entry,
    `run ${entry.runId} (${entry.packageId ?? entry.kind ?? 'milestone'}) ${why}: ${entry.lastPauseReason ?? ''}`,
  );
}

/**
 * Recovery-policy application for a failed run. Returns nothing meaningful —
 * paused entries stay tracked (never `done`), so the caller must not filter
 * them out; tick() routes paused entries to actOnPausedEntry.
 */
function attemptResume(st, entry, reason) {
  const cls = entry.failureClass ?? 'UNKNOWN';
  if (cls === 'FATAL') {
    enterFatalPause(st, entry, reason);
    return;
  }
  if (cls === 'QUOTA_DAILY') {
    // A daily quota wall is not a burst throttle: never spend the ordinary
    // transient budget on it (that burned 3 resumes in ~1h against a once-a-day
    // limit and stranded the package). Durable pause with supervisor-owned probes.
    const probeInFlight =
      entry.quotaProbeStartedAt && now() - entry.quotaProbeStartedAt < 15 * 60_000;
    if (!probeInFlight) enterQuotaPause(st, entry, reason);
    return;
  }
  const limitReached =
    cls === 'TRANSIENT'
      ? entry.resumeCount >= RESUME_LIMIT
      : entry.resumeCount >= 1 && entry.restartCount >= FRESH_RESTARTS_LIMIT;
  if (cls !== 'TRANSIENT' && entry.resumeCount < 1) {
    entry.resumeCount += 1;
    entry.nextAttemptAt = now() + backoffMs(entry.resumeCount);
    record(st, 'resume_scheduled', { runId: entry.runId, reason, attempt: entry.resumeCount });
    return;
  }
  if (!limitReached) {
    if (cls === 'TRANSIENT') {
      entry.resumeCount += 1;
      entry.nextAttemptAt = now() + backoffMs(entry.resumeCount);
      record(st, 'resume_scheduled', { runId: entry.runId, reason, attempt: entry.resumeCount });
      return;
    }
    // UNKNOWN past first resume → one fresh restart on the SAME branch/worktree.
    entry.restartCount += 1;
    record(st, 'fresh_restart_scheduled', { runId: entry.runId, reason });
    entry.abandonedBeforeRestart = true;
    entry.nextAttemptAt = now() + backoffMs(2);
    return;
  }
  enterFatalPause(
    st,
    entry,
    `run ${entry.runId} (${entry.packageId ?? 'milestone'}) exhausted recovery policy: ${reason}`,
  );
}

function actOnEntry(st, entry) {
  const get = archonJson(`workflow get ${entry.runId} --json`);
  const status = get?.status ?? get?.run?.status;
  if (get?._unparsed !== undefined || !status) {
    record(st, 'run_status_unreadable', {
      runId: entry.runId,
      raw: String(get?._stderr ?? '').slice(0, 200),
    });
    return false;
  }
  entry.lastSeenStatus = status;
  entry.lastSeenAt = now();
  if (status === 'completed') return finalizeCompletedRun(st, entry);
  if (status === 'running' || status === 'pending') {
    // Prefer Archon's own last-activity fields (snake_case in the real CLI),
    // normalized. A present-but-unparsable timestamp is "no opinion": record a
    // one-time diagnostic and keep waiting — never abandon a possibly-healthy
    // run because its timestamps are bad. Only ABSENT remote fields fall back
    // to supervisor-local bookkeeping.
    const rawRemote = get?.last_activity_at ?? get?.started_at;
    let lastActivity;
    if (rawRemote === undefined || rawRemote === null || rawRemote === '') {
      lastActivity = normalizeTimestampMs(entry.startedAt);
    } else {
      lastActivity = normalizeTimestampMs(rawRemote);
      if (lastActivity === null) {
        if (!entry.activityTsUnparsable) {
          entry.activityTsUnparsable = true;
          record(st, 'run_activity_timestamp_unparsable', {
            runId: entry.runId,
            raw: String(rawRemote).slice(0, 60),
          });
        }
        return false;
      }
    }
    if (lastActivity === null) return false; // no opinion either way — keep waiting
    entry.activityTsUnparsable = false;
    const activityMs = now() - lastActivity;
    if (Number.isNaN(activityMs) || activityMs > STALE_RUN_MS) {
      // Orphaned: preserve worktree/git state; use supported lifecycle ops only.
      archonJson(`workflow abandon ${entry.runId} --json`);
      entry.failureClass = 'UNKNOWN';
      entry.runId = null; // force fresh launch below on the same branch
      entry.restartCount += 1;
      record(st, 'stale_run_abandoned_restart_scheduled', {
        branch: entry.branch,
        idleMinutes: Math.round(activityMs / 60000),
      });
      return false;
    }
    return false; // healthy — keep waiting
  }
  if (status === 'cancelled') {
    // A cancel node fired (expected precondition failure, e.g. state moved on).
    // Cancelled runs are not resumable; release the package back to PENDING so
    // the next tick re-selects it against fresh state.
    if (entry.kind === 'package') {
      try {
        const ms = loadCurrentMilestone(REPO);
        if (ms && findPackage(ms, entry.packageId)?.status === 'RUNNING')
          setPackageStatus(ms, entry.packageId, 'PENDING');
      } catch (err) {
        record(st, 'requeue_status_flip_failed', {
          packageId: entry.packageId,
          error: String(err?.message ?? err).slice(0, 200),
        });
      }
    }
    record(st, 'run_cancelled_requeued', { runId: entry.runId, branch: entry.branch });
    return true;
  }
  if (status === 'failed' || status === 'paused') {
    const errText =
      `${get?.error ?? ''} ${get?.lastError ?? ''} ${get?.metadata?.error ?? ''}`.trim();
    if (errText) entry.failureClass = classifyFailure(errText);
    else entry.failureClass = entry.failureClass ?? 'UNKNOWN';
    attemptResume(st, entry, `${status}: ${errText.slice(0, 200)}`);
    // Paused entries stay tracked (never `done`): recovery identity survives.
    return false;
  }
  return false;
}

/**
 * Supervised handling of a paused tracked entry. Fatal pauses are strictly
 * operator-gated (`--recover-fatal`); quota pauses own a bounded probe schedule
 * of widely spaced `workflow resume` calls — never busy-looping a daily wall.
 */
function actOnPausedEntry(st, entry) {
  if (entry.paused === 'fatal') return; // only --recover-fatal may act
  if (entry.paused !== 'quota') return;
  if (!entry.quotaNextProbeAt || now() < entry.quotaNextProbeAt) return;
  if ((entry.quotaProbes ?? 0) >= QUOTA_PROBE_LIMIT) {
    escalatePausedQuota(st, entry, `daily-quota probe budget (${QUOTA_PROBE_LIMIT}) exhausted`);
    return;
  }
  const resumeStartTs = now();
  const res = archonJson(`workflow resume ${entry.runId} --json`);
  if (res?.ok === false) {
    escalatePausedQuota(st, entry, `quota-probe resume refused: ${res?.error ?? 'unknown'}`);
    return;
  }
  entry.quotaProbes = (entry.quotaProbes ?? 0) + 1;
  if (!resumeTookEffect(entry.runId, resumeStartTs)) {
    // Acked ok but the run row never changed: trusting it would silently burn
    // the whole probe budget against a dead run. Escalate to the operator,
    // whose --recover-fatal verifies and falls back to one fresh continuation.
    record(st, 'quota_probe_resume_noop', { runId: entry.runId, probe: entry.quotaProbes });
    escalatePausedQuota(
      st,
      entry,
      'quota-probe resume acknowledged ok but did not restart the run (run row unchanged)',
    );
    return;
  }
  entry.quotaProbeStartedAt = now();
  entry.paused = null;
  delete entry.quotaNextProbeAt;
  record(st, 'quota_probe_resumed', { runId: entry.runId, probe: entry.quotaProbes });
}

async function actOnPendingAction(st, entry) {
  if (!entry.nextAttemptAt || now() < entry.nextAttemptAt) return;
  entry.nextAttemptAt = null;
  if (entry.awaitingDiscovery) {
    // Detach ack carried no run id: keep polling the runs table instead of
    // launching anything new (a blind relaunch here would double-run).
    const id = discoverRunId(entry.workflow, entry.message);
    if (id) {
      entry.awaitingDiscovery = false;
      entry.runId = id;
      if (entry.kind === 'package') {
        // Durable Archon association established — only NOW may the package
        // move PENDING→RUNNING. Until this point the package was never RUNNING.
        try {
          const ms = loadCurrentMilestone(REPO);
          if (ms && findPackage(ms, entry.packageId)?.status === 'PENDING')
            setPackageStatus(ms, entry.packageId, 'RUNNING');
        } catch (err) {
          record(st, 'discovery_status_flip_failed', {
            packageId: entry.packageId,
            error: String(err?.message ?? err).slice(0, 200),
          });
        }
      }
      record(st, 'run_id_discovered', { runId: id });
    } else if (++entry.discoveryAttempts > DISCOVERY_LIMIT) {
      // Discovery exhausted: the workflow may or may not be running, but it is
      // untrackable. Fail closed — pause for an operator instead of risking
      // duplicate launches against an invisible run. Package status stays
      // PENDING (RUNNING is only ever set once a durable run id exists).
      entry.awaitingDiscovery = false;
      entry.done = true;
      record(st, 'launch_unconfirmed_giving_up', { branch: entry.branch });
      st.pausedFatal = {
        reason: `detached launch for ${entry.branch} could not be associated with a durable Archon run id after ${DISCOVERY_LIMIT} discovery attempts; verify 'archon workflow runs' then recover with --recover-fatal (or --clear-fatal, which is refused while a RUNNING package would be orphaned)`,
        runId: null,
        kind: entry.kind ?? null,
        packageId: entry.packageId ?? null,
        workflow: entry.workflow ?? null,
        branch: entry.branch ?? null,
        message: entry.message ?? null,
        since: now(),
      };
      record(st, 'paused_fatal', { reason: st.pausedFatal.reason });
    } else {
      entry.nextAttemptAt = now() + DISCOVERY_RETRY_MS;
    }
    return;
  }
  if (entry.runId === null || entry.abandonedBeforeRestart) {
    // Fresh restart against the SAME branch so existing work persists.
    entry.abandonedBeforeRestart = false;
    const ack = launchDetached(entry.workflow, entry.branch, entry.message);
    record(st, 'fresh_restart_launched', { branch: entry.branch, ack: sanitizeAck(ack) });
    const newId = resolveRunId(ack, entry.workflow, entry.message);
    Object.assign(entry, { runId: newId, awaitingDiscovery: !newId, discoveryAttempts: 0 });
    if (newId) entry.startedAt = now();
    return;
  }
  // Normal resume: reuse recorded working path/worktree, skip completed nodes.
  const res = archonJson(`workflow resume ${entry.runId} --json`);
  if (res?.ok === false) {
    record(st, 'resume_refused', { runId: entry.runId, response: sanitizeAck(res) });
    entry.failureClass = 'UNKNOWN';
    attemptResume(st, entry, `resume refused: ${res?.error ?? 'unknown'}`);
  } else {
    record(st, 'resumed', { runId: entry.runId });
  }
}

function extractRunId(ack) {
  return ack?.runId ?? ack?.run_id ?? ack?.id ?? ack?.run?.id ?? null;
}

// `archon workflow run --detach` acknowledges with a conversationId but no run
// id; the durable record is the runs table, queryable via structured JSON.
// The launch message doubles as the correlation key (package id / fixed
// milestone message), so pick the newest matching run.
function discoverRunId(workflow, message) {
  const list = archonJson('workflow runs --json --limit 20');
  const runs = Array.isArray(list) ? list : (list?.runs ?? []);
  const tsOf = (r) => normalizeTimestampMs(r.started_at) ?? 0;
  const cutoff = now() - 24 * 60 * 60_000;
  const match = runs
    .filter((r) => r.workflow_name === workflow && r.user_message === message && tsOf(r) >= cutoff)
    .sort((a, b) => tsOf(b) - tsOf(a))[0];
  return match?.id ?? null;
}

/** Newest runs-table row for a workflow+message within the adoption window, or null. */
function findRecentRunRow(workflow, message) {
  const list = archonJson('workflow runs --json --limit 20');
  const runs = Array.isArray(list) ? list : (list?.runs ?? []);
  const tsOf = (r) => normalizeTimestampMs(r.started_at) ?? 0;
  return (
    runs
      .filter(
        (r) =>
          r.workflow_name === workflow &&
          r.user_message === message &&
          tsOf(r) >= now() - STRANDED_LOOKUP_CUTOFF_MS,
      )
      .sort((a, b) => tsOf(b) - tsOf(a))[0] ?? null
  );
}

/**
 * Invariant guard: a package with status RUNNING must always be authoritatively
 * tracked by the supervisor. Anything that ever leaves `RUNNING` with no tracked
 * active run is repaired here, deterministically:
 *   - a live Archon run for the same workflow+message is re-adopted (restores
 *     tracking after state loss without any duplicate launch);
 *   - otherwise the package enters a TRACKED fatal pause carrying full recovery
 *     identity (--recover-fatal resumes it later).
 * The supervisor must never settle into `package=RUNNING ∧ activeRuns=[] ∧
 * pausedFatal=null` — no such stranded state survives a tick.
 */
function reconcileStrandedPackages(st) {
  if (st.pausedFatal) return;
  let ms;
  try {
    ms = loadCurrentMilestone(REPO);
    if (!ms || validateMilestoneState(ms).length > 0) return; // corrupt-state path pauses elsewhere
  } catch {
    return;
  }
  for (const p of ms.packages) {
    if (p.status !== 'RUNNING') continue;
    if (st.activeRuns.some((r) => r.packageId === p.id && !r.done)) continue; // tracked (live run or paused-with-identity) — invariant holds
    const branch = `foresift/${p.id}`;
    const row = findRecentRunRow('foresift-work-package', p.id);
    if (row && ['running', 'pending'].includes(String(row.status))) {
      st.activeRuns.push({
        kind: 'package',
        workflow: row.workflow_name,
        runId: row.id,
        packageId: p.id,
        branch,
        message: p.id,
        startedAt: normalizeTimestampMs(row.started_at) ?? now(),
        resumeCount: 0,
        restartCount: 0,
        awaitingDiscovery: false,
        discoveryAttempts: 0,
      });
      record(st, 'stranded_run_adopted', { packageId: p.id, runId: row.id, status: row.status });
      continue;
    }
    const entry = {
      kind: 'package',
      workflow: 'foresift-work-package',
      runId: row?.id ?? null,
      packageId: p.id,
      branch,
      message: p.id,
      startedAt: now(),
      resumeCount: 0,
      restartCount: 0,
    };
    st.activeRuns.push(entry);
    enterFatalPause(
      st,
      entry,
      `package ${p.id} was RUNNING with no supervisor-tracked active run${row ? ` (Archon run ${row.id} is ${row.status})` : ''}; converted to a tracked fatal pause — recover with --recover-fatal`,
    );
  }
}

/** Resolve a run id from a detach ack, falling back to runs-table discovery. */
function resolveRunId(ack, workflow, message) {
  return extractRunId(ack) ?? discoverRunId(workflow, message);
}

function sanitizeAck(a) {
  return JSON.parse(
    JSON.stringify(a ?? {}, (_, v) => (typeof v === 'string' ? v.slice(0, 160) : v)),
  );
}

// ── selection ────────────────────────────────────────────────────────────────
function pauseFatalCorrupt(st, what, errors) {
  st.pausedFatal = {
    reason: `corrupt implementation state in ${what} — fail closed, operator must inspect and repair; use --clear-fatal after fixing`,
    detail: String(errors).slice(0, 400),
    since: now(),
  };
  record(st, 'paused_fatal_corrupt_state', { what, errors });
}

function selectAndLaunch(st) {
  // Corrupt roadmap/milestone JSON must fail closed (PAUSED_FATAL), never
  // crash-loop the tick or silently re-plan over damaged state.
  let roadmap;
  let ms;
  try {
    roadmap = loadRoadmap(REPO);
    ms = loadCurrentMilestone(REPO);
  } catch (err) {
    pauseFatalCorrupt(st, 'specs/implementation/*.json', err?.message ?? err);
    return false;
  }
  const rmErrs = validateRoadmap(roadmap);
  if (rmErrs.length) {
    pauseFatalCorrupt(st, 'specs/implementation/roadmap.json', rmErrs.join('; '));
    return false;
  }

  // Milestone-control due? (nothing planned, or planned milestone fully proven)
  let msErrs = ms ? validateMilestoneState(ms) : ['missing'];
  if (ms && msErrs.length > 0) {
    // CORRUPT STATE FAILS CLOSED: current-milestone.json exists but does not
    // validate. Never silently re-plan over possibly-corrupt implementation
    // state.
    pauseFatalCorrupt(st, 'specs/implementation/current-milestone.json', msErrs.join('; '));
    return false;
  }
  const milestoneDue = !ms || ms.packages.every((p) => p.status === 'PROVEN');
  if (milestoneDue) {
    if (st.milestoneRuns.length > 0 || st.pausedFatal) return false;
    const message = 'plan-or-audit-current-milestone';
    const ack = launchDetached(
      'foresift-milestone-control',
      'foresift/milestone-planning',
      message,
    );
    const runId = resolveRunId(ack, 'foresift-milestone-control', message);
    record(st, 'milestone_control_launched', {
      ack: sanitizeAck(ack),
      runId,
      discovery: extractRunId(ack) ? 'ack' : 'runs-table',
    });
    // ALWAYS track the launch — including when the detach ack carried no run
    // id. An untracked launch would be re-launched next tick (duplicate
    // milestone workflows). The awaitingDiscovery machinery reconciles it.
    trackRun(st, 'milestone', {
      kind: 'milestone',
      workflow: 'foresift-milestone-control',
      runId,
      branch: 'foresift/milestone-planning',
      message,
      startedAt: now(),
      resumeCount: 0,
      restartCount: 0,
      awaitingDiscovery: !runId,
      discoveryAttempts: 0,
    });
    return true;
  }

  // Work-package selection under the concurrency policy.
  const running = st.activeRuns.map((r) => findPackage(ms, r.packageId)).filter(Boolean);
  const ordered = [...ms.packages].sort(
    (a, b) => (a.dependencies?.length ?? 0) - (b.dependencies?.length ?? 0),
  );
  for (const cand of ordered) {
    // Never re-select a package that already has a tracked active launch
    // (covers the window where its run id is still being discovered and its
    // status is therefore still PENDING).
    if (st.activeRuns.some((r) => r.packageId === cand.id && !r.done)) continue;
    const elig = packageEligible(ms, cand);
    if (!elig.eligible) continue;
    const verdict = canStartPackage(roadmap, ms, cand, running);
    if (!verdict.ok) continue;
    const branch = `foresift/${cand.id}`;
    const ack = launchDetached('foresift-work-package', branch, cand.id);
    const runId = resolveRunId(ack, 'foresift-work-package', cand.id);
    record(st, 'work_package_launched', {
      packageId: cand.id,
      branch,
      ack: sanitizeAck(ack),
      runId,
      discovery: extractRunId(ack) ? 'ack' : 'runs-table',
    });
    trackRun(st, 'package', {
      kind: 'package',
      workflow: 'foresift-work-package',
      runId,
      packageId: cand.id,
      branch,
      message: cand.id,
      startedAt: now(),
      resumeCount: 0,
      restartCount: 0,
      awaitingDiscovery: !runId,
      discoveryAttempts: 0,
    });
    if (runId) {
      // Durable run id already in hand → RUNNING now; otherwise it is flipped
      // by actOnPendingAction at discovery time. PENDING→RUNNING never happens
      // without a durable Archon run association.
      setPackageStatus(ms, cand.id, 'RUNNING');
    }
    running.push(cand);
  }
  return true;
}

// ── status ───────────────────────────────────────────────────────────────────
/**
 * Best-effort live observability for a run, read from Archon's structured
 * JSONL event log (~/.archon/workspaces/<owner>/<repo>/logs/<runId>.jsonl):
 * the currently open DAG node, its loop-iteration count (node_start events),
 * and the last event timestamp. Must NEVER throw — observability is advisory.
 */
export function runObservability(runId) {
  if (!runId || typeof runId !== 'string') return null;
  try {
    const wsRoot = join(process.env.HOME ?? homedir(), '.archon', 'workspaces');
    if (!existsSync(wsRoot)) return null;
    let file = null;
    search: for (const owner of readdirSync(wsRoot)) {
      let repos = [];
      try {
        repos = readdirSync(join(wsRoot, owner));
      } catch {
        continue;
      }
      for (const repo of repos) {
        const candidate = join(wsRoot, owner, repo, 'logs', `${runId}.jsonl`);
        if (existsSync(candidate)) {
          file = candidate;
          break search;
        }
      }
    }
    if (!file) return null;
    const startsByNode = new Map();
    const openNodes = [];
    let lastEventMs = null;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      lastEventMs = normalizeTimestampMs(e.ts) ?? lastEventMs;
      const step = typeof e.step === 'string' ? e.step : null;
      if (!step) continue;
      if (e.type === 'node_start') {
        startsByNode.set(step, (startsByNode.get(step) ?? 0) + 1);
        if (!openNodes.includes(step)) openNodes.push(step);
      } else if (
        e.type === 'node_complete' ||
        e.type === 'node_error' ||
        e.type === 'node_skipped'
      ) {
        const i = openNodes.indexOf(step);
        if (i >= 0) openNodes.splice(i, 1);
      }
    }
    const current = openNodes[openNodes.length - 1] ?? null;
    return {
      currentNode: current,
      iteration: current ? (startsByNode.get(current) ?? null) : null,
      nodeStarts: Object.fromEntries(startsByNode),
      lastEventAt: lastEventMs,
    };
  } catch {
    return null;
  }
}

function describeRun(entry) {
  const parts = [
    `run ${entry.runId ?? '(awaiting discovery)'}`,
    `status=${entry.lastSeenStatus ?? '?'}`,
  ];
  if (entry.awaitingDiscovery) parts.push('discovering-run-id');
  else if (!entry.runId && !entry.done && !entry.paused) parts.push('restart-scheduled');
  if (entry.paused === 'fatal') parts.push('paused=fatal(operator-recovery)');
  if (entry.paused === 'quota') {
    const inMin = entry.quotaNextProbeAt
      ? Math.max(0, Math.round((entry.quotaNextProbeAt - now()) / 60_000))
      : null;
    parts.push(
      `paused=quota(probe ${entry.quotaProbes ?? 0}/${QUOTA_PROBE_LIMIT}${inMin != null ? `, next in ${inMin}m` : ''})`,
    );
  }
  const obs = runObservability(entry.runId);
  if (obs?.currentNode) {
    parts.push(`node=${obs.currentNode}`);
    if (obs.iteration != null) parts.push(`iter=${obs.iteration}`);
  }
  parts.push(`resumes=${entry.resumeCount ?? 0}`, `restarts=${entry.restartCount ?? 0}`);
  const activityMs =
    entry.lastSeenStatus === 'running'
      ? now() - (normalizeTimestampMs(obs?.lastEventAt) ?? entry.lastSeenAt ?? entry.startedAt)
      : null;
  if (activityMs != null && Number.isFinite(activityMs))
    parts.push(`idle=${Math.max(0, Math.round(activityMs / 60000))}m`);
  return parts.join(' · ');
}

function nextEligiblePackage(roadmap, ms) {
  if (!ms) return null;
  const running = [];
  const ordered = [...ms.packages].sort(
    (a, b) => (a.dependencies?.length ?? 0) - (b.dependencies?.length ?? 0),
  );
  for (const cand of ordered) {
    const elig = packageEligible(ms, cand);
    if (!elig.eligible) continue;
    const verdict = canStartPackage(roadmap, ms, cand, running);
    if (!verdict.ok) continue;
    return { id: cand.id, blockedBy: null };
  }
  // Nothing startable right now: name the first blocker for the operator.
  const notProven = ordered.find(
    (cand) =>
      cand.status !== 'PROVEN' &&
      (cand.dependencies ?? []).some((d) => findPackage(ms, d)?.status !== 'PROVEN'),
  );
  return {
    id: null,
    blockedBy: notProven
      ? `${notProven.id} (deps unproven)`
      : 'concurrency policy or gate in progress',
  };
}

export function buildStatus() {
  let roadmap = null;
  let ms = null;
  let corrupt = null;
  try {
    roadmap = loadRoadmap(REPO);
    ms = loadCurrentMilestone(REPO);
  } catch (err) {
    corrupt = String(err?.message ?? err).slice(0, 300);
  }
  const rmErrs = roadmap ? validateRoadmap(roadmap) : ['unreadable'];
  const msErrs = ms ? validateMilestoneState(ms) : [];
  const st = loadState();
  const lines = [];
  lines.push(`FORESIFT AUTOPILOT STATUS — ${new Date().toISOString()}`);
  if (st.pausedFatal)
    lines.push(
      `⛔ PAUSED_FATAL: ${st.pausedFatal.reason}`,
      `   recover with: node scripts/automation/foresift-autopilot.mjs --recover-fatal (stop the service unit first)`,
    );
  const quotaPaused = [...(st.activeRuns ?? []), ...(st.milestoneRuns ?? [])].find(
    (e) => !e.done && e.paused === 'quota',
  );
  if (quotaPaused && !st.pausedFatal)
    lines.push(
      `⏸ QUOTA BACKOFF: ${quotaPaused.packageId ?? quotaPaused.kind ?? 'run'} paused on provider daily quota — next automatic probe in ${Math.max(0, Math.round(((quotaPaused.quotaNextProbeAt ?? now()) - now()) / 60_000))}m (probe ${quotaPaused.quotaProbes ?? 0}/${QUOTA_PROBE_LIMIT}); transient retry budget untouched`,
    );
  if (corrupt || rmErrs.length > 0 || msErrs.length > 0)
    lines.push(
      `⚠ implementation state INVALID${corrupt ? ` (${corrupt})` : ''}${rmErrs.length ? ` · roadmap: ${rmErrs.join('; ')}` : ''}${msErrs.length ? ` · milestone: ${msErrs.join('; ')}` : ''}`,
    );
  if (roadmap)
    lines.push(
      `roadmap: ${roadmap.milestones.filter((m) => m.status === 'PROVEN').length}/${roadmap.milestones.length} milestones proven`,
    );
  if (!ms) {
    lines.push(
      'current milestone: none planned yet (foresift-milestone-control will plan the first)',
    );
  } else {
    lines.push(
      `current milestone: ${ms.milestoneId} — ${ms.packages.filter((p) => p.status === 'PROVEN').length}/${ms.packages.length} packages proven`,
    );
    for (const p of ms.packages) {
      const run = st.activeRuns.find((r) => r.packageId === p.id && !r.done);
      const runInfo = run ? `\n      ↳ ${describeRun(run)}` : '';
      lines.push(
        `  • ${p.id.padEnd(28)} ${p.status.padEnd(9)} risk=${p.risk.padEnd(8)} deps=[${(p.dependencies ?? []).join(',')}]${runInfo}`,
      );
    }
    if (!st.pausedFatal && roadmap && !corrupt && rmErrs.length === 0) {
      try {
        const next = nextEligiblePackage(roadmap, ms);
        lines.push(
          next?.id
            ? `next eligible package: ${next.id}`
            : `no package currently eligible (${next?.blockedBy ?? 'unknown'})`,
        );
      } catch {
        /* advisory only */
      }
    }
  }
  for (const m of st.milestoneRuns ?? []) lines.push(`milestone-control: ${describeRun(m)}`);
  lines.push(`runtime state: ${STATE_FILE}`);
  return lines.join('\n');
}

// ── main loop ────────────────────────────────────────────────────────────────
async function tick(st) {
  refreshMain();
  // Reconcile active entries. Paused entries stay tracked (never filtered as
  // done): fatal pauses wait for operator recovery, quota pauses probe on the
  // supervisor-owned schedule.
  for (const entry of [...st.activeRuns, ...st.milestoneRuns]) {
    if (entry.done) continue;
    if (entry.paused) {
      actOnPausedEntry(st, entry);
      continue;
    }
    if (entry.nextAttemptAt) {
      await actOnPendingAction(st, entry);
      continue;
    }
    if (!entry.runId) {
      entry.nextAttemptAt = now(); // relaunch path
      await actOnPendingAction(st, entry);
      continue;
    }
    const done = actOnEntry(st, entry);
    if (done) entry.done = true;
  }
  st.activeRuns = st.activeRuns.filter((e) => !e.done);
  st.milestoneRuns = st.milestoneRuns.filter((e) => !e.done);

  if (!st.pausedFatal) {
    // Restore authoritative tracking BEFORE any new selection: an untracked
    // RUNNING package must count against the concurrency policy this very tick
    // (adopt its live run, or convert it to a tracked pause), never race a
    // second launch past the limit.
    reconcileStrandedPackages(st);
    if (!st.pausedFatal) selectAndLaunch(st);
  }
  saveState(st);
}

// ── supported operator recovery ──────────────────────────────────────────────
/** RUNNING packages with no non-paused tracked run — clearing fatal would strand these. */
function orphanedRunningPackages(st) {
  try {
    const ms = loadCurrentMilestone(REPO);
    if (!ms || validateMilestoneState(ms).length > 0) return []; // corrupt-state pauses clear after repair
    return ms.packages.filter(
      (p) =>
        p.status === 'RUNNING' &&
        !st.activeRuns.some((r) => r.packageId === p.id && !r.done && !r.paused),
    );
  } catch {
    return [];
  }
}

/**
 * Supported recovery of a PAUSED_FATAL pause. Deterministic reconciliation of
 * pausedFatal, tracked run bookkeeping, package state, and Archon run identity:
 * resumes the SAME Archon run when its lifecycle allows (failed/paused), or —
 * only then — launches exactly ONE fresh continuation on the SAME branch/
 * worktree, restoring authoritative activeRuns tracking either way. All reads
 * and verifications precede any mutation; any inconsistency exits nonzero with
 * state untouched. The operator never hand-edits JSON.
 */
async function cmdRecoverFatal(positionalRunId) {
  const st = loadState();
  let pf = st.pausedFatal;
  if (!pf) {
    // Early-recovery form: a TRACKED pause without a global pausedFatal (e.g.
    // resuming a daily-quota backoff ahead of schedule) reconciles through the
    // exact same verified flow.
    const pausedEntry = [...st.activeRuns, ...st.milestoneRuns].find((e) => !e.done && e.paused);
    if (pausedEntry)
      pf = {
        reason: pausedEntry.lastPauseReason ?? `tracked ${pausedEntry.paused} pause`,
        runId: pausedEntry.runId ?? null,
        kind: pausedEntry.kind ?? null,
        packageId: pausedEntry.packageId ?? null,
        workflow: pausedEntry.workflow ?? null,
        branch: pausedEntry.branch ?? null,
        message: pausedEntry.message ?? null,
        since: null,
      };
  }
  if (!pf) {
    log('no PAUSED_FATAL or paused tracked entry present — nothing to recover');
    return 0;
  }
  const fail = (msg) => {
    console.error(`RECOVERY REFUSED: ${msg}`);
    log('operator_recovery_refused', { why: msg });
    return 1;
  };
  let runId = positionalRunId ?? pf.runId ?? null;
  let row = null;
  if (runId) {
    const get = archonJson(`workflow get ${runId} --json`);
    const gotId = get?.id ?? get?.runId ?? null;
    if (get?._unparsed !== undefined || !gotId)
      return fail(
        `run ${runId} is not readable via 'archon workflow get' — verify the id with 'archon workflow runs'`,
      );
    row = { ...get, id: gotId, status: get?.status ?? get?.run?.status };
    runId = gotId;
  }
  const workflow = row?.workflow_name ?? pf.workflow ?? null;
  const message = row?.user_message ?? pf.message ?? null;
  if (!workflow || !message)
    return fail(
      'paused state carries neither a readable Archon run nor structured workflow/message identity; repair the underlying cause first',
    );
  const kind = workflow === 'foresift-milestone-control' ? 'milestone' : 'package';
  let ms = null;
  let pkg = null;
  let branch = pf.branch ?? null;
  if (kind === 'package') {
    try {
      ms = loadCurrentMilestone(REPO);
    } catch (err) {
      return fail(`implementation state unreadable: ${String(err?.message ?? err).slice(0, 200)}`);
    }
    pkg = findPackage(ms, message);
    if (!pkg) return fail(`no work package '${message}' in the current milestone`);
    branch = `foresift/${pkg.id}`;
    if (pf.branch && pf.branch !== branch)
      return fail(`identity mismatch: paused branch ${pf.branch} ≠ expected ${branch}`);
    if (!['RUNNING', 'PENDING'].includes(pkg.status))
      return fail(
        `package ${pkg.id} status is ${pkg.status} (not RUNNING/PENDING) — inspect implementation state manually`,
      );
  } else if (!branch) {
    branch = 'foresift/milestone-planning';
  }
  // No duplicate product run may exist for this logical package.
  const list = archonJson('workflow runs --json --limit 20');
  const rows = Array.isArray(list) ? list : (list?.runs ?? []);
  const others = rows.filter(
    (r) =>
      r.workflow_name === workflow &&
      r.user_message === message &&
      String(r.status) === 'running' &&
      r.id !== runId,
  );
  if (others.length > 0)
    return fail(
      `another running workflow (${others[0].id}) already exists for ${message} — resolve it first to avoid duplicates`,
    );
  // Exactly one continuation: resume the same run when possible.
  let resumed = false;
  if (row && ['running', 'pending'].includes(String(row.status))) {
    resumed = true; // alive — re-adopt under supervisor tracking
  } else if (runId && ['failed', 'paused', 'cancelled'].includes(String(row?.status))) {
    const resumeStartTs = now();
    const res = archonJson(`workflow resume ${runId} --json`);
    if (res?.ok === false) {
      record(st, 'operator_recovery_resume_refused', {
        runId,
        response: sanitizeAck(res),
      });
    } else if (!resumeTookEffect(runId, resumeStartTs)) {
      // Acknowledged ok but the run row never moved: Archon accepted the
      // command without restarting anything (observed live on run b0a82481 —
      // ack ok, no worker process, last_activity frozen hours earlier).
      // Trusting the ack would strand recovery again — treat as a refusal.
      record(st, 'operator_recovery_resume_noop', { runId });
    } else {
      resumed = true;
    }
  }
  if (!resumed) {
    // Late-wake guard: a slow-starting resumed run must win adoption over a
    // duplicate launch — never two product workflows for one package.
    const list3 = archonJson('workflow runs --json --limit 20');
    const rows3 = Array.isArray(list3) ? list3 : (list3?.runs ?? []);
    const wokeUp = rows3.find(
      (r) =>
        r.workflow_name === workflow &&
        r.user_message === message &&
        String(r.status) === 'running',
    );
    if (wokeUp) {
      resumed = true;
      runId = wokeUp.id;
      record(st, 'operator_recovery_adopt_late_resume', { runId: wokeUp.id });
    }
  }
  if (!resumed) {
    // Retire the dead run via the supported lifecycle op (same call the
    // stale-run policy uses) so it cannot wake behind the fresh continuation.
    // Best-effort: a refusal here cannot block recovery — the row was already
    // verified inert.
    if (runId) {
      const ab = archonJson(`workflow abandon ${runId} --json`);
      record(st, 'operator_recovery_retired_dead_run', { runId, response: sanitizeAck(ab) });
    }
    // ONE fresh continuation on the SAME branch/worktree; prior work persists on
    // disk/git and completed tasks are discovered from there by the workflow.
    const ack = launchDetached(workflow, branch, message);
    record(st, 'operator_recovery_fresh_launch', { branch, ack: sanitizeAck(ack) });
    runId = resolveRunId(ack, workflow, message);
  }
  // Restore authoritative tracking: reuse the retained paused entry if present.
  const list2 = kind === 'milestone' ? st.milestoneRuns : st.activeRuns;
  let entry = list2.find((e) => !e.done && ((runId && e.runId === runId) || e.message === message));
  if (!entry) {
    entry = {
      kind,
      workflow,
      packageId: pkg?.id ?? null,
      branch,
      message,
      startedAt: now(),
      resumeCount: 0,
      restartCount: 0,
    };
    list2.push(entry);
  }
  Object.assign(entry, {
    runId: runId ?? null,
    awaitingDiscovery: !runId,
    discoveryAttempts: entry.awaitingDiscovery ? (entry.discoveryAttempts ?? 0) : 0,
  });
  delete entry.done;
  delete entry.paused;
  delete entry.quotaNextProbeAt;
  delete entry.quotaProbes; // a recovered continuation earns a fresh probe budget
  delete entry.failureClass; // stale classification must not outlive recovery
  delete entry.lastPauseReason;
  delete entry.abandonedBeforeRestart;
  entry.nextAttemptAt = null;
  entry.operatorRecoveredAt = now();
  // Shield: straight after operator intervention, a lagging run row (or a
  // re-failure inside the grace window) must not be misread as a fresh daily
  // quota wall — the same in-flight window that protects automatic probes.
  entry.quotaProbeStartedAt = now();
  if (kind === 'package' && pkg.status === 'PENDING') setPackageStatus(ms, pkg.id, 'RUNNING');
  st.pausedFatal = null;
  record(st, 'operator_recovery_complete', {
    runId: runId ?? '(awaiting discovery)',
    packageId: pkg?.id ?? null,
    mode: resumed
      ? row && ['running', 'pending'].includes(String(row.status))
        ? 'adopt-live-run'
        : 'resume-same-run'
      : 'single-fresh-continuation',
  });
  saveState(st);
  // Drain the serialized implementation-state commit queue so a PENDING→RUNNING
  // flip lands in git before this one-shot exits.
  await new Promise((res) => {
    commitQueue = commitQueue.then(res, res);
  });
  log(
    `recovery complete: ${kind} ${message} tracked again${runId ? ` as run ${runId}` : ' (awaiting run-id discovery)'}; pause cleared`,
  );
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--status')) {
    console.log(buildStatus());
    return;
  }
  if (!acquireLock()) {
    console.error(
      'another autopilot instance holds the lock — stop the service unit before one-shot maintenance:',
      'systemctl --user stop foresift-autopilot.service',
    );
    process.exit(3);
  }
  if (argv.includes('--clear-fatal')) {
    const st = loadState();
    const orphans = orphanedRunningPackages(st);
    if (orphans.length > 0) {
      console.error(
        `REFUSED: clearing would orphan RUNNING package(s) without tracked runs: ${orphans.map((p) => p.id).join(', ')}.\n` +
          'Use the supported recovery instead: node scripts/automation/foresift-autopilot.mjs --recover-fatal',
      );
      process.exit(1);
    }
    st.pausedFatal = null;
    saveState(st);
    log('fatal pause cleared by operator (no RUNNING package orphaned)');
    return; // one-shot maintenance command; systemd restarts the loop separately
  }
  if (argv.includes('--recover-fatal')) {
    const positional = argv.filter((a) => !a.startsWith('--'));
    process.exit(await cmdRecoverFatal(positional[0] ?? null));
  }
  const once = argv.includes('--once');
  const st = loadState();
  record(st, 'supervisor_started', { pid: process.pid });
  do {
    try {
      await tick(st);
    } catch (err) {
      record(st, 'tick_error', { message: String(err?.message ?? err).slice(0, 300) });
      saveState(st);
    }
    if (!once) await sleep(POLL_INTERVAL_MS);
  } while (!once);
}

// CLI-entry guard: importing this module (tests, tooling) must never boot the
// supervisory loop — only direct `node foresift-autopilot.mjs` invocations do.
const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
