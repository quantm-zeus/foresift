#!/usr/bin/env node
// ci-repair-executor.mjs — Deterministic CI repair router and executor.
//
// Consumes a CI incident capsule and executes the appropriate bounded repair:
//
//   FORMAT:   deterministic prettier --write on whitelisted files only
//   INFRA:    bounded backoff retry, ZERO AI turns
//   CODEX:    emit routing instruction (Codex owns product repair)
//   AGY:      emit routing instruction (AGY owns test repair)
//   SPEC:     emit maintainer incident capsule, halt
//   UNKNOWN:  escalate to maintainer
//
// This is NOT a new supervisor. It is called by package-land.mjs after CI red
// and executes EXACTLY ONE bounded repair step, then returns.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';

/** Maximum repair attempts before mandatory escalation. */
export const MAX_REPAIR_ATTEMPTS = 2;

/** Infrastructure retry budget (bounded, zero AI). */
export const MAX_INFRA_RETRIES = 3;
export const INFRA_BACKOFF_BASE_MS = 30_000;

// ── PATH OWNERSHIP GUARDS ────────────────────────────────────────────────────
// FORMAT repair MUST NOT touch product source or test files.
// Only explicitly whitelisted paths are safe for mechanical formatting.

const FORMAT_SAFE_PATTERNS = [
  // State/planning files
  /^specs\/implementation\//,
  /^specs\/g0-[a-zA-Z0-9_-]+\//,
  // Evidence/manifest files that land via state chore
  /^evidence\//,
];

function isFormatSafePath(filePath) {
  return FORMAT_SAFE_PATTERNS.some((p) => p.test(filePath));
}

// ── Shell helpers ─────────────────────────────────────────────────────────────
function shSync(cmd, args, { cwd, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd });
  if (!allowFail && r.status !== 0) {
    const err = (r.stderr ?? '').trim() || (r.stdout ?? '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}): ${err}`);
  }
  return {
    ok: r.status === 0,
    out: (r.stdout ?? '').trim(),
    err: (r.stderr ?? '').trim(),
    status: r.status,
  };
}

// ── Repair attempt persistence ────────────────────────────────────────────────
/**
 * Load the current repair attempt count for an incident capsule.
 * Persists durably so supervisor restarts don't reset the budget.
 */
