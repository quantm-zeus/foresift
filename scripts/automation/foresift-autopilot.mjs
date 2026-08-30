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
//   node scripts/automation/foresift-autopilot.mjs --execution-profile CLAUDE_AGY
//                                                              # supported fallback override; default comes from
//                                                              # versioned config/foresift-execution.json
//   node scripts/automation/foresift-autopilot.mjs --recover-fatal [runId]
//                                                              # supported operator recovery of a
//                                                              # PAUSED_FATAL pause (same run, same branch;
//                                                              # falls back to exactly ONE fresh continuation).
//                                                              # Stop the service unit first (singleton lock).
//   node scripts/automation/foresift-autopilot.mjs --clear-fatal
//                                                              # fail-closed: refuses when clearing would orphan
//                                                              # a RUNNING package (use --recover-fatal then)
//   node scripts/automation/foresift-autopilot.mjs --finalize-from-main <id>
//                                                              # deterministic fail-closed RUNNING -> PROVEN for a
//                                                              # package whose implementation ALREADY landed on main
//                                                              # out-of-band (defect #16 class): proves merged-PR
//                                                              # ancestry, T-scoped completeness at CURRENT
//                                                              # origin/main HEAD, green CI on exactly that HEAD,
//                                                              # and no live execution; refuses otherwise. No AI.
//                                                              # Stop the service unit first (singleton lock).
//   node scripts/automation/foresift-autopilot.mjs --seed-package-planning <id> \
//        --from <source-tree-root>
//                                                              # operator/maintenance form of the planned-handoff
//                                                              # promotion: snapshots ONE package's scoped planning
//                                                              # artifacts (specs/<id>/** only) from a run worktree
//                                                              # into a protected control-plane PR. Idempotent;
//                                                              # fail-closed; no AI. Stop the service unit first.
//   node scripts/automation/foresift-autopilot.mjs --restart-package <id> \
//        --fresh-generation [--reason "<text>"] [--salvage-manifest <f>]
//                                                              # supported fresh-generation restart of ONE package
//                                                              # (V3 §7): retires the current generation's runs,
//                                                              # bumps packages[].generation exactly once, resets
//                                                              # status to PENDING, emits a machine-readable receipt.
//                                                              # Idempotent; crash-safe via a recorded intent.
//                                                              # --salvage-manifest <f> additionally SEEDS the new
//                                                              # foresift/<id>-g<N> branch at final V3 main with the
//                                                              # salvaged product work (pushed, launcher-pinnable).
//                                                              # A duplicate re-invocation replays the receipt;
//                                                              # --confirm-new-generation overrides deliberately.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadRoadmap,
  loadCurrentMilestone,
  validateRoadmap,
  validateMilestoneState,
  ALLOWED_STATUS_TRANSITIONS,
  findPackage,
  packageEligible,
  canStartPackage,
  classifyFailure,
  extractQuotaResetAt,
} from './schema.mjs';
import { CHECKPOINT_FILE, validateCheckpoint } from './package-checkpoint.mjs';
import { rankPendingPackages } from './milestone-scheduler.mjs';
import { throughputProfile } from './work-package-throughput-profile.mjs';
import {
  packageGeneration,
  generationBranch,
  generationMessage,
  isSupportedNextGeneration,
  parseGenerationMessage,
  usesOptimizedWorkflow,
  workPackageWorkflowFor,
} from './package-generations.mjs';
import { applySalvage, SALVAGE_MANIFEST_SCHEMA } from './generation-salvage.mjs';
import { collectFinalizationFacts, evaluateFinalizationFromMain } from './finalize-from-main.mjs';
import { admitWorkflowForLaunch, PLANNING_BOOTSTRAP_WORKFLOW } from './wave-admission.mjs';
import { resolveExecutionProfile } from './execution-profile.mjs';
import { createIncidentCapsule } from './maintainer-incident.mjs';
import {
  evaluateBunMigrationBarrier,
  loadBunMigrationInputs,
  validateBunMigrationProof,
} from './bun-migration-state.mjs';
import { getMainCiStatus } from './ci-authority.mjs';
import {
  advanceStateTransition,
  discoverPendingReceipts,
  recoverPendingStateLandings,
} from './state-landing.mjs';
import { serializeMilestoneState, formatMilestoneText } from './schema.mjs';
import { auditGitHubProtection } from './audit-github-protection.mjs';
import {
  createLaunchIntent,
  associateRunIdWithIntent,
  isPackageLaunchInFlight,
  reconcileLaunchIntentsOnStartup,
  discoverPendingLaunchIntents,
} from './launch-intent.mjs';
import { advanceRepairRequest, discoverPendingRepairRequests } from './ci-repair-executor.mjs';

// Overridable for hermetic selftests (sandboxed fixture repo + state dir).
const REPO = process.env.FORESIFT_AUTOPILOT_REPO ?? join(import.meta.dirname, '..', '..');
const STATE_DIR =
  process.env.FORESIFT_AUTOPILOT_STATE_DIR ??
  join(process.env.HOME ?? '', '.local', 'state', 'foresift');
const STATE_FILE = join(STATE_DIR, 'autopilot-state.json');
const LOCK_FILE = join(STATE_DIR, 'autopilot.lock');
export const POLL_INTERVAL_MS = 60_000;
// V3-B §18 — adaptive handoff latency. 60s stays the steady-state cadence, but
// right after a tick LAUNCHED work (or while a tracked entry still awaits run-id
// discovery) the supervisor drops to a fast handoff cadence so Archon runs are
// picked up in seconds, not a minute. The fast streak is bounded: a permanently
// undiscoverable run cannot pin the loop at the fast rate forever — after
// HANDOFF_FAST_STREAK_MAX consecutive fast polls the loop reverts to the base
// interval until a quiet tick resets the streak.
export const HANDOFF_POLL_MS = 10_000;
export const HANDOFF_FAST_STREAK_MAX = 6;

// ── Protection audit cache ────────────────────────────────────────────────────
// Audit runs at startup and before first product launch; cached for TTL.
// Fail-closed for NEW launches on audit failure — does NOT kill active packages.
export const PROTECTION_AUDIT_TTL_MS = 1_800_000; // 30 minutes
let _auditResult = null; // last audit result
let _auditAt = 0; // timestamp of last audit
let _auditBlocksLaunches = false; // true if last audit failed

/**
 * Pure handoff-cadence decision (V3-B §18 + Hyperdrive §49). Given whether
 * the last tick launched anything, whether any tracked entry still awaits
 * run-id discovery, whether ACTIVE work is present, whether the ready queue
 * is non-empty, and the current fast-poll streak, returns the next sleep plus
 * the new streak. Deterministic and total: same inputs ⇒ same delay.
 *
 * §49 cadences: active useful work or a non-empty ready queue polls at the
 * fast handoff rate (READY→LAUNCH P95 < 30s) without a launch having just
 * happened; a fully idle project drops back to the base minute cadence. The
 * fast streak stays bounded exactly as before.
 *
 * @returns {{delayMs: number, fastStreak: number}}
 */
export function nextPollDelayMs({
  launched = 0,
  awaitingDiscovery = false,
  fastStreak = 0,
  activeWork = false,
  readyWork = false,
} = {}) {
  const wantFast = launched > 0 || Boolean(awaitingDiscovery) || Boolean(activeWork) || Boolean(readyWork);
  if (!wantFast) return { delayMs: POLL_INTERVAL_MS, fastStreak: 0 };
  if (fastStreak >= HANDOFF_FAST_STREAK_MAX) {
    // Bound reached: hold the fast rate while work remains ACTIVE/ready (a
    // live wave or a waiting CI must not idle the scheduler for a minute),
    // but drop back to base the moment the project goes quiet. Reverting to
    // base resets the streak (original V3-B §18 clamp semantics), so a later
    // launch rebuilds the fast streak from zero.
    if (activeWork || readyWork || awaitingDiscovery)
      return { delayMs: HANDOFF_POLL_MS, fastStreak: HANDOFF_FAST_STREAK_MAX };
    return { delayMs: POLL_INTERVAL_MS, fastStreak: 0 };
  }
  return { delayMs: HANDOFF_POLL_MS, fastStreak: fastStreak + 1 };
}
const RESUME_LIMIT = 3; // workflow-level automatic resumes per §16
const FRESH_RESTARTS_LIMIT = 1;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 15 * 60_000;
// Dedupes co_run_denied observability events within one supervisor process.
const coRunDenialSeen = new Set();
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
// All progress logging goes to STDERR: one-shot commands (--restart-package,
// --status) print machine-readable payloads on stdout, and journald captures
// both streams for the service, so nothing is lost.
const log = (...m) => console.error(new Date().toISOString(), '[autopilot]', ...m);

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
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    state.activeRuns ??= [];
    state.milestoneRuns ??= [];
    state.maintenanceRuns ??= [];
    state.testMigration ??= { status: 'BUN_MIGRATION_REQUIRED' };
    state.history ??= [];
    return state;
  } catch {
    return {
      activeRuns: [],
      milestoneRuns: [],
      maintenanceRuns: [],
      testMigration: { status: 'BUN_MIGRATION_REQUIRED' },
      pausedFatal: null,
      history: [],
    };
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
  enqueue(() => {
    sh('git fetch origin main --quiet');
    const behind = sh('git rev-list --count main..origin/main');
    // Explicit merge from the fetched ref, NOT bare `git pull`: pull depends on
    // branch tracking configuration, which is incidental setup — its absence
    // would silently skip every refresh and freeze selection on a stale tree.
    if (behind.ok && Number(behind.out) > 0 && !sh('git merge --ff-only origin/main').ok)
      log('WARN: could not fast-forward main');
  });
}

/**
 * HARD LAW: NORMAL AUTOPILOT NEVER DIRECT-PUSHES A NEW COMMIT TO PROTECTED MAIN.
 *
 * CI Authority Correctness V2: state transitions are ENTIRELY in-memory.
 *
 * The old pattern mutated canonical current-milestone.json on disk, staged it,
 * read content, reset, then called blocking landStateViaPR(). This violated:
 *   F1 — referenced removed validateDirectMainPushWhitelist symbol
 *   F2 — mutated canonical file before merge
 *   F3 — called blocking 10-minute polling loop
 *
 * New design:
 *   1. Caller modifies the in-memory milestone object
 *   2. requestMilestoneStateTransition() serializes it deterministically
 *   3. Calls advanceStateTransition() which advances ONE step and returns immediately
 *   4. Canonical current-milestone.json on disk is NEVER written until merge is verified
 *   5. Normal supervisor ticks call advanceStateLandings() to progress pending transitions
 *
 * @param {object} ms - in-memory milestone state object
 * @param {string} message - commit message / PR title
 * @param {{ packageId?: string, fromStatus?: string, toStatus?: string }} [meta]
 */
async function requestMilestoneStateTransition(
  ms,
  message,
  { packageId = null, fromStatus = null, toStatus = null } = {},
) {
  // Snapshot before enqueue: callers continue mutating milestone state while
  // the serialized Git queue waits, so the closure must contain immutable data.
  const desiredContent = await formatMilestoneText(serializeMilestoneState(ms));
  const transitionMeta = { packageId, fromStatus, toStatus, message };
  enqueue(async () => {
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: desiredContent },
    ];

    // Progress state transition as far as possible without blocking (returns on WAITING_CI, DONE, or error)
    const result = await advanceStateTransition({
      receipt: null,
      fileChanges,
      message: transitionMeta.message,
      stateDir: STATE_DIR,
      repoDir: REPO,
      packageId: transitionMeta.packageId,
      fromStatus: transitionMeta.fromStatus,
      toStatus: transitionMeta.toStatus,
      initializeOnly: true,
      log: (msg) => log(msg),
    });

    if (result?.ok && result.step === 'DONE') {
      log(`state landing complete: ${result.receipt?.transitionId} → ${result.receipt?.mergedSha}`);
      // Refresh local main to pick up the merged commit
      sh('git fetch origin main --quiet');
      if (!sh('git merge --ff-only origin/main').ok)
        log('WARN: could not fast-forward after state landing');
    } else if (result?.ok) {
      log(`state transition advanced: ${result.receipt?.transitionId} → step=${result.step}`);
    } else if (result && result.step !== 'WAITING_CI' && result.step !== 'PR_PENDING') {
      log(`WARN: state landing step failed: ${result.reason} (step=${result.step})`);
    }
  });
}

/**
 * Advance all pending state landings by one step each.
 * Called once per supervisor tick. Each transition advances at most one external step
 * and returns immediately. No blocking waits.
 */
