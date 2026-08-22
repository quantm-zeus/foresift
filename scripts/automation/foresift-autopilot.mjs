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
//   node scripts/automation/foresift-autopilot.mjs --clear-fatal

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
  findPackage,
  packageEligible,
  canStartPackage,
  classifyFailure,
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

const now = () => Date.now();
const log = (...m) => console.log(new Date().toISOString(), '[autopilot]', ...m);

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
    return attemptResume(st, entry, 'workflow completed but PR not merged');
  }
  refreshMain();
  const ms = loadCurrentMilestone(REPO);
  setPackageStatus(ms, entry.packageId, 'PROVEN');
  record(st, 'package_proven', { packageId: entry.packageId, pr: mergedPr });
  return true;
}

function attemptResume(st, entry, reason) {
  const cls = entry.failureClass ?? 'UNKNOWN';
  if (cls === 'FATAL') {
    st.pausedFatal = { reason, runId: entry.runId, since: now() };
    record(st, 'paused_fatal', { reason });
    return true; // stop touching this run
  }
  const limitReached =
    cls === 'TRANSIENT'
      ? entry.resumeCount >= RESUME_LIMIT
      : entry.resumeCount >= 1 && entry.restartCount >= FRESH_RESTARTS_LIMIT;
  if (cls !== 'TRANSIENT' && entry.resumeCount < 1) {
    entry.resumeCount += 1;
    entry.nextAttemptAt = now() + backoffMs(entry.resumeCount);
    record(st, 'resume_scheduled', { runId: entry.runId, reason, attempt: entry.resumeCount });
    return false;
  }
  if (!limitReached) {
    if (cls === 'TRANSIENT') {
      entry.resumeCount += 1;
      entry.nextAttemptAt = now() + backoffMs(entry.resumeCount);
      record(st, 'resume_scheduled', { runId: entry.runId, reason, attempt: entry.resumeCount });
      return false;
    }
    // UNKNOWN past first resume → one fresh restart on the SAME branch/worktree.
    entry.restartCount += 1;
    record(st, 'fresh_restart_scheduled', { runId: entry.runId, reason });
    entry.abandonedBeforeRestart = true;
    entry.nextAttemptAt = now() + backoffMs(2);
    return false;
  }
  st.pausedFatal = {
    reason: `run ${entry.runId} (${entry.packageId ?? 'milestone'}) exhausted recovery policy: ${reason}`,
    runId: entry.runId,
    since: now(),
  };
  record(st, 'paused_fatal', { reason: st.pausedFatal.reason });
  return true;
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
    const activityMs = now() - (get?.updatedAt ?? get?.startedAt ?? entry.startedAt);
    if (activityMs > STALE_RUN_MS) {
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
      const ms = loadCurrentMilestone(REPO);
      if (ms && findPackage(ms, entry.packageId)?.status === 'RUNNING')
        setPackageStatus(ms, entry.packageId, 'PENDING');
    }
    record(st, 'run_cancelled_requeued', { runId: entry.runId, branch: entry.branch });
    return true;
  }
  if (status === 'failed' || status === 'paused') {
    const errText =
      `${get?.error ?? ''} ${get?.lastError ?? ''} ${get?.metadata?.error ?? ''}`.trim();
    if (errText) entry.failureClass = classifyFailure(errText);
    else entry.failureClass = entry.failureClass ?? 'UNKNOWN';
    return attemptResume(st, entry, `${status}: ${errText.slice(0, 200)}`);
  }
  return false;
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
      record(st, 'run_id_discovered', { runId: id });
    } else if (++entry.discoveryAttempts > DISCOVERY_LIMIT) {
      entry.awaitingDiscovery = false;
      entry.done = true;
      record(st, 'launch_unconfirmed_giving_up', { branch: entry.branch });
      if (entry.kind === 'package') {
        const ms = loadCurrentMilestone(REPO);
        if (ms && findPackage(ms, entry.packageId)?.status === 'RUNNING')
          setPackageStatus(ms, entry.packageId, 'PENDING');
      }
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
  const parseTs = (v0) => {
    if (typeof v0 === 'number') return v0; // epoch ms
    let v = String(v0 ?? '')
      .trim()
      .replace(' ', 'T');
    if (!/([zZ]|[+-]\d\d:?\d\d)$/.test(v)) v += 'Z';
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  };
  const match = runs
    .filter(
      (r) =>
        r.workflow_name === workflow &&
        r.user_message === message &&
        parseTs(r.started_at) >= now() - 24 * 60 * 60_000,
    )
    .sort((a, b) => parseTs(b.started_at) - parseTs(a.started_at))[0];
  return match?.id ?? null;
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
function selectAndLaunch(st) {
  const roadmap = loadRoadmap(REPO);
  const rmErrs = validateRoadmap(roadmap);
  if (rmErrs.length) {
    record(st, 'invalid_roadmap', { errors: rmErrs });
    return false;
  }

  // Milestone-control due? (nothing planned, or planned milestone fully proven)
  let ms = loadCurrentMilestone(REPO);
  const msErrs = ms ? validateMilestoneState(ms) : ['missing'];
  const milestoneDue = !ms || msErrs.length > 0 || ms.packages.every((p) => p.status === 'PROVEN');
  if (milestoneDue) {
    if (st.milestoneRuns.length > 0 || st.pausedFatal) return false;
    const ack = launchDetached(
      'foresift-milestone-control',
      'foresift/milestone-planning',
      'plan-or-audit-current-milestone',
    );
    const runId = resolveRunId(
      ack,
      'foresift-milestone-control',
      'plan-or-audit-current-milestone',
    );
    record(st, 'milestone_control_launched', {
      ack: sanitizeAck(ack),
      runId,
      discovery: extractRunId(ack) ? 'ack' : 'runs-table',
    });
    if (runId)
      trackRun(st, 'milestone', {
        kind: 'milestone',
        workflow: 'foresift-milestone-control',
        runId,
        branch: 'foresift/milestone-planning',
        message: 'plan-or-audit-current-milestone',
        startedAt: now(),
        resumeCount: 0,
        restartCount: 0,
      });
    return true;
  }
  if (msErrs.length > 0 && msErrs[0] !== 'missing') {
    record(st, 'invalid_milestone_state', { errors: msErrs });
    return false;
  }

  // Work-package selection under the concurrency policy.
  const running = st.activeRuns.map((r) => findPackage(ms, r.packageId)).filter(Boolean);
  const ordered = [...ms.packages].sort(
    (a, b) => (a.dependencies?.length ?? 0) - (b.dependencies?.length ?? 0),
  );
  for (const cand of ordered) {
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
    setPackageStatus(ms, cand.id, 'RUNNING');
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
    running.push(cand);
  }
  return true;
}

// ── status ───────────────────────────────────────────────────────────────────
export function buildStatus() {
  const roadmap = loadRoadmap(REPO);
  const ms = loadCurrentMilestone(REPO);
  const st = loadState();
  const lines = [];
  lines.push(`FORESIFT AUTOPILOT STATUS — ${new Date().toISOString()}`);
  if (st.pausedFatal) lines.push(`⛔ PAUSED_FATAL: ${st.pausedFatal.reason}`);
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
      const run = st.activeRuns.find((r) => r.packageId === p.id);
      const runInfo = run
        ? ` · run ${run.runId ?? '(restarting)'} status=${run.lastSeenStatus ?? '?'} resumes=${run.resumeCount} restarts=${run.restartCount}`
        : '';
      lines.push(
        `  • ${p.id.padEnd(28)} ${p.status.padEnd(9)} risk=${p.risk.padEnd(8)} deps=[${(p.dependencies ?? []).join(',')}]${runInfo}`,
      );
    }
  }
  for (const m of st.milestoneRuns ?? [])
    lines.push(`milestone-control run ${m.runId} status=${m.lastSeenStatus ?? '?'}`);
  lines.push(`runtime state: ${STATE_FILE}`);
  return lines.join('\n');
}

// ── main loop ────────────────────────────────────────────────────────────────
async function tick(st) {
  refreshMain();
  // Reconcile active entries.
  for (const entry of [...st.activeRuns, ...st.milestoneRuns]) {
    if (entry.done) continue;
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

  if (!st.pausedFatal) selectAndLaunch(st);
  saveState(st);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--status')) {
    console.log(buildStatus());
    return;
  }
  if (!acquireLock()) {
    console.error('another autopilot instance holds the lock');
    process.exit(3);
  }
  if (argv.includes('--clear-fatal')) {
    const st = loadState();
    st.pausedFatal = null;
    saveState(st);
    log('fatal pause cleared by operator');
    return; // one-shot maintenance command; systemd restarts the loop separately
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

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