export function loadRepairAttempts(incidentFilePath) {
  try {
    const capsule = JSON.parse(readFileSync(incidentFilePath, 'utf8'));
    return capsule.repairAttempts ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Increment and persist the repair attempt counter in the incident capsule.
 * Returns the new count.
 */
export function incrementRepairAttempts(incidentFilePath) {
  try {
    const capsule = JSON.parse(readFileSync(incidentFilePath, 'utf8'));
    capsule.repairAttempts = (capsule.repairAttempts ?? 0) + 1;
    capsule.lastRepairAttemptAt = new Date().toISOString();
    writeFileSync(incidentFilePath, JSON.stringify(capsule, null, 2) + '\n');
    return capsule.repairAttempts;
  } catch {
    return 1;
  }
}

// ── FORMAT repair ────────────────────────────────────────────────────────────
/**
 * Execute deterministic formatting repair.
 *
 * Requirements (Task Spec §16):
 * - File must appear in CI FORMAT failure evidence
 * - File must already be part of current PR changed-file set
 * - Formatter may modify ONLY those files
 * - Actual diff after formatter must remain within that exact set
 * - ZERO AI calls.
 */
export function executeFormatRepair({
  failedFiles = [],
  prChangedFiles = [],
  worktreeDir,
  branch,
  log = console.log,
} = {}) {
  // If failedFiles is empty, do not run broad whole-repo formatter
  if (failedFiles.length === 0) {
    return {
      ok: false,
      newHead: null,
      reason: 'FORMAT repair: no safe targets identified',
    };
  }

  // If prChangedFiles is not provided, enforce FORMAT_SAFE_PATTERNS
  if (prChangedFiles.length === 0) {
    const unsafe = failedFiles.filter((f) => !isFormatSafePath(f));
    if (unsafe.length > 0) {
      return {
        ok: false,
        newHead: null,
        reason: `FORMAT repair refused: non-safe paths in diff scope: ${unsafe.join(', ')}`,
      };
    }
  }

  // Intersect with prChangedFiles if provided
  let targets = failedFiles;
  if (prChangedFiles.length > 0) {
    targets = failedFiles.filter((f) => prChangedFiles.includes(f));
    if (targets.length === 0) {
      return {
        ok: false,
        newHead: null,
        reason: 'FORMAT repair: failed files not in PR changed files set',
      };
    }
  }

  // Check that target files exist in worktree
  const existingTargets = targets.filter((f) => existsSync(join(worktreeDir, f)));
  if (existingTargets.length === 0) {
    return {
      ok: false,
      newHead: null,
      reason: 'FORMAT repair: none of target files exist in worktree',
    };
  }

  log(
    `FORMAT repair: running prettier on ${existingTargets.length} target(s): ${existingTargets.join(', ')}`,
  );
  const prettierArgs = [
    '--no-install',
    'prettier',
    '--write',
    '--log-level',
    'warn',
    ...existingTargets,
  ];
  const fmt = shSync('npx', prettierArgs, { cwd: worktreeDir, allowFail: true });
  if (!fmt.ok) {
    log(`FORMAT repair: prettier returned: ${fmt.err || fmt.out}`);
  }

  // Check git diff
  const diff = shSync('git', ['diff', '--name-only'], {
    cwd: worktreeDir,
    allowFail: true,
  });
  const changedFiles = diff.out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (changedFiles.length === 0) {
    return {
      ok: false,
      newHead: null,
      reason: 'FORMAT repair: prettier made no changes (files already formatted)',
    };
  }

  // Verify actual diff stays within the target set
  const outOfBounds = changedFiles.filter((f) => !existingTargets.includes(f));
  if (outOfBounds.length > 0) {
    // Roll back changes
    shSync('git', ['checkout', '--', ...changedFiles], { cwd: worktreeDir, allowFail: true });
    return {
      ok: false,
      newHead: null,
      reason: `FORMAT repair: aborting — formatter modified files outside allowed set: ${outOfBounds.join(', ')}`,
    };
  }

  // Stage changed files
  try {
    shSync('git', ['add', '--', ...changedFiles], { cwd: worktreeDir });
    shSync(
      'git',
      [
        '-c',
        'user.name=Foresift Formatter',
        '-c',
        'user.email=formatter@foresift.local',
        'commit',
        '-m',
        'fix(format): automated prettier repair',
        '--quiet',
      ],
      { cwd: worktreeDir },
    );
  } catch (e) {
    shSync('git', ['reset', '--quiet'], { cwd: worktreeDir, allowFail: true });
    return { ok: false, newHead: null, reason: `commit failed: ${e.message}` };
  }

  // Push new HEAD
  try {
    shSync('git', ['push', 'origin', branch, '--quiet'], { cwd: worktreeDir });
  } catch (e) {
    return { ok: false, newHead: null, reason: `push failed: ${e.message}` };
  }

  const newHead = shSync('git', ['rev-parse', 'HEAD'], { cwd: worktreeDir, allowFail: true }).out;
  log(`FORMAT repair: pushed new HEAD ${newHead}`);
  return { ok: true, newHead, reason: 'format repair committed and pushed' };
}

// ── INFRA retry ───────────────────────────────────────────────────────────────
/**
 * Execute bounded infrastructure retry with exponential backoff.
 * ZERO AI turns.
 *
 * @param {Object} opts
 * @param {number} opts.attempt - current attempt number (1-based)
 * @param {number} opts.maxRetries - max before giving up
 * @param {Function} opts.log - logging callback
 * @returns {{ ok: boolean, waitMs: number, reason: string }}
 */
export function executeInfraRetry({
  attempt = 1,
  maxRetries = MAX_INFRA_RETRIES,
  log = console.log,
} = {}) {
  if (attempt > maxRetries) {
    return {
      ok: false,
      waitMs: 0,
      reason: `infrastructure retry budget exhausted (${attempt}/${maxRetries}) — escalate without AI`,
    };
  }
  const waitMs = INFRA_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
  log(
    `INFRA retry ${attempt}/${maxRetries}: waiting ${Math.round(waitMs / 1000)}s before next CI attempt`,
  );
  return { ok: true, waitMs, reason: 'infrastructure-retry' };
}

// ── Main executor ─────────────────────────────────────────────────────────────
/**
 * Execute the appropriate bounded repair for a CI incident.
 *
 * Inputs:
 *   - incident capsule (from captureCiIncident)
 *   - current branch/worktree context
 *   - execution profile
 *
 * Outputs:
 *   - action: what was done
 *   - engine: which engine handled it
 *   - result: 'ok' | 'failed' | 'escalated' | 'retry-infra' | 'route-codex' | 'route-agy'
 *   - newHead: new SHA if HEAD changed, otherwise null
 *   - retry: boolean — whether to re-run CI after this repair
 *   - escalate: boolean — whether maintainer escalation is needed
 *
 * @param {Object} opts
 * @param {Object} opts.incident - the incident result from captureCiIncident
 * @param {string} opts.branch - current PR branch
 * @param {string} opts.worktreeDir - git worktree directory
 * @param {string} opts.executionProfile - e.g. 'CODEX_AGY'
 * @param {string} opts.stateDir - supervisor state directory
 * @param {Function} opts.log - logging callback
 * @returns {Object} repair result
 */
export function executeCiRepair({
  incident,
  branch,
  worktreeDir,
  executionProfile = 'CODEX_AGY',
  log = console.log,
} = {}) {
  if (!incident?.capsule) {
    return {
      action: 'NO_INCIDENT',
      engine: 'NONE',
      result: 'failed',
      newHead: null,
      retry: false,
      escalate: true,
      reason: 'no incident capsule provided',
    };
  }

  const { capsule, filePath: incidentFilePath } = incident;
  const { repairRoute, classification } = capsule;

  // Increment attempt count durably before executing repair
  const attempts = incidentFilePath ? incrementRepairAttempts(incidentFilePath) : 1;

  // Check exhaustion AFTER incrementing
  if (attempts > MAX_REPAIR_ATTEMPTS) {
    log(`CI repair exhausted: ${attempts} attempts on ${capsule.sha}`);
    return {
      action: 'ESCALATE',
      engine: 'CLAUDE',
      result: 'escalated',
      newHead: null,
      retry: false,
      escalate: true,
      reason: `repair budget exhausted (${attempts}/${MAX_REPAIR_ATTEMPTS})`,
    };
  }

  const route = repairRoute?.route ?? 'UNKNOWN';
  log(
    `CI repair attempt ${attempts}/${MAX_REPAIR_ATTEMPTS}: route=${route}, engine=${repairRoute?.engine}`,
  );

  // ── FORMAT: deterministic formatter, ZERO AI ─────────────────────────────
  if (route === 'DETERMINISTIC_FORMAT') {
    const formatResult = executeFormatRepair({
      failedFiles: classification?.failedFiles ?? [],
      worktreeDir,
      branch,
      log,
    });
    return {
      action: 'FORMAT_REPAIR',
      engine: 'FORMATTER',
      result: formatResult.ok ? 'ok' : 'failed',
      newHead: formatResult.newHead,
      retry: formatResult.ok,
      escalate: !formatResult.ok,
      reason: formatResult.reason,
    };
  }

  // ── INFRA: bounded retry, ZERO AI ────────────────────────────────────────
  if (route === 'INFRASTRUCTURE_WAIT') {
    const infraResult = executeInfraRetry({ attempt: attempts, log });
    return {
      action: 'INFRA_RETRY',
      engine: 'NONE',
      result: infraResult.ok ? 'retry-infra' : 'escalated',
      newHead: null,
      retry: infraResult.ok,
      escalate: !infraResult.ok,
      waitMs: infraResult.waitMs,
      reason: infraResult.reason,
    };
  }

  // ── CODEX: route product implementation repair ───────────────────────────
  if (route === 'CODEX_IMPLEMENTATION_REPAIR') {
    if (executionProfile !== 'CODEX_AGY') {
      return {
        action: 'ROUTE_CODEX',
        engine: 'CODEX',
        result: 'route-codex',
        newHead: null,
        retry: false,
        escalate: true,
        reason: `Codex repair required but executionProfile=${executionProfile}; escalate to maintainer`,
      };
    }
    return {
      action: 'ROUTE_CODEX',
      engine: 'CODEX',
      result: 'route-codex',
      newHead: null,
      retry: false, // Codex will push a new HEAD; caller re-triggers CI observation
      escalate: false,
      reason: 'product implementation defect routed to Codex repair engine',
      routeInstruction: {
        engine: 'CODEX',
        action: 'RETRY_CODEX',
        incidentSha: capsule.sha,
        failedFiles: classification?.failedFiles ?? [],
        executionProfile,
      },
    };
  }

  // ── AGY: route test authority repair ─────────────────────────────────────
  if (route === 'AGY_TEST_REPAIR') {
    return {
      action: 'ROUTE_AGY',
      engine: 'AGY',
      result: 'route-agy',
      newHead: null,
      retry: false,
      escalate: false,
      reason: 'test-owned failure routed to AGY test authority',
      routeInstruction: {
        engine: 'AGY',
        action: 'RETRY_AGY_TEST',
        incidentSha: capsule.sha,
        failedFiles: classification?.failedFiles ?? [],
      },
    };
  }

  // ── SPEC / MAINTAINER: escalate ───────────────────────────────────────────
  if (
    route === 'SPEC_INTEGRITY_REPAIR' ||
    route === 'MAINTAINER_INCIDENT' ||
    route === 'MAINTAINER_ESCALATION'
  ) {
    return {
      action: 'ESCALATE',
      engine: 'CLAUDE',
      result: 'escalated',
      newHead: null,
      retry: false,
      escalate: true,
      reason: repairRoute?.reason ?? `unhandled route: ${route}`,
    };
  }

  // ── TEST DISPUTE: ambiguous failing assertion ──────────────────────────────
  if (route === 'TEST_DISPUTE') {
    return {
      action: 'TEST_DISPUTE',
      engine: 'NONE',
      result: 'escalated',
      newHead: null,
      retry: false,
      escalate: true,
      reason: 'ambiguous test failure — TEST_DISPUTE artifact emitted; requires maintainer review',
    };
  }

  // ── UNKNOWN: escalate ─────────────────────────────────────────────────────
  return {
    action: 'ESCALATE',
    engine: 'CLAUDE',
    result: 'escalated',
    newHead: null,
    retry: false,
    escalate: true,
    reason: `unknown repair route: ${route}`,
  };
}

// ── Repair Request Management & Execution (F8) ────────────────────────────────

export function persistRepairRequest(stateDir, request) {
  const dir = join(stateDir, 'repair-requests');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const id = request.requestId || `${request.incidentId}-${request.route}-${request.failedHeadSha}`;
  request.requestId = id;
  const path = join(dir, `request-${id}.json`);
  const tmpPath = path + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(request, null, 2) + '\n');
  renameSync(tmpPath, path);
  return id;
}

export function discoverPendingRepairRequests(stateDir) {
  const dir = join(stateDir, 'repair-requests');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir);
  const reqs = [];
  for (const f of files) {
    if (!f.startsWith('request-') || !f.endsWith('.json')) continue;
    try {
      const p = join(dir, f);
      const req = JSON.parse(readFileSync(p, 'utf8'));
      if (req.status !== 'COMPLETE' && req.status !== 'FAILED') {
        reqs.push({ request: req, path: p });
      }
    } catch {}
  }
  return reqs;
}

