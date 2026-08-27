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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
 * - Only runs prettier on failedFiles that are FORMAT-safe paths.
 * - Verifies the diff scope before committing.
 * - NEVER touches product source or test files.
 * - ZERO AI calls.
 *
 * @param {Object} opts
 * @param {string[]} opts.failedFiles - files reported by CI as format failures
 * @param {string} opts.worktreeDir - git worktree to operate in
 * @param {string} opts.branch - current branch
 * @param {string} opts.repoDir - canonical repo root (may differ from worktree)
 * @returns {{ ok: boolean, newHead: string|null, reason: string }}
 */
export function executeFormatRepair({
  failedFiles = [],
  worktreeDir,
  branch,
  log = console.log,
} = {}) {
  // Filter to only FORMAT-safe paths
  const safe = failedFiles.filter(isFormatSafePath);
  const unsafe = failedFiles.filter((f) => !isFormatSafePath(f));

  if (unsafe.length > 0) {
    return {
      ok: false,
      newHead: null,
      reason: `FORMAT repair refused: non-safe paths in diff scope: ${unsafe.join(', ')}`,
    };
  }

  if (safe.length === 0) {
    // No specific files identified — run prettier on known-safe directories only
    // NEVER run on entire repo (would touch product/test files)
    const safeDirs = ['specs/implementation', 'specs'];
    const targets = safeDirs.filter((d) => existsSync(join(worktreeDir, d)));
    if (targets.length === 0) {
      return {
        ok: false,
        newHead: null,
        reason: 'FORMAT repair: no safe targets identified',
      };
    }
    safe.push(...targets.map((d) => `${d}/**/*.json`));
  }

  // Run prettier on safe targets
  log(`FORMAT repair: running prettier on ${safe.length} target(s)`);
  const prettierArgs = ['--no-install', 'prettier', '--write', '--log-level', 'warn', ...safe];
  const fmt = shSync('npx', prettierArgs, { cwd: worktreeDir, allowFail: true });
  if (!fmt.ok) {
    log(`FORMAT repair: prettier returned error: ${fmt.err}`);
    // Continue — prettier --write returns non-zero if files changed (in some versions)
  }

  // Check if we actually changed anything
  const diff = shSync('git', ['diff', '--name-only', '--', ...safe], {
    cwd: worktreeDir,
    allowFail: true,
  });
  const changedFiles = diff.out.split('\n').filter(Boolean);

  if (changedFiles.length === 0) {
    return {
      ok: false,
      newHead: null,
      reason: 'FORMAT repair: prettier made no changes (files already formatted)',
    };
  }

  // Verify ONLY safe files changed
  const unsafeChanged = changedFiles.filter((f) => !isFormatSafePath(f));
  if (unsafeChanged.length > 0) {
    // Roll back
    shSync('git', ['checkout', '--', ...changedFiles], { cwd: worktreeDir, allowFail: true });
    return {
      ok: false,
      newHead: null,
      reason: `FORMAT repair: aborting — formatter modified unsafe paths: ${unsafeChanged.join(', ')}`,
    };
  }

  // Stage changed files
  try {
    shSync('git', ['add', '--', ...changedFiles], { cwd: worktreeDir });
    shSync(
      'git',
      ['commit', '-m', 'fix(format): automated prettier repair [state-only]', '--quiet'],
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