async function advanceStateLandings() {
  const pending = discoverPendingReceipts(STATE_DIR);
  for (const receipt of pending) {
    // Check retry backoff
    if (receipt.nextRetryAt && new Date(receipt.nextRetryAt) > new Date()) continue;

    // Extract desiredFiles from receipt
    const fileChanges = (receipt.desiredFiles || []).map((f) => ({
      path: f.path,
      content: f.content,
    }));

    const result = await advanceStateTransition({
      receipt,
      fileChanges,
      message: receipt.commitMessage || `chore: state transition ${receipt.transitionId}`,
      stateDir: STATE_DIR,
      repoDir: REPO,
      packageId: receipt.packageId,
      fromStatus: receipt.fromStatus,
      toStatus: receipt.toStatus,
      log: (msg) => log(msg),
    });

    if (result?.ok && result.step === 'DONE') {
      log(`state landing complete: ${receipt.transitionId} → ${result.receipt?.mergedSha}`);
      // Refresh local main to pick up the merged commit
      sh('git fetch origin main --quiet');
      if (!sh('git merge --ff-only origin/main').ok)
        log('WARN: could not fast-forward after state landing');
    }
  }
}

/** Advance each durable CI repair request by exactly one bounded fact transition. */
async function advanceCiRepairs() {
  for (const { request } of discoverPendingRepairRequests(STATE_DIR)) {
    const result = await advanceRepairRequest({
      request,
      stateDir: STATE_DIR,
      repoDir: REPO,
      log: (msg) => log(msg),
    });
    log(`CI repair ${request.requestId}: ${result.action} (${request.status})`);
  }
}

// Legacy alias for code paths that still reference commitState / commitStateViaPR.
// Both now delegate to requestMilestoneStateTransition via persistMilestoneState.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const commitState = requestMilestoneStateTransition;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const commitStateViaPR = requestMilestoneStateTransition;

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

// ── package state transitions (version-controlled, machine-driven only) ──────
/**
 * Repo-scoped planning-completeness probe for wave admission (defect #18):
 * runs the SAME deterministic validator the optimized workflow's Phase-1
 * router uses (`package-plan-complete.mjs`), in its opt-in --repo-only mode —
 * at launch time no per-run $ARTIFACTS_DIR exists yet. Any spawn or parse
 * failure counts as INCOMPLETE: fail-closed toward the topology that plans.
 */
function repoPlanningComplete(packageId) {
  const v = planCompleteAtRoot(REPO, packageId);
  return v.complete === true;
}

/**
 * Workflow variant per EXECUTION GENERATION (V3 ADR-0009) over the historical
 * throughput profile (ADR 0007): every package at generation >= 1 runs the
 * single final optimized topology regardless of the legacy profile table;
 * generation-0 rows keep the historical LEGACY/OPTIMIZED behavior so retired
 * forensic lanes are unchanged. Same single orchestrator, deterministic
 * selection, no behavioral drift for the legacy lane.
 *
 * Wave admission gate (defect #18): `foresift-sharded-wave` is an
 * IMPLEMENTATION-only topology — its prep reads scoped plan/tasks authority
 * that only planning creates. A package whose repo-scoped planning truth is
 * incomplete must first take the optimized topology whose Phase-1 router plans
 * it; later launches/recoveries of the same package then admit to the wave.
 * Decided strictly at LAUNCH time (before any run exists), persisted into the
 * tracking row like every other launch identity fact — never re-derived for a
 * live run, so flip-safety and adoption matching are untouched.
 */
function workPackageWorkflow(pkgOrId) {
  const pkg = typeof pkgOrId === 'string' ? { id: pkgOrId } : pkgOrId;
  const selected = workPackageWorkflowFor(pkg);
  const wf = admitWorkflowForLaunch(selected, repoPlanningComplete(pkg.id));
  if (wf !== selected) log(`WAVE_ADMIT_DEFERRED ${pkg.id}: repo planning incomplete -> ${wf}`);
  return wf;
}

/** Generation-aware launch identity for a milestone package record. */
function launchIdentity(p) {
  const generation = packageGeneration(p);
  return {
    generation,
    branch: generationBranch(p.id, generation),
    message: generationMessage(p.id, generation),
    workflow: workPackageWorkflow(p),
    executionProfile: resolveExecutionProfile(),
  };
}

/**
 * Persist milestone state via the protected state-landing PR lane.
 * INVARIANT: canonical current-milestone.json is NEVER written to disk by this function.
 * The desired state is serialized in-memory and sent through the state-transition lane.
 */
async function persistMilestoneState(ms, message) {
  await requestMilestoneStateTransition(ms, message);
}

async function setPackageStatus(ms, packageId, status) {
  const pkg = findPackage(ms, packageId);
  if (!pkg || pkg.status === status) return false;
  const oldStatus = pkg.status;
  if (!ALLOWED_STATUS_TRANSITIONS.has(`${oldStatus}->${status}`))
    throw new Error(`disallowed package status transition: ${packageId} ${oldStatus}->${status}`);
  pkg.status = status;
  await requestMilestoneStateTransition(
    ms,
    `chore(autopilot): ${ms.milestoneId}/${packageId} -> ${status}`,
    { packageId, fromStatus: oldStatus, toStatus: status },
  );
  return true;
}

// ── launching ────────────────────────────────────────────────────────────────
/** Find the (single) worktree holding a branch, or null when none does. */
function findWorktreeHoldingBranch(branch) {
  const list = sh('git worktree list --porcelain');
  if (!list.ok) return { error: 'worktree_list_failed' };
  for (const block of list.out.split('\n\n')) {
    const lines = block.split('\n');
    const path = lines.find((l) => l.startsWith('worktree '))?.slice(9);
    const wtBranch = lines.find((l) => l.startsWith('branch '))?.slice(7);
    if (path && wtBranch === `refs/heads/${branch}`) return { path };
  }
  return null;
}

function isArchonRunWorktree(path) {
  return path !== REPO && path.includes('/.archon/workspaces/');
}

/**
 * Archon names each run worktree's local branch after the LAUNCH branch with
 * slashes folded to dashes, under its own `archon/task-` namespace
 * (`--branch foresift/g0-security-perimeter` → worktree branch
 * `archon/task-foresift-g0-security-perimeter`, worktree path ending in that
 * same name). Probe-verified live 2026-08-24 across package, generation,
 * planning, and smoke launches.
 */
export function archonTaskBranchName(branch) {
  return `archon/task-${branch.replaceAll('/', '-')}`;
}

/**
 * Defect #11b (live run ce3e0354, 2026-08-24): archon materializes a run
 * worktree fresh at main's tip ONLY at first creation and then REUSES it for
 * every later run of the same task. A package relaunched afterwards therefore
 * preflights against the CREATION-time main — for g0-security-perimeter that
 * baseline predated the dependency's PROVEN chore forever, so every fresh
 * restart refused deterministically (`dependency … is not PROVEN`) even though
 * main itself was fine. The defect-#6/#7 pre-launch machinery never saw these
 * worktrees: they hold archon-internal `archon/task-*` branches, not the
 * launch branch, so findWorktreeHoldingBranch(launch branch) returned null.
 *
 * Fix: before every fresh launch, discover the task worktree for the launch
 * branch by archon's naming convention and fast-forward it to origin/main.
 * Guarded, fail-closed (same discipline as resetArchonRunWorktree):
 *   - only Archon-owned worktrees (under /.archon/workspaces/) are touched;
 *   - advancing requires HEAD to be a strict ANCESTOR of origin/main — any
 *     unique commit (possibly real product work from a crashed run) SKIPS the
 *     advance for an operator instead of risking it;
 *   - dirty trees are never advanced (residue/refusal paths surface them);
 *   - already-current worktrees no-op.
 * Returns an outcome object recorded in state history for audit; null when no
 * registered archon task worktree exists for this branch (first-ever launch —
 * archon then creates one fresh at main's tip itself).
 */
export function findArchonTaskWorktree(branch, cwd = REPO) {
  const taskBranch = archonTaskBranchName(branch);
  const list = sh('git worktree list --porcelain', { cwd });
  if (!list.ok) return { error: 'worktree_list_failed' };
  for (const block of list.out.split('\n\n')) {
    const lines = block.split('\n');
    const path = lines.find((l) => l.startsWith('worktree '))?.slice(9);
    const wtBranch = lines.find((l) => l.startsWith('branch '))?.slice(7);
    if (
      path &&
      isArchonRunWorktree(path) &&
      (wtBranch === `refs/heads/${taskBranch}` || path.endsWith(`/archon/${taskBranch}`))
    )
      return { path };
  }
  return null;
}

export function advanceArchonTaskWorktree(branch, cwd = REPO) {
  const held = findArchonTaskWorktree(branch, cwd);
  if (!held || held.error) return held ?? null;
  const { path } = held;
  const q = JSON.stringify(path);
  sh(`git -C ${q} fetch origin main --quiet`, { cwd });
  const head = sh(`git -C ${q} rev-parse HEAD`, { cwd }).out.trim();
  if (!head) return { skipped: 'no_head', path };
  if (sh(`git -C ${q} merge-base --is-ancestor origin/main HEAD`, { cwd }).ok)
    return { skipped: 'current', path, head: head.slice(0, 10) };
  // Strict fast-forward only — never advance over anything unique.
  if (!sh(`git -C ${q} merge-base --is-ancestor HEAD origin/main`, { cwd }).ok)
    return { skipped: 'diverged', path, head: head.slice(0, 10) };
  const status = sh(`git -C ${q} status --porcelain=v1`, { cwd });
  const files = status.ok ? status.out.split('\n').filter(Boolean) : [];
  if (files.length > 0) return { skipped: 'dirty', path, files: files.slice(0, 40) };
  const merge = sh(`git -C ${q} merge --ff-only origin/main`, { cwd });
  if (!merge.ok)
    return {
      ok: false,
      path,
      detail: (merge.err || merge.out || '').split('\n').filter(Boolean)[0],
    };
  return {
    ok: true,
    path,
    from: head.slice(0, 10),
    to: sh(`git -C ${q} rev-parse HEAD`, { cwd }).out.trim().slice(0, 10),
  };
}

/**
 * Archon reuses ONE run worktree per package+generation across runs, so any
 * dead run leaves residue behind (planning scratch, stale workflow
 * materializations) that trips adopt-generation-branch's dirty-tree refusal on
 * every subsequent fresh launch — a permanent recover-fatal crash-loop
 * (observed live during gen-1 activation, 2026-08-24). A FRESH detached launch
 * therefore starts from a clean worktree. Guarded, fail-closed:
 *   - only Archon-owned worktrees (under /.archon/workspaces/) are touched,
 *     never this checkout and never operator worktrees;
 *   - if origin cannot vouch for the branch tip (missing ref or unpushed
 *     commits) the reset is SKIPPED — adoption's own refusal then pauses for
 *     an operator instead of destroying possibly-real work.
 * Returns an outcome object recorded in state history for audit.
 */
function resetArchonRunWorktree(branch) {
  const held = findWorktreeHoldingBranch(branch);
  if (!held) return null;
  if (held.error) return { skipped: held.error };
  const { path } = held;
  if (!isArchonRunWorktree(path)) return { skipped: 'non_archon_worktree_holds_branch', path };
  const q = JSON.stringify(path);
  sh(`git -C ${q} fetch origin ${JSON.stringify(branch)} --quiet`);
  const originTip = sh(`git -C ${q} rev-parse --verify --quiet origin/${branch}`).out.trim();
  if (!originTip) return { skipped: 'no_origin_ref', path };
  const ahead = sh(`git -C ${q} rev-list --count origin/${branch}..${branch}`);
  if (!ahead.ok || Number(ahead.out.trim()) > 0)
    return { skipped: 'unpushed_commits', path, unpushed: ahead.out.trim() || null };
  const status = sh(`git -C ${q} status --porcelain=v1`);
  const files = status.ok ? status.out.split('\n').filter(Boolean) : [];
  if (!files.length) return { skipped: 'clean', path };
  const reset = sh(`git -C ${q} reset --hard`);
  const cleaned = reset.ok ? sh(`git -C ${q} clean -fd`) : { ok: false };
  return {
    ok: reset.ok && cleaned.ok,
    path,
    fileCount: files.length,
    files: files.slice(0, 40),
  };
}

/**
 * ADR-0010's seed-currency gate refuses any generation seed that does not
 * contain current origin/main — and EVERY control-plane merge to main
 * re-stales the seed between reconciliation and the next launch, which until
 * now meant manual operator reconciliation before each recover-fatal attempt
 * (observed three times live during gen-1 activation; the third refusal was
 * caused by the defect-#6 fix itself landing on main). The ADR's own
 * prescribed remediation — merge updated origin/main into the seed as a
 * normal merge commit ⇒ fresh FULL gate — is deterministic and mechanical,
 * so the supervisor performs it in the freshly-reset run worktree before
 * every fresh launch of a generation branch. Fail-closed: a merge conflict
 * aborts and leaves the seed stale, so adoption's refusal pauses for an
 * operator instead of forcing divergent history together.
 */