export function validateRepairOwnership({ engine, actualDiffPaths = [] }) {
  const isTestPath = (p) =>
    p.includes('tests/') || p.includes('__tests__/') || /\.spec\./.test(p) || /\.test\./.test(p);

  let violations = [];
  let violationType = null;

  if (engine === 'CODEX') {
    // CODEX repair: forbidden paths include tests/**, *.spec.*, *.test.*, __tests__/**
    violations = actualDiffPaths.filter(isTestPath);
    if (violations.length > 0) {
      violationType = 'CODEX_TEST_OWNERSHIP_VIOLATION';
    }
  } else if (engine === 'AGY') {
    // AGY repair: forbidden paths include production implementation paths (not test-owned)
    violations = actualDiffPaths.filter((p) => {
      // Allow tests, specs, evidence, tools
      if (
        isTestPath(p) ||
        p.startsWith('specs/') ||
        p.startsWith('evidence/') ||
        p.startsWith('scripts/')
      ) {
        return false;
      }
      return true; // everything else is production code
    });
    if (violations.length > 0) {
      violationType = 'AGY_PRODUCT_OWNERSHIP_VIOLATION';
    }
  }

  return { ok: violations.length === 0, violations, violationType };
}

export async function advanceRepairRequest({
  request,
  stateDir,
  repoDir,
  executorFn,
  log = console.log,
}) {
  const advance = (status) => {
    request.status = status;
    request.updatedAt = new Date().toISOString();
    persistRepairRequest(stateDir, request);
  };

  if (request.status === 'PENDING') {
    advance('WORKTREE_READY');
    return { action: 'prepared-worktree' };
  }
  if (request.status === 'WORKTREE_READY') {
    advance('ENGINE_INVOKED');
    if (executorFn) {
      await executorFn(request);
    }
    return { action: 'invoked-engine' };
  }
  if (request.status === 'ENGINE_INVOKED') {
    const diff = shSync('git', ['diff', '--name-only'], { cwd: repoDir, allowFail: true });
    const paths = diff.out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const ownership = validateRepairOwnership({ engine: request.engine, actualDiffPaths: paths });
    if (!ownership.ok) {
      log(`Ownership violation: ${ownership.violationType} on ${ownership.violations.join(', ')}`);
      advance('FAILED');
      return { action: 'failed-ownership', violations: ownership.violations };
    }
    advance('OWNERSHIP_VERIFIED');
    return { action: 'verified-ownership' };
  }
  if (request.status === 'OWNERSHIP_VERIFIED') {
    advance('COMMITTED');
    return { action: 'committed' };
  }
  if (request.status === 'COMMITTED') {
    advance('PUSHED');
    return { action: 'pushed' };
  }
  if (request.status === 'PUSHED') {
    advance('COMPLETE');
    return { action: 'completed' };
  }
  return { action: 'no-op', status: request.status };
}

const invokedDirectly = process.argv[1]?.endsWith('ci-repair-executor.mjs');
if (invokedDirectly) {
  const [, , incidentFilePath, branch = 'HEAD', worktreeDir = process.cwd()] = process.argv;
  if (!incidentFilePath || !existsSync(incidentFilePath)) {
    console.error('usage: ci-repair-executor.mjs <incident-file> <branch> [worktree-dir]');
    process.exit(2);
  }
  const capsule = JSON.parse(readFileSync(incidentFilePath, 'utf8'));
  const result = executeCiRepair({
    incident: { capsule, filePath: incidentFilePath },
    branch,
    worktreeDir,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.result === 'ok' || result.result.startsWith('route-') ? 0 : 1);
}
