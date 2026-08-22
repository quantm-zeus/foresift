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
        reason: `detached launch for ${entry.branch} could not be associated with a durable Archon run id after ${DISCOVERY_LIMIT} discovery attempts; operator must verify 'archon workflow runs' then run --clear-fatal`,
        runId: null,
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
  else if (!entry.runId && !entry.done) parts.push('restart-scheduled');
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
  if (st.pausedFatal) lines.push(`⛔ PAUSED_FATAL: ${st.pausedFatal.reason}`);
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