function ensureGenerationSeedCurrent(branch) {
  const held = findWorktreeHoldingBranch(branch);
  if (!held) return null;
  if (held.error) return { skipped: held.error };
  const { path } = held;
  if (!isArchonRunWorktree(path)) return { skipped: 'non_archon_worktree_holds_branch', path };
  const q = JSON.stringify(path);
  sh(`git -C ${q} fetch origin ${JSON.stringify(branch)} --quiet`);
  sh(`git -C ${q} fetch origin main --quiet`);
  const originTip = sh(`git -C ${q} rev-parse --verify --quiet origin/${branch}`).out.trim();
  if (!originTip) return { skipped: 'no_origin_ref' };
  const head = sh(`git -C ${q} rev-parse HEAD`).out.trim();
  if (head !== originTip) return { skipped: 'worktree_not_at_origin_tip', head, originTip };
  if (sh(`git -C ${q} merge-base --is-ancestor origin/main HEAD`).ok)
    return { skipped: 'current', head: head.slice(0, 10) };
  const merge = sh(
    `git -C ${q} merge --no-ff origin/main -m ${JSON.stringify(
      `chore(generation): absorb updated main into ${branch} seed`,
    )}`,
  );
  if (!merge.ok) {
    sh(`git -C ${q} merge --abort`);
    return {
      ok: false,
      conflict: true,
      path,
      detail: (merge.err || merge.out || '').split('\n').filter(Boolean).slice(0, 5).join(' | '),
    };
  }
  const push = sh(`git -C ${q} push -q origin ${JSON.stringify(branch)}`);
  if (!push.ok) {
    sh(`git -C ${q} reset --hard ORIG_HEAD`); // stay at the pushed tip
    return { ok: false, pushFailed: true, path, detail: (push.err || '').split('\n')[0] };
  }
  return {
    ok: true,
    path,
    head: sh(`git -C ${q} rev-parse HEAD`).out.trim().slice(0, 10),
    mergedMain: sh(`git -C ${q} rev-parse --short origin/main`).out.trim(),
  };
}

function launchDetached(st, workflow, branch, message, executionProfile = null) {
  if (st && executionProfile) {
    record(st, 'execution_profile_selected', {
      workflow,
      branch,
      message,
      executionProfile,
    });
    saveState(st);
  }
  const reset = st ? resetArchonRunWorktree(branch) : null;
  if (reset) record(st, 'run_worktree_reset', { branch, ...reset });
  // Defect #11b: archon reuses its per-task run worktree across launches and
  // never refreshes it, so advance it to current main before handing off.
  const advanced = st ? advanceArchonTaskWorktree(branch) : null;
  if (advanced) record(st, 'archon_task_worktree_advanced', { branch, ...advanced });
  const seed = st ? ensureGenerationSeedCurrent(branch) : null;
  if (seed && !seed.skipped) record(st, 'generation_seed_reconciled', { branch, ...seed });
  const previous = process.env.FORESIFT_EXECUTION_PROFILE;
  if (executionProfile) process.env.FORESIFT_EXECUTION_PROFILE = executionProfile;
  let ack;
  try {
    ack = archonJson(
      `workflow run ${workflow} --detach --branch ${branch} --json ${JSON.stringify(message)}`,
    );
  } finally {
    if (previous === undefined) delete process.env.FORESIFT_EXECUTION_PROFILE;
    else process.env.FORESIFT_EXECUTION_PROFILE = previous;
  }
  return ack;
}

/**
 * A state chore (PENDING→RUNNING etc.) commits straight to main — which
 * instantly re-stales a generation seed that was just reconciled in
 * launchDetached, and the workflow's adoption node reads origin/main only
 * seconds later (observed hermetically: the flip chore raced and beat the
 * currency check within one tick). Any code path that pushes a state chore
 * for a package with a live generation branch therefore re-runs the
 * reconciliation BEHIND the chore on the serialized git queue — running it
 * inline would read a pre-chore origin/main and no-op as 'current' against
 * exactly the commit that makes the seed stale.
 */
function reconcileSeedAfterStateChore(st, packageId, branch) {
  if (!st || !branch || !packageId) return;
  enqueue(() => {
    const seed = ensureGenerationSeedCurrent(branch);
    if (seed && !seed.skipped)
      record(st, 'generation_seed_reconciled', {
        branch,
        packageId,
        after: 'state_chore',
        ...seed,
      });
    // The queue may drain after the caller's own saveState — persist here.
    saveState(st);
  });
}

// ── run bookkeeping ──────────────────────────────────────────────────────────
function backoffMs(attempt) {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

function trackRun(st, kind, entry) {
  (kind === 'milestone'
    ? st.milestoneRuns
    : kind === 'maintenance'
      ? st.maintenanceRuns
      : st.activeRuns
  ).push(entry);
}

async function finalizeCompletedRun(st, entry, get = null) {
  // PLANNED_HANDOFF: a completed planning-bootstrap run is a SUCCESS by
  // definition — it never produces a PR. Route it to the first-class handoff
  // before the completed-without-merge anomaly logic can touch it.
  if (entry.kind === 'package' && entry.workflow === PLANNING_BOOTSTRAP_WORKFLOW)
    return planningBootstrapHandoff(st, entry, get);
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
  if (entry.kind === 'maintenance') {
    if (!merged) {
      entry.note = 'completed-without-merge';
      record(st, 'bun_migration_completed_without_merge', { runId: entry.runId });
      attemptResume(st, entry, 'Bun migration completed but its PR was not merged');
      return false;
    }
    refreshMain();
    await commitQueue.catch(() => {});
    const { policy, proof } = loadBunMigrationInputs(REPO);
    const verdict = validateBunMigrationProof(proof, policy);
    if (!verdict.valid) {
      entry.failureClass = 'FATAL';
      enterFatalPause(
        st,
        entry,
        `merged Bun migration proof invalid: ${verdict.reasons.join(',')}`,
      );
      return false;
    }
    st.testMigration = {
      status: 'BUN_MIGRATION_PROVEN',
      migrationId: policy.migrationId,
      runId: entry.runId,
      pr: mergedPr,
      provenAt: now(),
    };
    record(st, 'bun_migration_proven', { runId: entry.runId, pr: mergedPr });
    return true;
  }
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
    // WAVE LANDING ADOPTION: the sharded wave closes its own loop by running
    // package-final-land.mjs (wave-land node) — push + FULL gate + PR +
    // exact-head CI + squash-merge. When the PR simply has not merged YET
    // (open PR, CI running) the run is still making progress and must NOT
    // count as an anomaly: resuming a completed archon run is refused (a
    // completed run cannot resume), so a fresh restart here would duplicate
    // the whole wave (observed live 2026-08-29, runs 4e7698e8 → d007fbf6 →
    // recovery-exhaustion fatal pause). Instead: hold the tracked entry,
    // defer to the landing budget, and let a later tick re-check merge state.
    if (entry.workflow === 'foresift-sharded-wave') {
      const prList = sh(
        `gh pr list --repo quantm-zeus/foresift --head ${entry.branch} --state open --json number --limit 1`,
      );
      let openPr = null;
      try {
        openPr = JSON.parse(prList.out || '[]')[0]?.number ?? null;
      } catch {}
      if (openPr) {
        entry.note = 'awaiting-landing-ci';
        record(st, 'wave_awaiting_landing', { runId: entry.runId, pr: openPr });
        return false;
      }
      // No open PR ⇒ the wave's landing step never produced one (older run or
      // landing refused). Drive the deterministic lander DIRECTLY from the
      // supervisor tick — zero AI, fail-closed, same tool the wave uses.
      const canonPath = findWorktreeHoldingBranch(entry.branch);
      const landCwd = canonPath?.path ?? REPO;
      // Resolve the run's artifacts dir from archon (probed `working_path`
      // convention): the run's worktree sibling artifacts dir holds the
      // pr-number/gate evidence; when unavailable degrade to a derived dir.
      let artifacts = null;
      if (entry.runId) {
        const get = archonJson(`workflow get ${entry.runId} --json`);
        const wt = get?.working_path ?? get?.path ?? get?.run?.path ?? null;
        if (wt) artifacts = join(dirname(dirname(wt)), 'artifacts', 'runs', entry.runId);
      }
      if (!artifacts) artifacts = join(STATE_DIR, 'wave-landing', entry.runId ?? 'unknown');
      mkdirSync(artifacts, { recursive: true });
      const land = sh(
        `node scripts/automation/package-final-land.mjs --package ${JSON.stringify(entry.packageId)} --branch ${JSON.stringify(entry.branch)} --artifacts-dir ${JSON.stringify(artifacts)}`,
        { cwd: landCwd, timeout: 45 * 60 * 1000 },
      );
      record(st, 'wave_landing_attempted', {
        runId: entry.runId,
        cwd: landCwd,
        exit: land.status,
        tail: (land.err || land.out || '').split('\n').filter(Boolean).slice(-3).join(' | '),
      });
      if (land.status === 0) return false; // merged — next tick's PROVEN path
      entry.note = 'landing-pending';
      attemptResume(st, entry, 'wave landing pending (lander exit ' + (land.status ?? '?') + ')');
      return false;
    }
    // Workflow reported success without a merged PR — treat as recoverable anomaly.
    entry.note = 'completed-without-merge';
    record(st, 'anomaly_completed_without_merge', entry);
    attemptResume(st, entry, 'workflow completed but PR not merged');
    return false;
  }
  refreshMain();
  const ms = loadCurrentMilestone(REPO);
  await setPackageStatus(ms, entry.packageId, 'PROVEN');
  record(st, 'package_proven', { packageId: entry.packageId, pr: mergedPr });
  return true;
}

// ── planned handoff (post-planning throughput gap) ───────────────────────────
/**
 * Deterministic repo-scoped planning completeness at an explicit root.
 * Returns { complete:boolean, verdict?:object } — "could not evaluate" is
 * complete:false (fail-closed), never an exception path.
 */
function planCompleteAtRoot(root, packageId) {
  try {
    const r = spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, 'package-plan-complete.mjs'),
        '--package',
        packageId,
        '--repo-only',
        '--root',
        root,
      ],
      { encoding: 'utf8', cwd: REPO, timeout: 60000 },
    );
    if (r.error) return { complete: false, detail: `validator spawn failed: ${r.error.message}` };
    if (r.status !== 0)
      return {
        complete: false,
        detail: `validator exit ${r.status ?? '?'}: ${
          (r.stderr || r.stdout || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'no output'
        }`,
      };
    if (!r.stdout) return { complete: false, detail: 'validator produced no output' };
    return { complete: JSON.parse(r.stdout)?.complete === true, verdict: r.stdout };
  } catch (err) {
    return { complete: false, detail: `validator unavailable: ${String(err?.message ?? err)}` };
  }
}

/**
 * Submit a bootstrap run's scoped planning artifacts (specs/<pkg>/** only —
 * NEVER implementation code) through the protected control-plane PR lane.
 * Source content is snapshotted in memory; the canonical checkout is never
 * mutated. Idempotent receipts and the normal exact-head CI/merge state
 * machine carry the snapshot to origin/main over later supervisor ticks.
 *
 * The wave's fresh-at-main worktree can only see planning truth that reached
 * origin/main, so a pending or failed protected landing blocks continuation
 * with the tracked entry still in place.
 */
function promotePackagePlanningArtifacts(packageId, fromRoot) {
  const specDir = join('specs', packageId);
  const qRepo = JSON.stringify(REPO);
  const fetched = sh(`git -C ${qRepo} fetch origin main --quiet`);
  if (!fetched.ok)
    return { ok: false, refused: 'could not fetch origin/main for planning handoff' };
  const clean = sh(`git -C ${qRepo} status --porcelain -- ${JSON.stringify(specDir)}`);
  const matchesOrigin = sh(
    `git -C ${qRepo} diff --quiet origin/main -- ${JSON.stringify(specDir)}`,
  );
  if (
    clean.ok &&
    !clean.out.trim() &&
    matchesOrigin.ok &&
    planCompleteAtRoot(REPO, packageId).complete
  )
    return { ok: true, promoted: false, detail: 'already current on main' };
  if (!fromRoot || !existsSync(join(fromRoot, specDir)))
    return { ok: false, refused: `source worktree lacks ${specDir}` };

  const check = planCompleteAtRoot(fromRoot, packageId);
  if (!check.complete) {
    return {
      ok: false,
      refused: `source planning validation failed: ${
        check.detail ??
        (check.verdict ? String(check.verdict).slice(0, 300) : 'validator unavailable')
      }`,
    };
  }

  const sourceDir = join(fromRoot, specDir);
  const fileChanges = [];
  const collect = (dir, prefix) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink())
        throw new Error(`planning handoff refuses symbolic link: ${join(prefix, item.name)}`);
      const absolute = join(dir, item.name);
      const relativePath = join(prefix, item.name);
      if (item.isDirectory()) collect(absolute, relativePath);
      else if (item.isFile())
        fileChanges.push({ path: relativePath, content: readFileSync(absolute, 'utf8') });
    }
  };
  try {
    collect(sourceDir, specDir);
  } catch (error) {
    return { ok: false, refused: error.message };
  }
  fileChanges.sort((a, b) => a.path.localeCompare(b.path));
  if (fileChanges.length === 0) return { ok: false, refused: 'source planning directory is empty' };

  const msg = `chore(autopilot): seed ${packageId} planning artifacts (planned-handoff)`;
  const immutableChanges = fileChanges.map((file) => ({ ...file }));
  enqueue(async () => {
    const result = await advanceStateTransition({
      receipt: null,
      fileChanges: immutableChanges,
      message: msg,
      stateDir: STATE_DIR,
      repoDir: REPO,
      packageId,
      initializeOnly: true,
      log: (message) => log(message),
    });
    if (!result.ok) log(`WARN: planning handoff request failed: ${result.reason}`);
  });
  return {
    ok: false,
    pending: true,
    refused: 'protected planning PR requested; waiting for exact-head CI and merge',
  };
}

/**
 * First-class PLANNED_HANDOFF for a completed planning-bootstrap run. The
 * required lifecycle: planning truth becomes deterministic → this execution
 * terminates (it contains ZERO implementation nodes) → supervisor verifies,
 * promotes the scoped artifacts to main, and IMMEDIATELY reselects the same
 * still-RUNNING package — which wave-admission now routes to the sharded
 * wave. Package status is never touched here (RUNNING across the whole
 * handoff); no PENDING flip forces reselection and nothing is marked PROVEN.
 *
 * Crash-safety (ordered verify → promote → adopt-or-launch LAST):
 *   crash before relaunch          ⇒ next tick replays classification;
 *                                    promotion is idempotent;
 *   crash after launch, before save ⇒ adoption: findRecentRunRow keyed on
 *                                    the WAVE identity re-adopts the live
 *                                    row instead of duplicating it (the
 *                                    completed bootstrap row can never match
 *                                    a different workflow name);
 *   late wake-up of the old run    ⇒ impossible to act on: its entry is done
 *                                    and adoption/discovery match on
 *                                    workflow+message identity.
 */
function planningBootstrapHandoff(st, entry, get) {
  const packageId = entry.packageId;
  // 1. Verify the bootstrap's planning truth AT ITS RUN WORKTREE (the only
  // place it exists until promoted). Installed archon v0.9 exposes the run
  // worktree as `working_path` (probed live); the remaining spellings are
  // tolerant fallbacks. No path from archon ⇒ fall back to the main tree
  // (promotion then no-ops); neither provable ⇒ fail closed through ordinary
  // recovery, never silently onward.
  const wtPath =
    get?.working_path ??
    get?.path ??
    get?.worktree_path ??
    get?.workspace_path ??
    get?.run?.path ??
    null;
  const proof = wtPath ? planCompleteAtRoot(wtPath, packageId) : { complete: false };
  const fallback = proof.complete ? null : planCompleteAtRoot(REPO, packageId);
  if (!(proof.complete || fallback?.complete)) {
    record(st, 'planning_handoff_refused', {
      packageId,
      runId: entry.runId,
      why: 'repo-scoped planning completeness not provable at run worktree or main',
    });
    attemptResume(st, entry, 'bootstrap completed but planning completeness unprovable');
    return false;
  }

  // 2. Submit scoped planning artifacts through the protected PR lane.
  const promo = promotePackagePlanningArtifacts(packageId, wtPath);
  if (!promo.ok) {
    record(
      st,
      promo.pushFailed ? 'planning_handoff_push_failed' : 'planning_handoff_promotion_refused',
      {
        packageId,
        runId: entry.runId,
        detail: promo.refused ?? null,
        commit: promo.commit ?? null,
      },
    );
    // Pending receipts retry through the state-landing outbox. Source
    // refusals use ordinary recovery. Both keep the package RUNNING.
    if (promo.pending) saveState(st);
    else attemptResume(st, entry, `planning handoff refused: ${promo.refused}`);
    return false;
  }

  // 3. Adopt-or-launch the implementation continuation under CURRENT law.
  const msFile = loadCurrentMilestone(REPO);
  const pkg =
    msFile && validateMilestoneState(msFile).length === 0 ? findPackage(msFile, packageId) : null;
  if (!pkg) {
    record(st, 'planning_handoff_refused', {
      packageId,
      runId: entry.runId,
      why: 'package record missing/invalid in current milestone',
    });
    attemptResume(st, entry, 'bootstrap completed but package record unusable');
    return false;
  }
  const { generation, branch, message, workflow: wf, executionProfile } = launchIdentity(pkg);
  // Duplicate-tick / crash-after-launch absorption: a LIVE wave row for this
  // exact identity is adopted, never duplicated. Keyed on the WAVE identity —
  // the terminal bootstrap run cannot collide.
  const liveRow = findRecentRunRow(wf, message);
  if (liveRow && ['running', 'pending'].includes(String(liveRow.status))) {
    Object.assign(entry, {
      workflow: wf,
      runId: liveRow.id,
      branch,
      message,
      startedAt: normalizeTimestampMs(liveRow.started_at) ?? now(),
      resumeCount: 0,
      restartCount: 0,
      awaitingDiscovery: false,
      discoveryAttempts: 0,
      executionProfile,
    });
    record(st, 'planning_handoff_wave_adopted', { packageId, runId: liveRow.id, workflow: wf });
    saveState(st);
    return false; // the adopted wave run stays tracked and continues
  }
  const ack = launchDetached(st, wf, branch, message, executionProfile);
  const runId = resolveRunId(ack, wf, message);
  record(st, 'planning_handoff_complete', {
    packageId,
    oldRunId: entry.runId,
    promotedCommit: promo.commit ?? null,
    generation,
    workflow: wf,
    ack: sanitizeAck(ack),
    runId,
    discovery: extractRunId(ack) ? 'ack' : 'runs-table',
  });
  trackRun(st, 'package', {
    kind: 'package',
    workflow: wf,
    runId,
    packageId,
    branch,
    message,
    startedAt: now(),
    resumeCount: 0,
    restartCount: 0,
    awaitingDiscovery: !runId,
    discoveryAttempts: 0,
    executionProfile,
  });
  if (runId) {
    // Mirror selectAndLaunch's durable-association discipline: RUNNING was
    // already set when the bootstrap launched; just reconcile the seed behind
    // any state-chore traffic.
    reconcileSeedAfterStateChore(st, packageId, branch);
  }
  entry.done = true;
  saveState(st);
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
  if (!entry.maintainerIncidentPath) {
    const incidentDir = join(STATE_DIR, 'maintainer-incidents');
    mkdirSync(incidentDir, { recursive: true });
    const eventId = `paused-fatal-${entry.runId ?? entry.packageId ?? entry.kind ?? 'unknown'}`;
    const file = join(incidentDir, `${eventId}.json`);
    const capsule = createIncidentCapsule({
      eventId,
      type: 'paused_fatal',
      package: entry.packageId ?? null,
      generation: parseGenerationMessage(entry.message ?? '')?.generation ?? 0,
      runId: entry.runId ?? null,
      workflow: entry.workflow ?? null,
      executionProfile: entry.executionProfile ?? 'HISTORICAL_V4',
      node: runObservability(entry.runId)?.currentNode ?? null,
      engine: null,
      model: null,
      reasoning: null,
      serviceTier: null,
      testEngine: entry.executionProfile ? 'AGY' : 'PERSISTED_HISTORICAL',
      baseHead: null,
      currentHead: sh('git rev-parse HEAD').out || null,
      attempts: (entry.resumeCount ?? 0) + (entry.restartCount ?? 0),
      failureClassification: 'PAUSED_FATAL',
      failedGate: null,
      logTail: String(reason).slice(-1200),
      diffSummary: null,
      artifactPointers: { supervisorState: STATE_FILE },
    });
    atomicWriteJson(file, capsule);
    entry.maintainerIncidentPath = file;
    record(st, 'maintainer_incident_capsule_created', {
      eventId,
      file,
      claudeInference: 0,
      next: 'invoke Claude maintainer only with this capsule and require a bounded action',
    });
  }
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

async function actOnEntry(st, entry) {
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
  if (status === 'completed') return await finalizeCompletedRun(st, entry, get);
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
          await setPackageStatus(ms, entry.packageId, 'PENDING');
      } catch (err) {
        record(st, 'requeue_status_flip_failed', {
          packageId: entry.packageId,
          error: String(err?.message ?? err).slice(0, 200),
        });
      }
    } else if (entry.kind === 'maintenance') {
      st.testMigration = {
        ...(st.testMigration ?? {}),
        status: 'BUN_MIGRATION_REQUIRED',
        reason: 'maintenance-run-cancelled',
      };
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
        const pendingIntents = discoverPendingLaunchIntents(STATE_DIR);
        const entryGeneration = parseGenerationMessage(entry.message ?? '')?.generation ?? 0;
        const matched = pendingIntents.find(
          (i) =>
            i.packageId === entry.packageId &&
            i.generation === entryGeneration &&
            i.workflow === entry.workflow &&
            i.branch === entry.branch,
        );
        if (matched) {
          associateRunIdWithIntent(STATE_DIR, matched.intentId, id);
        }
        try {
          const ms = loadCurrentMilestone(REPO);
          if (ms && findPackage(ms, entry.packageId)?.status === 'PENDING') {
            await setPackageStatus(ms, entry.packageId, 'RUNNING');
            reconcileSeedAfterStateChore(st, entry.packageId, entry.branch);
          }
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
    const ack = launchDetached(
      st,
      entry.workflow,
      entry.branch,
      entry.message,
      entry.executionProfile ?? null,
    );
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
    // Generation-aware identity: only rows matching the CURRENT generation's
    // correlation message are adoptable. A retired generation's runs — under
    // the legacy bare-id message or an older @gN suffix — can never be
    // re-adopted by a newer generation (V3 §6).
    const { branch, message, workflow: wf, executionProfile } = launchIdentity(p);
    const row = findRecentRunRow(wf, message);
    if (row && ['running', 'pending'].includes(String(row.status))) {
      st.activeRuns.push({
        kind: 'package',
        workflow: row.workflow_name,
        runId: row.id,
        packageId: p.id,
        branch,
        message,
        startedAt: normalizeTimestampMs(row.started_at) ?? now(),
        resumeCount: 0,
        restartCount: 0,
        awaitingDiscovery: false,
        discoveryAttempts: 0,
        executionProfile,
      });
      record(st, 'stranded_run_adopted', { packageId: p.id, runId: row.id, status: row.status });
      continue;
    }
    const entry = {
      kind: 'package',
      workflow: wf,
      runId: row?.id ?? null,
      packageId: p.id,
      branch,
      message,
      startedAt: now(),
      resumeCount: 0,
      restartCount: 0,
      executionProfile,
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

/**
 * Milestone state as COMMITTED at HEAD — the only view a freshly materialized
 * Archon run worktree can inherit. Defect #11 (live run ce3e0354, 2026-08-24):
 * selection evaluated eligibility against the working tree, which already held
 * the just-written but NOT YET COMMITTED `-> PROVEN` chore flip; archon seeded
 * the dependent package's worktree from committed main where the dependency
 * was still RUNNING, preflight refused (`dependency … is not PROVEN`), and
 * every recovery resume re-ran in that same stale baseline until the fatal
 * pause latched. Returns null when HEAD carries no readable milestone state.
 */
export function loadCommittedMilestone(cwd = REPO) {
  const r = spawnSync('git show HEAD:specs/implementation/current-milestone.json', {
    shell: true,
    cwd,
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/**
 * Decide which milestone view may drive LAUNCH decisions. The working tree is
 * authoritative for WRITES (chore flips persist there and commit via the git
 * queue), but it is exactly one chore-commit AHEAD of what any new run can see
 * — so while uncommitted flips exist, launching against them deterministically
 * produces preflight refusals (defect #11). Selection therefore decides from
 * the committed view and simply defers one tick when the two disagree or when
 * no committed view exists; the queue drains within seconds, so deferral is
 * bounded and honest.
 */
export function selectionView(fileMs, committedMs) {
  if (!committedMs) return { ms: null, why: 'committed_state_unreadable' };
  const errs = validateMilestoneState(committedMs);
  if (errs.length > 0) return { ms: null, why: `committed_state_invalid: ${errs.join('; ')}` };
  return { ms: committedMs, why: 'ok' };
}

/** Launches performed by one selection pass (V3-B): drives adaptive handoff polling. */
async function selectAndLaunch(st) {
  // Corrupt roadmap/milestone JSON must fail closed (PAUSED_FATAL), never
  // crash-loop the tick or silently re-plan over damaged state.
  let roadmap;
  let ms;
  try {
    roadmap = loadRoadmap(REPO);
    ms = loadCurrentMilestone(REPO);
  } catch (err) {
    pauseFatalCorrupt(st, 'specs/implementation/*.json', err?.message ?? err);
    return 0;
  }
  const rmErrs = validateRoadmap(roadmap);
  if (rmErrs.length) {
    pauseFatalCorrupt(st, 'specs/implementation/roadmap.json', rmErrs.join('; '));
    return 0;
  }

  // Milestone-control due? (nothing planned, or planned milestone fully proven)
  let msErrs = ms ? validateMilestoneState(ms) : ['missing'];
  if (ms && msErrs.length > 0) {
    // CORRUPT STATE FAILS CLOSED: current-milestone.json exists but does not
    // validate. Never silently re-plan over possibly-corrupt implementation
    // state.
    pauseFatalCorrupt(st, 'specs/implementation/current-milestone.json', msErrs.join('; '));
    return 0;
  }
  // Defect #11: launch decisions come from the COMMITTED milestone state —
  // the working tree can be a queued chore-commit ahead of what any freshly
  // materialized run worktree inherits. Uncommitted flips defer selection by
  // one tick (fail-closed) instead of launching against state no run can see.
  // When NEITHER view exists nothing is planned yet — fall through so the
  // milestone-planning-due path below behaves exactly as before.
  const fileMs = ms;
  const view = selectionView(ms, loadCommittedMilestone());
  if (view.ms) ms = view.ms;
  else if (fileMs) {
    record(st, 'selection_deferred_uncommitted_state', { why: view.why });
    return 0;
  }
  const { policy: testPolicy, proof: bunProof } = loadBunMigrationInputs(REPO);
  const barrier = evaluateBunMigrationBarrier({
    policy: testPolicy,
    milestone: ms,
    runtimeState: st.testMigration,
    proof: bunProof,
  });
  st.testMigration = {
    ...(st.testMigration ?? {}),
    status: barrier.state,
    migrationId: testPolicy.migrationId,
    reason: barrier.reason,
  };
  if (barrier.state === 'BUN_MIGRATION_REQUIRED') {
    if (st.maintenanceRuns.some((entry) => !entry.done) || st.pausedFatal) return 0;
    const message = testPolicy.migrationId;
    const ack = launchDetached(
      st,
      testPolicy.migrationWorkflow,
      testPolicy.migrationBranch,
      message,
    );
    const runId = resolveRunId(ack, testPolicy.migrationWorkflow, message);
    st.testMigration.status = 'BUN_MIGRATION_RUNNING';
    st.testMigration.runId = runId;
    record(st, 'bun_migration_launched', {
      workflow: testPolicy.migrationWorkflow,
      branch: testPolicy.migrationBranch,
      runId,
      discovery: extractRunId(ack) ? 'ack' : 'runs-table',
    });
    trackRun(st, 'maintenance', {
      kind: 'maintenance',
      workflow: testPolicy.migrationWorkflow,
      runId,
      branch: testPolicy.migrationBranch,
      message,
      startedAt: now(),
      resumeCount: 0,
      restartCount: 0,
      awaitingDiscovery: !runId,
      discoveryAttempts: 0,
    });
    return 1;
  }
  if (barrier.state === 'BUN_MIGRATION_RUNNING') return 0;
  const milestoneDue = !ms || ms.packages.every((p) => p.status === 'PROVEN');
  if (milestoneDue) {
    if (st.milestoneRuns.length > 0 || st.pausedFatal) return 0;
    const message = 'plan-or-audit-current-milestone';
    const ack = launchDetached(
      st,
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
    return 1;
  }

  // Work-package selection under the concurrency policy (V3-B): candidate
  // ORDER comes once per tick from the C4 critical-path scheduler — every
  // eligibility constraint stays owned by packageEligible + canStartPackage.
  // The loop re-runs canStartPackage against the LIVE running set each
  // iteration and pushes each launch into it, so when policy allows N slots a
  // single tick fills all of them (launch A → re-evaluate against A → launch
  // B in ONE cycle). Foundation G0 stays capped at 1 by the same policy.
  let launched = 0;
  const running = st.activeRuns.map((r) => findPackage(ms, r.packageId)).filter(Boolean);

  // B. MAIN RED GLOBAL BLOCK (V4 Invariant): ONLY verified GREEN origin/main required CI
  // permits a NEW product coding package launch. Everything else fails closed.
  const mainCi = getMainCiStatus({ cwd: REPO });
  if (!mainCi.ok || mainCi.state !== 'GREEN') {
    const reasonKey = `main_ci_not_green|${mainCi.sha ?? 'no_sha'}|${mainCi.state}`;
    if (!coRunDenialSeen.has(reasonKey)) {
      coRunDenialSeen.add(reasonKey);
      log(
        `product package launch blocked: origin/main required CI is not GREEN (state=${mainCi.state}, reason=${mainCi.reason})`,
      );
      record(st, 'product_launch_blocked_by_main_ci', {
        state: mainCi.state,
        reason: mainCi.reason,
        sha: mainCi.sha,
      });
    }
    return 0;
  }

  // C. PROTECTION AUDIT GATE: Branch protection must be verifiably intact
  // before launching new packages. Cached result used within TTL.
  // Does NOT kill active packages — only blocks NEW launches.
  {
    const auditStale = !_auditResult || Date.now() - _auditAt > PROTECTION_AUDIT_TTL_MS;
    if (auditStale) {
      const freshAudit = auditGitHubProtection();
      _auditResult = freshAudit;
      _auditAt = Date.now();
      _auditBlocksLaunches = !freshAudit.ok;
      if (freshAudit.ok) {
        log('protection_audit_refreshed_ok');
      } else {
        log(
          `WARN: protection_audit_refreshed_failed: ${freshAudit.error ?? 'audit properties invalid'}`,
        );
        record(st, 'protection_audit_failed', {
          reason: freshAudit.error ?? 'audit properties invalid',
        });
      }
    }
    if (_auditBlocksLaunches) {
      const auditKey = 'protection_audit_blocks_launch';
      if (!coRunDenialSeen.has(auditKey)) {
        coRunDenialSeen.add(auditKey);
        log(
          'product package launch blocked: GitHub branch protection audit failed or stale — will retry on next tick',
        );
        record(st, 'product_launch_blocked_by_protection_audit', {
          auditOk: _auditResult?.ok,
          auditAt: new Date(_auditAt).toISOString(),
        });
      }
      return 0;
    }
  }

  for (const cand of rankPendingPackages(ms)) {
    if (barrier.state === 'CURRENT_PACKAGE' && cand.id !== testPolicy.barrierAfterPackage) continue;
    // Never re-select a package that already has a tracked active launch or in-flight intent
    if (st.activeRuns.some((r) => r.packageId === cand.id && !r.done)) continue;
    if (isPackageLaunchInFlight(STATE_DIR, cand.id)) continue;
    const elig = packageEligible(ms, cand);
    if (!elig.eligible) continue;
    const verdict = canStartPackage(roadmap, ms, cand, running);
    if (!verdict.ok) {
      // Maintainer observability: a pairwise concurrency refusal is evidence,
      // not noise — record WHY an otherwise-eligible candidate was denied a
      // slot. Once per process for the same package+reason; capacity-limit
      // saturation is healthy and stays silent.
      if (
        !/concurrency limit/.test(verdict.reason) &&
        !coRunDenialSeen.has(`${cand.id}|${verdict.reason}`)
      ) {
        coRunDenialSeen.add(`${cand.id}|${verdict.reason}`);
        record(st, 'co_run_denied', {
          packageId: cand.id,
          reason: verdict.reason,
          running: running.map((r) => r.id),
        });
      }
      continue;
    }
    const { generation, branch, message, workflow: wf, executionProfile } = launchIdentity(cand);
    // Two-Phase Launch Protocol: Phase A (Durable Launch Intent)
    const intent = createLaunchIntent(STATE_DIR, {
      packageId: cand.id,
      generation,
      executionProfile,
      workflow: wf,
      branch,
      sourceSha: mainCi.sha,
    });

    const ack = launchDetached(st, wf, branch, message, executionProfile);
    const runId = resolveRunId(ack, wf, message);

    // Two-Phase Launch Protocol: Phase B (Real Run Association)
    if (runId) {
      associateRunIdWithIntent(STATE_DIR, intent.intentId, runId);
    }

    record(st, 'work_package_launched', {
      packageId: cand.id,
      branch,
      workflow: wf,
      generation,
      executionProfile,
      ack: sanitizeAck(ack),
      runId,
      intentId: intent.intentId,
      discovery: extractRunId(ack) ? 'ack' : 'runs-table',
    });
    trackRun(st, 'package', {
      kind: 'package',
      workflow: wf,
      runId,
      packageId: cand.id,
      branch,
      message,
      startedAt: now(),
      resumeCount: 0,
      restartCount: 0,
      awaitingDiscovery: !runId,
      discoveryAttempts: 0,
      executionProfile,
    });
    if (runId) {
      // Durable run id already in hand → RUNNING now; otherwise it is flipped
      // by actOnPendingAction at discovery time. PENDING→RUNNING never happens
      // without a durable Archon run association. The flip writes the FILE
      // lineage (re-read fresh: it may carry flips newer than the committed
      // selection view) — never the committed snapshot selection used.
      const fileNow = loadCurrentMilestone(REPO);
      if (fileNow) await setPackageStatus(fileNow, cand.id, 'RUNNING');
      reconcileSeedAfterStateChore(st, cand.id, branch);
    }
    running.push(cand);
    launched++;
  }
  return launched;
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

/**
 * Best-effort slice/checkpoint observability (OPTIMIZED profile only): read
 * the run's durable implementation checkpoint from the Archon artifacts
 * workspace and validate it against the files on disk. The checkpoint is
 * CACHE/INDEX — this reports what it CLAIMS plus whether that claim is still
 * provably current. Must NEVER throw; advisory only. Returns null for LEGACY
 * packages, missing run ids, or absent/unreadable checkpoints.
 */
export function checkpointObservability(pkg, runId) {
  if (!runId || typeof runId !== 'string') return null;
  // Generation-aware routing (V3 §8): a package on the optimized topology at
  // ANY generation produces checkpoints; the legacy profile table alone no
  // longer decides.
  if (!usesOptimizedWorkflow(pkg)) return null;
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
        const candidate = join(wsRoot, owner, repo, 'artifacts', runId, CHECKPOINT_FILE);
        if (existsSync(candidate)) {
          file = candidate;
          break search;
        }
      }
    }
    if (!file) return null;
    let cp = null;
    try {
      cp = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { valid: false, reasons: ['checkpoint unreadable'], file };
    }
    const verdict = validateCheckpoint(cp);
    return {
      valid: verdict.valid,
      reasons: verdict.reasons,
      slice: cp.slice?.id ?? null,
      completedTasks: cp.completedTasks ?? null,
      totalTasks: cp.totalTasks ?? null,
      remainingTasks: cp.remainingTasks ?? null,
      file,
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
  if (entry.executionProfile) parts.push(`execution=${entry.executionProfile}`);
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
  const quotaPaused = [
    ...(st.activeRuns ?? []),
    ...(st.milestoneRuns ?? []),
    ...(st.maintenanceRuns ?? []),
  ].find((e) => !e.done && e.paused === 'quota');
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
      const ckpt = run?.runId ? checkpointObservability(p, run.runId) : null;
      const sliceInfo = ckpt
        ? `\n      ↳ checkpoint(${ckpt.valid ? 'valid' : 'INVALID'}): ` +
          `${ckpt.slice ?? 'no slice'} · tasks ${ckpt.completedTasks}/${ckpt.totalTasks} done` +
          (ckpt.valid ? '' : ` — stale: ${ckpt.reasons.join('; ')}`)
        : usesOptimizedWorkflow(p) && run
          ? '\n      ↳ checkpoint: none yet this run'
          : '';
      const genTag = packageGeneration(p) > 0 ? ` gen=${packageGeneration(p)}` : '';
      lines.push(
        `  • ${p.id.padEnd(28)} ${p.status.padEnd(9)} risk=${p.risk.padEnd(8)} profile=${throughputProfile(p.id).padEnd(9)}${genTag} deps=[${(p.dependencies ?? []).join(',')}]${runInfo}${sliceInfo}`,
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
  for (const m of st.maintenanceRuns ?? []) lines.push(`bun-migration: ${describeRun(m)}`);
  lines.push(
    `test migration: ${st.testMigration?.status ?? 'BUN_MIGRATION_REQUIRED'}${st.testMigration?.reason ? ` (${st.testMigration.reason})` : ''}`,
  );
  lines.push(`runtime state: ${STATE_FILE}`);
  return lines.join('\n');
}

// ── main loop ────────────────────────────────────────────────────────────────
function failRestartUsage(why) {
  console.error(
    `RESTART REFUSED: ${why}\n` +
      'usage: node foresift-autopilot.mjs --restart-package <package-id> --fresh-generation [--reason "<text>"] [--salvage-manifest <file>]\n' +
      '(stop the service unit first — the singleton lock enforces it)',
  );
  return 2;
}

/**
 * One supervisory cycle. Returns the number of NEW launches this tick (V3-B):
 * the caller feeds it into nextPollDelayMs for adaptive handoff latency.
 */
async function tick(st) {
  let launched = 0;
  refreshMain();
  // refreshMain ENQUEUES its fetch+ff-pull on the serialized git queue; every
  // decision below (stranded reconciliation, selection, launch identity) reads
  // the working-tree milestone. Selection must never run against the snapshot
  // that pull is about to replace: the first tick after a state-chore merge
  // otherwise sees the PRE-reset milestone and fail-closes on the retired
  // generation instead of launching the fresh one. Drain pending git work
  // first; a failed pull still resolves here and downstream paths keep their
  // existing fail-closed behavior on the stale view.
  await commitQueue.catch(() => {});
  await advanceCiRepairs();
  // Drive any pending state transitions forward one step each (non-blocking).
  // This replaces the old blocking landStateViaPR() polling loop.
  await advanceStateLandings();
  // Reconcile active entries. Paused entries stay tracked (never filtered as
  // done): fatal pauses wait for operator recovery, quota pauses probe on the
  // supervisor-owned schedule.
  for (const entry of [...st.activeRuns, ...st.milestoneRuns, ...st.maintenanceRuns]) {
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
    const done = await actOnEntry(st, entry);
    if (done) entry.done = true;
  }
  st.activeRuns = st.activeRuns.filter((e) => !e.done);
  st.milestoneRuns = st.milestoneRuns.filter((e) => !e.done);
  st.maintenanceRuns = st.maintenanceRuns.filter((e) => !e.done);

  if (!st.pausedFatal) {
    // Restore authoritative tracking BEFORE any new selection: an untracked
    // RUNNING package must count against the concurrency policy this very tick
    // (adopt its live run, or convert it to a tracked pause), never race a
    // second launch past the limit.
    reconcileStrandedPackages(st);
    if (!st.pausedFatal) launched = await selectAndLaunch(st);
  }
  // Post-chore seed reconciliation enqueues behind state-chore pushes on the
  // serialized git queue; drain it and persist whatever it recorded before
  // callers snapshot state (and before --once exits and loses the task).
  await commitQueue.catch(() => {});
  saveState(st);
  return launched;
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
    const pausedEntry = [...st.activeRuns, ...st.milestoneRuns, ...st.maintenanceRuns].find(
      (e) => !e.done && e.paused,
    );
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
  let message = row?.user_message ?? pf.message ?? null;
  if (!workflow || !message)
    return fail(
      'paused state carries neither a readable Archon run nor structured workflow/message identity; repair the underlying cause first',
    );
  const { policy: testRuntimePolicy } = loadBunMigrationInputs(REPO);
  const kind =
    workflow === 'foresift-milestone-control'
      ? 'milestone'
      : workflow === testRuntimePolicy.migrationWorkflow
        ? 'maintenance'
        : 'package';
  const executionProfile =
    kind === 'package' ? (pf.executionProfile ?? resolveExecutionProfile()) : null;
  const forceFreshProfileMigration =
    kind === 'package' &&
    !pf.executionProfile &&
    process.env.FORESIFT_FORCE_PROFILE_MIGRATION === '1';
  let ms = null;
  let pkg = null;
  let branch = pf.branch ?? null;
  if (kind === 'package') {
    try {
      ms = loadCurrentMilestone(REPO);
    } catch (err) {
      return fail(`implementation state unreadable: ${String(err?.message ?? err).slice(0, 200)}`);
    }
    // Paused identity may carry a generation-suffixed correlation message
    // (`<id>@g<N>`); resolve the package record through the parsed id and
    // recompute branch/message from the CURRENT milestone generation.
    const parsed = parseGenerationMessage(message);
    pkg = findPackage(ms, parsed?.packageId ?? message);
    if (!pkg)
      return fail(`no work package '${parsed?.packageId ?? message}' in the current milestone`);
    const ident = launchIdentity(pkg);
    branch = ident.branch;
    if (pf.message && parsed && parsed.generation !== ident.generation)
      return fail(
        `paused identity is generation ${parsed.generation} but current milestone generation for ${pkg.id} is ${ident.generation} — use --restart-package --fresh-generation instead of resuming across generations`,
      );
    if (pf.branch && pf.branch !== branch)
      return fail(`identity mismatch: paused branch ${pf.branch} ≠ expected ${branch}`);
    if (!['RUNNING', 'PENDING'].includes(pkg.status))
      return fail(
        `package ${pkg.id} status is ${pkg.status} (not RUNNING/PENDING) — inspect implementation state manually`,
      );
    // From here on, recovery acts on the CURRENT generation's correlation key.
    message = ident.message;
  } else if (!branch) {
    branch =
      kind === 'maintenance' ? testRuntimePolicy.migrationBranch : 'foresift/milestone-planning';
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
  } else if (
    runId &&
    !forceFreshProfileMigration &&
    ['failed', 'paused', 'cancelled'].includes(String(row?.status))
  ) {
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
    const ack = launchDetached(st, workflow, branch, message, executionProfile);
    record(st, 'operator_recovery_fresh_launch', {
      branch,
      executionProfile,
      ack: sanitizeAck(ack),
    });
    runId = resolveRunId(ack, workflow, message);
  }
  const persistedExecutionProfile =
    kind === 'package'
      ? (pf.executionProfile ?? (resumed ? 'HISTORICAL_V4' : executionProfile))
      : null;
  // Restore authoritative tracking: reuse the retained paused entry if present.
  const list2 =
    kind === 'milestone'
      ? st.milestoneRuns
      : kind === 'maintenance'
        ? st.maintenanceRuns
        : st.activeRuns;
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
      executionProfile: persistedExecutionProfile,
    };
    list2.push(entry);
  }
  Object.assign(entry, {
    runId: runId ?? null,
    awaitingDiscovery: !runId,
    discoveryAttempts: entry.awaitingDiscovery ? (entry.discoveryAttempts ?? 0) : 0,
    executionProfile: entry.executionProfile ?? persistedExecutionProfile,
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
  if (kind === 'package' && pkg.status === 'PENDING') {
    await setPackageStatus(ms, pkg.id, 'RUNNING');
    reconcileSeedAfterStateChore(st, pkg.id, branch);
  }
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

// ── supported operator fresh-restart (V3 §7 / ADR-0009) ─────────────────────
const RECEIPTS_DIR = join(STATE_DIR, 'receipts');
const RESTART_RECEIPT_SCHEMA = 'foresift/restart-receipt@1';
const RESTART_INTENT_SCHEMA = 'foresift/restart-intent@1';

function atomicWriteJson(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, file);
}

/**
 * Seed the generation branch with salvaged product work (override §§11–15).
 *
 * This is the supported deterministic seed/import step: the restart mechanism
 * itself materializes `foresift/<id>-g<N>` strictly at final V3 main
 * (origin/main), transplants verified PRODUCT paths via applySalvage, settles
 * the lockfile through the package manager, and pushes the branch — so the
 * Archon launcher can pin the pre-seeded generation branch instead of creating
 * an unseeded one from main. Never manual git surgery beside a live supervisor.
 *
 * The branch lives in a dedicated linked worktree under the state dir; the
 * product checkout keeps its own branch untouched. Every step adopts prior
 * partial progress (local branch, pushed branch, registered worktree), and the
 * worktree is reset hard before each apply attempt — a rerun after a crash
 * converges on the same applied head.
 */
function seedSalvageGeneration({ packageId, toGeneration, manifest, runInstall = true }) {
  const genBranch = generationBranch(packageId, toGeneration);
  const fetch = sh('git fetch origin --prune');
  if (!fetch.ok) throw new Error(`git fetch failed: ${fetch.err.slice(0, 200)}`);
  const baseSha = sh('git rev-parse origin/main').out;
  if (!baseSha) throw new Error('origin/main unresolved after fetch');

  const revParse = (ref) => {
    const r = sh(`git rev-parse --verify --end-of-options ${ref} --`);
    return r.ok ? r.out : null;
  };
  const localSha = revParse(genBranch);
  const remoteSha = revParse(`origin/${genBranch}`);
  if (localSha && remoteSha && localSha !== remoteSha)
    throw new Error(
      `generation branch ${genBranch} diverged: local ${localSha.slice(0, 10)} vs origin ${remoteSha.slice(0, 10)}`,
    );
  const knownSha = localSha ?? remoteSha;
  if (knownSha) {
    const anc = sh(`git merge-base --is-ancestor ${baseSha} ${knownSha}`);
    if (!anc.ok)
      throw new Error(
        `existing ${genBranch} (${knownSha.slice(0, 10)}) is not descended from final V3 main ${baseSha.slice(0, 10)}`,
      );
  }

  const wtDir = join(STATE_DIR, 'gen-worktrees', `${packageId}-g${toGeneration}`);
  const registered = sh('git worktree list --porcelain')
    .out.split('\n')
    .includes(`worktree ${wtDir}`);
  if (!registered) {
    rmSync(wtDir, { recursive: true, force: true }); // stale unregistered debris
    mkdirSync(dirname(wtDir), { recursive: true });
    // Syntax: git worktree add [-b|-B <branch>] <path> [commit-ish] — the PATH
    // always precedes the start-point.
    const cmd = !knownSha
      ? `git worktree add -b ${genBranch} ${JSON.stringify(wtDir)} ${baseSha}` // fresh at final V3 main
      : localSha
        ? `git worktree add ${JSON.stringify(wtDir)} ${genBranch}` // adopt local branch
        : `git worktree add -B ${genBranch} ${JSON.stringify(wtDir)} ${knownSha}`; // from pushed tip
    const add = sh(cmd);
    if (!add.ok) throw new Error(`git worktree add failed: ${(add.err || add.out).slice(0, 300)}`);
  }
  // Deterministic apply attempt: always start from the committed branch tip.
  const rst = sh(`git -C ${JSON.stringify(wtDir)} reset --hard`);
  if (!rst.ok) throw new Error(`worktree reset failed: ${rst.err.slice(0, 200)}`);
  sh(`git -C ${JSON.stringify(wtDir)} clean -fdx`);

  const result = applySalvage({
    repoRoot: wtDir,
    manifest,
    genBranch,
    baseRef: baseSha,
    installMode: runInstall ? 'lockfile-only' : 'none',
  });

  const push = sh(`git -C ${JSON.stringify(wtDir)} push -u origin ${genBranch}`);
  if (!push.ok)
    throw new Error(`push of ${genBranch} failed: ${(push.err || push.out).slice(0, 300)}`);
  log('salvage_generation_seeded', {
    packageId,
    toGeneration,
    branch: genBranch,
    appliedHead: result.appliedHead,
  });
  const s = manifest.summary ?? {};
  return {
    appliedHead: result.appliedHead,
    renames: Object.keys(result.renames ?? {}),
    manifestReconciliation: result.manifestReconciliation,
    taskReconstruction: result.taskReconstruction,
    reusedCommits: s.commitsFullyProduct ?? null,
    partiallyReusedCommits: s.commitsMixed ?? null,
    // Everything not carried wholesale (control-plane-only, empty, unknown):
    rejectedCommits:
      s.commitsTotal != null
        ? Math.max(0, s.commitsTotal - (s.commitsFullyProduct ?? 0) - (s.commitsMixed ?? 0))
        : null,
  };
}

/**
 * Deterministic, idempotent, crash-safe fresh-generation restart of ONE work
 * package (V3 task spec §7). Never hand-edits state JSON: every mutation goes
 * through the same formatting/versioned-commit machinery the supervisor uses.
 *
 *   node foresift-autopilot.mjs --restart-package <id> --fresh-generation \
 *        [--reason "<text>"] [--salvage-manifest <file>]
 *
 * Crash safety: an intent record naming the exact target generation is written
 * BEFORE any mutation, and every crash window converges (V3 §30 matrix):
 *   · crash BEFORE the generation persist  → rerun recomputes the same target,
 *     finds the matching intent, and adopts it (never re-increments);
 *   · crash AFTER the persist, BEFORE the receipt → the intent's target now
 *     EQUALS the milestone generation; the flow resumes at that generation and
 *     finishes the interrupted paperwork (refused instead if that generation
 *     already shows launch evidence — history must never be backfilled);
 *   · crash AFTER the receipt write → the target-generation receipt replays
 *     and consumes any surviving intent.
 * A second identical invocation after completion replays the receipt and exits
 * 0 without creating another generation.
 */
/**
 * Supported deterministic finalization (defect #16 follow-up): RUNNING ->
 * PROVEN for a package whose implementation ALREADY landed on main through an
 * out-of-band merged PR. The full fail-closed proof standard lives in
 * finalize-from-main.mjs; this command mutates ONLY on an ok verdict, and
 * then exclusively through the control plane's own version-controlled state
 * chore path (setPackageStatus) plus supervisor bookkeeping reconciliation.
 * No AI provider is ever invoked; nothing is reimplemented; every refusal
 * leaves all state untouched. Run with the service STOPPED (lock discipline).
 */
async function cmdFinalizeFromMain(packageId, opts = {}) {
  if (!packageId) {
    console.error('usage: --finalize-from-main <package-id>  (stop the service unit first)');
    return 1;
  }
  const st = loadState();
  const facts = await collectFinalizationFacts(packageId, REPO, {
    activeRuns: st.activeRuns,
    milestoneRuns: st.milestoneRuns,
    pausedFatal: st.pausedFatal,
    operatorCiBypassReason: opts.operatorCiBypassReason ?? null,
  });
  const verdict = evaluateFinalizationFromMain(facts);
  if (!verdict.ok) {
    console.error(`REFUSED: cannot finalize ${packageId} from main:`);
    for (const r of verdict.reasons) console.error(`  - ${r}`);
    record(st, 'finalize_from_main_refused', { packageId, reasons: verdict.reasons });
    saveState(st);
    return 1;
  }
  const ms = loadCurrentMilestone(REPO);
  await setPackageStatus(ms, packageId, 'PROVEN');
  if (verdict.evidence.terminalPauseRetired) st.pausedFatal = null;
  // Reconcile this package's own supervisor tracking rows — their run is
  // terminal (the evaluator refused any live one); retaining them would make
  // selection skip a PROVEN package's slot forever.
  for (const list of [st.activeRuns, st.milestoneRuns]) {
    for (const e of list) {
      if ((e.packageId ?? null) === packageId && !e.done) {
        e.done = true;
        e.note = 'finalized-from-main';
      }
    }
  }
  record(st, 'package_finalized_from_main', { packageId, ...verdict.evidence });
  saveState(st);
  await commitQueue; // let the PROVEN state chore land before this one-shot exits
  log(
    `FINALIZED ${packageId} -> PROVEN from merged truth: PR #${verdict.evidence.pr.number}, main ${String(
      verdict.evidence.mainSha ?? '',
    ).slice(0, 7)}, CI ${verdict.evidence.ci.databaseId}`,
  );
  return 0;
}

async function cmdRestartPackage(packageId, opts = {}) {
  const reason = String(opts.reason ?? 'unspecified').slice(0, 300);
  const fail = (msg) => {
    console.error(`RESTART REFUSED: ${msg}`);
    log('fresh_restart_package_refused', { packageId, why: msg });
    return 1;
  };
  let ms;
  try {
    ms = loadCurrentMilestone(REPO);
  } catch (err) {
    return fail(`implementation state unreadable: ${String(err?.message ?? err).slice(0, 200)}`);
  }
  const errs = validateMilestoneState(ms);
  if (errs.length > 0)
    return fail(`implementation state invalid: ${errs.join('; ').slice(0, 300)}`);
  const pkg = findPackage(ms, packageId);
  if (!pkg) return fail(`no work package '${packageId}' in the current milestone`);
  const fromGeneration = packageGeneration(pkg);
  const st = loadState();
  const intentFile = join(STATE_DIR, `restart-intent-${packageId}.json`);

  // Crash recovery: adopt the recorded intent verbatim (never re-increment).
  let intent = null;
  try {
    const raw = JSON.parse(readFileSync(intentFile, 'utf8'));
    if (raw?.schema === RESTART_INTENT_SCHEMA && raw.packageId === packageId) intent = raw;
  } catch {
    /* none yet */
  }

  // Resolve the target generation. Default: one past the current. V3 §30 Case
  // C — an intent whose TARGET equals the generation the milestone ALREADY
  // carries (and whose origin is exactly one behind it) proves the
  // generation-bump persist completed before the crash: finish THAT generation
  // instead of computing a fresh bump. Any other intent shape is an anomaly;
  // its refusal stays deferred to the safety-refusal section below so the
  // refusal priority (live-run first) is preserved.
  let toGeneration = fromGeneration + 1;
  let intentAnomaly = null;
  if (
    intent &&
    !(intent.toGeneration === toGeneration && intent.fromGeneration === fromGeneration) &&
    !(intent.toGeneration === fromGeneration && intent.fromGeneration === fromGeneration - 1)
  ) {
    intentAnomaly = `stale intent targets generation ${intent.toGeneration} but milestone state implies ${toGeneration}; inspect ${intentFile} and ${STATE_FILE}`;
  } else if (
    intent &&
    intent.toGeneration === fromGeneration &&
    intent.fromGeneration === fromGeneration - 1
  ) {
    toGeneration = fromGeneration; // interrupted flow resumes at the persisted generation
  }

  // Fail closed on an explicitly provided salvage manifest BEFORE touching
  // anything: an unreadable or foreign-schema manifest must abort the restart,
  // never degrade into a receipt with null provenance.
  let salvageManifest = null;
  if (opts.salvageManifestPath) {
    try {
      const m = JSON.parse(readFileSync(opts.salvageManifestPath, 'utf8'));
      if (m?.schema !== SALVAGE_MANIFEST_SCHEMA)
        return fail(
          `salvage manifest ${opts.salvageManifestPath} has schema ${String(m?.schema)} ≠ ${SALVAGE_MANIFEST_SCHEMA}`,
        );
      if (m.packageId && m.packageId !== packageId)
        return fail(`salvage manifest is for package ${m.packageId}, not ${packageId}`);
      salvageManifest = m;
    } catch (err) {
      return fail(
        `salvage manifest ${opts.salvageManifestPath} unreadable: ${String(err?.message ?? err).slice(0, 200)}`,
      );
    }
  }

  // Idempotency: a completed receipt for THIS target generation ends the flow
  // (covers the crash window between receipt write and intent deletion).
  const receiptFile = join(RECEIPTS_DIR, `${packageId}-g${toGeneration}.json`);
  const replay = (receipt, why) => {
    console.log(JSON.stringify(receipt, null, 2));
    // Consume any surviving restart intent: replaying a COMPLETED restart must
    // not leave an intent on disk whose toGeneration no longer matches what a
    // FUTURE genuine restart will compute (it would refuse them all).
    try {
      unlinkSync(intentFile);
    } catch {}
    log('fresh_restart_receipt_replayed', { packageId, toGeneration: receipt.toGeneration, why });
    return 0;
  };
  try {
    const existing = JSON.parse(readFileSync(receiptFile, 'utf8'));
    if (existing?.schema === RESTART_RECEIPT_SCHEMA && existing?.toGeneration === toGeneration)
      return replay(existing, 'target-generation-receipt-exists');
  } catch {
    /* no prior receipt — proceed */
  }

  // A CURRENT-generation live run blocks retirement (§7): resolve it first.
  // Safety refusals deliberately precede every replay/idempotency path —
  // something being live must never be papered over by a friendly no-op.
  const currentMessage = generationMessage(packageId, fromGeneration);
  const list = archonJson('workflow runs --json --limit 50');
  const rows = Array.isArray(list) ? list : (list?.runs ?? []);
  // A tracked-but-unresolved row must not block a restart forever once Archon
  // PROVES its run terminal — the only other supported unblock is a supervisor
  // tick, whose same-tick reconcile→selectAndLaunch order would relaunch retired
  // generation 0. Reconcile proven-terminal rows here; anything live or
  // undiscoverable still refuses fail-closed.
  const trackedLive = st.activeRuns.find((r) => r.packageId === packageId && !r.done && !r.paused);
  if (trackedLive) {
    const row = trackedLive.runId ? rows.find((x) => x.id === trackedLive.runId) : null;
    if (!row || ['running', 'pending'].includes(String(row.status)))
      return fail(
        `a tracked active run (${trackedLive.runId ?? 'awaiting discovery'}) exists for ${packageId}; stop/abandon it first`,
      );
    // Drop the row outright (the flow-end filter would anyway): later paths
    // include friendly replays (§7 duplicate gate) that return without
    // touching state — reconciliation must survive them on disk, or every
    // future invocation would re-refuse on the same stale row.
    st.activeRuns = st.activeRuns.filter((r) => r !== trackedLive);
    record(st, 'restart_reconciled_terminal_tracked_run', {
      packageId,
      runId: trackedLive.runId,
      archonStatus: String(row.status),
    });
    saveState(st);
  }
  const liveCurrent = rows.filter(
    (r) => r.user_message === currentMessage && ['running', 'pending'].includes(String(r.status)),
  );
  if (liveCurrent.length > 0)
    return fail(
      `current-generation run(s) still live: ${liveCurrent.map((r) => r.id).join(', ')} — abandon them first`,
    );

  if (intentAnomaly) {
    // An anomaly on disk must surface as a refusal, not be masked by a
    // friendly no-op. This check deliberately precedes the duplicate-invocation
    // replay below.
    return fail(intentAnomaly);
  }
  if (intent && toGeneration === fromGeneration && fromGeneration > 0) {
    // Case-C resume, but the "interrupted" generation already EXECUTED — its
    // receipt is missing while launch evidence exists. That combination means
    // history diverged from the paperwork; backfilling a completion receipt
    // would launder an unrecorded lifecycle. Refuse for operator inspection.
    const launchedTarget =
      (st.history ?? []).some(
        (h) =>
          h.event === 'work_package_launched' &&
          h.packageId === packageId &&
          Number(h.generation ?? -1) >= fromGeneration,
      ) ||
      [...(st.activeRuns ?? []), ...(st.milestoneRuns ?? [])].some((e) => {
        const p = parseGenerationMessage(e.message ?? '');
        return p?.packageId === packageId && p.generation >= fromGeneration;
      });
    if (launchedTarget)
      return fail(
        `generation ${fromGeneration} shows launch evidence but its restart receipt is missing — refusing to backfill a completed generation; inspect ${RECEIPTS_DIR} and ${STATE_FILE}`,
      );
  }

  // §7 hard rule: the second identical invocation cannot create generation 2.
  // After a completed restart the milestone sits at the NEW generation while
  // its receipt records the OLD→NEW transition; a naive rerun would compute a
  // fresh target and double-bump. So when a receipt already exists for the
  // CURRENT generation AND that generation never launched anything since, this
  // invocation is a duplicate of an already-completed restart: replay it. A
  // genuine re-restart after the generation actually executed finds launch
  // evidence and proceeds; --confirm-new-generation overrides deliberately.
  if (!intent && fromGeneration > 0 && !opts.confirmNewGeneration) {
    try {
      const prior = JSON.parse(
        readFileSync(join(RECEIPTS_DIR, `${packageId}-g${fromGeneration}.json`), 'utf8'),
      );
      if (prior?.schema === RESTART_RECEIPT_SCHEMA && prior?.toGeneration === fromGeneration) {
        const launchedSince =
          (st.history ?? []).some(
            (h) =>
              h.event === 'work_package_launched' &&
              h.packageId === packageId &&
              Number(h.generation ?? -1) >= fromGeneration,
          ) ||
          [...(st.activeRuns ?? []), ...(st.milestoneRuns ?? [])].some((e) => {
            const p = parseGenerationMessage(e.message ?? '');
            return p?.packageId === packageId && p.generation >= fromGeneration;
          });
        if (!launchedSince)
          return replay(
            prior,
            `generation ${fromGeneration} was created but never launched; re-running --restart-package now would be a duplicate`,
          );
      }
    } catch {
      /* no prior receipt for the current generation */
    }
  }

  if (!intent) {
    intent = {
      schema: RESTART_INTENT_SCHEMA,
      packageId,
      fromGeneration,
      toGeneration,
      reason,
      startedAt: new Date().toISOString(),
    };
    if (opts.salvageManifestPath) intent.salvageManifest = opts.salvageManifestPath;
    atomicWriteJson(intentFile, intent);
  }

  // Retire every OLDER-generation run row (supported lifecycle, best-effort —
  // a refused abandon of an already-terminal row cannot block retirement).
  const retiredRuns = [];
  for (let g = 0; g <= fromGeneration; g++) {
    const msg = g === 0 ? packageId : generationMessage(packageId, g);
    for (const r of rows.filter((x) => x.user_message === msg)) {
      const ab = ['running', 'pending'].includes(String(r.status))
        ? archonJson(`workflow abandon ${r.id} --json`)
        : { ok: true, skipped: true, status: r.status };
      retiredRuns.push({
        runId: r.id,
        generation: g,
        statusBefore: r.status,
        response: sanitizeAck(ab),
      });
    }
  }

  // Clear ONLY this package's tracking/pause state (V3 §7).
  st.activeRuns = st.activeRuns.filter((r) => r.packageId !== packageId);
  if (
    st.pausedFatal &&
    (st.pausedFatal.packageId === packageId ||
      parseGenerationMessage(st.pausedFatal.message ?? '')?.packageId === packageId)
  ) {
    st.pausedFatal = null;
    record(st, 'fatal_pause_cleared_by_restart', { packageId });
  }

  // Persist generation + PENDING through the normal versioned-commit path.
  // setPackageStatus alone would short-circuit when the package is ALREADY
  // PENDING (the common restart case) and silently drop the generation bump,
  // so the unconditional writer backs it up.
  const transitionFrom = intent.fromGeneration;
  if (!isSupportedNextGeneration(transitionFrom, toGeneration))
    return failRestartUsage(
      `unsupported generation transition ${transitionFrom}->${toGeneration}; only one deterministic next-generation bump is supported`,
    );
  const generationAlreadyPersisted =
    toGeneration === fromGeneration && transitionFrom === fromGeneration - 1;
  if (!generationAlreadyPersisted) {
    pkg.generation = toGeneration;
    if (!(await setPackageStatus(ms, packageId, 'PENDING')))
      await persistMilestoneState(
        ms,
        `chore(autopilot): ${ms.milestoneId}/${packageId} -> generation ${toGeneration} (fresh restart)`,
      );
    await new Promise((res) => {
      commitQueue = commitQueue.then(res, res);
    });
    saveState(st);
    console.log(
      JSON.stringify(
        {
          schema: 'foresift/restart-pending@1',
          packageId,
          fromGeneration: transitionFrom,
          toGeneration,
          status: 'WAITING_FOR_PROTECTED_STATE_MERGE',
        },
        null,
        2,
      ),
    );
    return 0;
  }

  // Seed the generation branch from salvaged product work (override §11–15).
  let salvageSeed = null;
  if (salvageManifest) {
    try {
      salvageSeed = seedSalvageGeneration({
        packageId,
        toGeneration,
        manifest: salvageManifest,
        runInstall: !process.env.FORESIFT_SALVAGE_SKIP_INSTALL,
      });
    } catch (err) {
      return fail(
        `salvage seed failed (state already advanced; rerun resumes): ${String(err?.message ?? err).slice(0, 400)}`,
      );
    }
  }

  // Receipt (atomic) — includes salvage provenance when a manifest was given.
  // A Case-C resume records the ORIGINAL interrupted transition (intent
  // origin → persisted generation), which is the restart this paperwork backs.
  const receipt = {
    schema: RESTART_RECEIPT_SCHEMA,
    packageId,
    retiredGeneration: transitionFrom,
    toGeneration,
    reason,
    retiredBranch: generationBranch(packageId, transitionFrom),
    generationBranch: generationBranch(packageId, toGeneration),
    retiredRunIds: retiredRuns.map((r) => r.runId),
    retiredRuns,
    finalV3MainHead: sh('git rev-parse origin/main').out || null,
    timestamp: new Date().toISOString(),
    ...(salvageSeed
      ? {
          sourceSalvagePr: salvageManifest.sourceSalvagePr ?? null,
          sourceSalvageBranch: salvageManifest.sourceSalvageBranch ?? null,
          sourceSalvageHead: salvageManifest.sourceSalvageHead ?? null,
          generationSeedHead: salvageSeed.appliedHead,
          reusedCommits: salvageSeed.reusedCommits ?? null,
          partiallyReusedCommits: salvageSeed.partiallyReusedCommits ?? null,
          rejectedCommits: salvageSeed.rejectedCommits ?? null,
          reusedTaskCount: salvageSeed.taskReconstruction?.reused ?? null,
          reopenedTaskCount: salvageSeed.taskReconstruction?.reopened ?? null,
          remainingTaskCount: salvageSeed.taskReconstruction?.remaining ?? null,
        }
      : buildSalvageReceiptFields(opts.salvageManifestPath)),
  };
  atomicWriteJson(receiptFile, receipt);
  try {
    unlinkSync(intentFile);
  } catch {}
  saveState(st);
  console.log(JSON.stringify(receipt, null, 2));
  log('fresh_restart_package_complete', { packageId, toGeneration });
  return 0;
}

/** Optional salvage-provenance fields for the receipt (override §16). */
function buildSalvageReceiptFields(manifestPath) {
  if (!manifestPath) return {};
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return {
      sourceSalvagePr: m.sourceSalvagePr ?? null,
      sourceSalvageBranch: m.sourceSalvageBranch ?? null,
      sourceSalvageHead: m.sourceSalvageHead ?? null,
      generationSeedHead: m.appliedHead ?? m.seedHead ?? null,
      reusedCommits: m.reusedCommits ?? null,
      partiallyReusedCommits: m.partiallyReusedCommits ?? null,
      rejectedCommits: m.rejectedCommits ?? null,
      reusedTaskCount: m.taskReconstruction?.reused ?? null,
      reopenedTaskCount: m.taskReconstruction?.reopened ?? null,
      remainingTaskCount: m.taskReconstruction?.remaining ?? null,
    };
  } catch (err) {
    return { salvageManifestError: String(err?.message ?? err).slice(0, 200) };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const profileIndex = argv.indexOf('--execution-profile');
  if (profileIndex >= 0) {
    const profile = resolveExecutionProfile(argv[profileIndex + 1]);
    process.env.FORESIFT_EXECUTION_PROFILE = profile;
    process.env.FORESIFT_FORCE_PROFILE_MIGRATION = '1';
  }
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
    // Dropping the entries the pause owned is part of clearing it. A retained
    // fatal-paused row occupies its package's selection slot forever
    // (selection skips candidates with a non-done tracked row), and once the
    // milestone has moved generations such a row is neither resumable
    // (--recover-fatal refuses cross-generation recovery) nor splicable
    // (terminal-row reconciliation ignores paused rows) — a permanent
    // deadlock. Stranded reconciliation rebuilds whatever tracking is still
    // warranted against current truth on the next tick; the orphan refusal
    // above already guarded the RUNNING-without-live-track case.
    const dropped = [...st.activeRuns, ...st.milestoneRuns, ...st.maintenanceRuns].filter(
      (e) => e.paused === 'fatal',
    );
    st.activeRuns = st.activeRuns.filter((e) => e.paused !== 'fatal');
    st.milestoneRuns = st.milestoneRuns.filter((e) => e.paused !== 'fatal');
    st.maintenanceRuns = st.maintenanceRuns.filter((e) => e.paused !== 'fatal');
    record(st, 'fatal_pause_entries_dropped', {
      count: dropped.length,
      packageIds: dropped.map((e) => e.packageId ?? null),
    });
    saveState(st);
    log(
      `fatal pause cleared by operator (no RUNNING package orphaned; ${dropped.length} paused entr${dropped.length === 1 ? 'y' : 'ies'} dropped)`,
    );
    return; // one-shot maintenance command; systemd restarts the loop separately
  }
  if (argv.includes('--recover-fatal')) {
    const positional = argv.filter(
      (a, i) => !a.startsWith('--') && argv[i - 1] !== '--execution-profile',
    );
    process.exit(await cmdRecoverFatal(positional[0] ?? null));
  }
  if (argv.includes('--finalize-from-main')) {
    const positional = argv.filter((a) => !a.startsWith('--'));
    const bypassIndex = argv.indexOf('--operator-ci-bypass-reason');
    const operatorCiBypassReason = bypassIndex >= 0 ? argv[bypassIndex + 1] : null;
    if (bypassIndex >= 0 && (!operatorCiBypassReason || operatorCiBypassReason.startsWith('--'))) {
      console.error('--operator-ci-bypass-reason requires a non-empty audit reason');
      process.exit(2);
    }
    process.exit(await cmdFinalizeFromMain(positional[0] ?? null, { operatorCiBypassReason }));
  }
  if (argv.includes('--seed-package-planning')) {
    // Operator/maintenance form of the handoff promotion step: snapshot ONE
    // package's scoped planning artifacts from an explicit source tree into
    // a protected control-plane PR. Same deterministic code path the
    // supervisor's planningBootstrapHandoff uses internally.
    const fromIdx = argv.indexOf('--from');
    const positional = argv.filter((a) => !a.startsWith('--'));
    if (!positional[0] || fromIdx === -1 || !argv[fromIdx + 1]) {
      console.error(
        'usage: node foresift-autopilot.mjs --seed-package-planning <package-id> --from <source-tree-root>',
      );
      process.exit(2);
    }
    const res = promotePackagePlanningArtifacts(positional[0], argv[fromIdx + 1]);
    await commitQueue.catch(() => {});
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok || res.pending ? 0 : 1);
  }
  if (argv.includes('--restart-package')) {
    if (!argv.includes('--fresh-generation'))
      process.exit(failRestartUsage('only --fresh-generation restarts are supported (V3 §7)'));
    // Positional extraction must skip VALUED flags (--reason "<text>",
    // --salvage-manifest <f>) — their values otherwise masquerade as
    // positional package ids.
    const valuedFlags = new Set(['--reason', '--salvage-manifest']);
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
      if (valuedFlags.has(argv[i])) {
        i++;
        continue;
      }
      if (!argv[i].startsWith('--')) positional.push(argv[i]);
    }
    if (positional.length !== 1)
      process.exit(failRestartUsage('exactly one explicit <package-id> is required'));
    const optOf = (flag) => {
      const i = argv.indexOf(flag);
      return i >= 0 ? argv[i + 1] : undefined;
    };
    process.exit(
      await cmdRestartPackage(positional[0], {
        reason: optOf('--reason'),
        salvageManifestPath: optOf('--salvage-manifest'),
        confirmNewGeneration: argv.includes('--confirm-new-generation'),
      }),
    );
  }
  const once = argv.includes('--once');
  const st = loadState();
  record(st, 'supervisor_started', { pid: process.pid });

  // ── Protection audit at startup ────────────────────────────────────────────
  // Audit branch protection immediately. Fail-closed for NEW launches.
  // Never kills active packages. Results cached for PROTECTION_AUDIT_TTL_MS.
  {
    const audit = auditGitHubProtection();
    _auditResult = audit;
    _auditAt = Date.now();
    _auditBlocksLaunches = !audit.ok;
    if (audit.ok) {
      log(
        'protection_audit_ok',
        JSON.stringify({
          enforceAdmins: audit.enforceAdmins,
          strictChecks: audit.strictChecks,
          checkFound: audit.checkFound,
          appIdMatches: audit.appIdMatches,
        }),
      );
    } else {
      log(
        `WARN: protection_audit_failed — new product launches blocked until audit passes: ${audit.error ?? JSON.stringify({ enforceAdmins: audit.enforceAdmins, strictChecks: audit.strictChecks, checkFound: audit.checkFound, appIdMatches: audit.appIdMatches })}`,
      );
      record(st, 'protection_audit_failed', { reason: audit.error ?? 'audit properties invalid' });
    }
  }

  // ── Launch-intent & State-landing crash recovery ───────────────────────────
  // On startup, reconcile any pending launch intents with Archon runs,
  // and discover any pending state-transition receipts to resume landing.
  {
    const runsList = archonJson('workflow runs --json --limit 50');
    const archonRuns = Array.isArray(runsList)
      ? runsList
      : Array.isArray(runsList?.runs)
        ? runsList.runs
        : [];
    const intentRecovery = reconcileLaunchIntentsOnStartup(STATE_DIR, {
      archonRuns,
      milestoneState: loadCurrentMilestone(REPO),
      log,
    });
    if (intentRecovery.adopted.length > 0 || intentRecovery.dangling.length > 0) {
      record(st, 'launch_intent_crash_recovery', {
        adopted: intentRecovery.adopted.length,
        dangling: intentRecovery.dangling.length,
      });
    }

    const recoveryResults = await recoverPendingStateLandings({
      stateDir: STATE_DIR,
      cwd: REPO,
      log,
    });
    if (recoveryResults.length > 0) {
      record(st, 'state_landing_crash_recovery', {
        count: recoveryResults.length,
        adopted: recoveryResults.filter((r) => r.adopted).length,
      });
    }
  }

  // V3-B §18 adaptive handoff: fast-poll right after launches / during run-id
  // discovery, base cadence otherwise (see nextPollDelayMs).
  let fastStreak = 0;
  do {
    let launched = 0;
    try {
      launched = await tick(st);
    } catch (err) {
      record(st, 'tick_error', { message: String(err?.message ?? err).slice(0, 300) });
      saveState(st);
    }
    if (!once) {
      // §49 fast-wake signals: ACTIVE work = any live/paused tracked entry;
      // ready work = a PENDING package whose dependencies are all PROVEN
      // (i.e. the ready queue the next tick can legally pull from).
      const trackedEntries = [...st.activeRuns, ...st.milestoneRuns, ...st.maintenanceRuns];
      const activeWork = trackedEntries.some((r) => !r.done);
      let readyWork = false;
      if (!activeWork && !st.pausedFatal) {
        try {
          const ms = loadCurrentMilestone(REPO);
          readyWork = Boolean(
            ms &&
              ms.packages.some(
                (p) =>
                  (p.status ?? 'PENDING') === 'PENDING' &&
                  (p.dependencies ?? []).every((d) => findPackage(ms, d)?.status === 'PROVEN'),
              ),
          );
        } catch {
          readyWork = false;
        }
      }
      const next = nextPollDelayMs({
        launched,
        awaitingDiscovery: trackedEntries.some((r) => !r.done && r.awaitingDiscovery),
        fastStreak,
        activeWork,
        readyWork,
      });
      fastStreak = next.fastStreak;
      await sleep(next.delayMs);
    }
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
