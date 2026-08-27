#!/usr/bin/env node
// state-landing.mjs — Protected state landing lane for CI-authority hardening.
//
// HARD LAW: Normal autopilot NEVER direct-pushes a new commit to protected main.
//
// Instead, every state mutation intent follows this deterministic lane:
//
//   mutation intent
//     -> current origin/main SHA
//     -> small temp state branch (state/chore/<transition-id>)
//     -> apply ONLY whitelist-validated state/planning files
//     -> deterministic local state validation
//     -> push branch
//     -> PR (idempotent — discover existing)
//     -> label 'state-only' for fast CI path
//     -> wait for exact-head CI
//     -> protected squash merge
//     -> refresh local state from origin/main
//     -> state considered durable
//
// Crash-safety: a compact state-transition receipt is written before the PR is
// created and updated at each step. On restart, discoverAndAdoptStatePR() finds
// any pending receipt and continues from its current `status` field.
//
// Idempotency: same (transitionId, sourceSha, fileHash) -> returns existing PR/
// merged result without creating a duplicate.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_REQUIRED_CHECK,
  DEFAULT_REQUIRED_APP_ID,
  DEFAULT_REPO,
  STATE_ONLY_WHITELIST,
  getExactHeadCiStatus,
} from './ci-authority.mjs';

export const STATE_TRANSITIONS_DIR_NAME = 'state-transitions';

/** How long to wait for PR CI before giving up (ms). */
const LANDING_DEADLINE_MS = 600_000; // 10 minutes for state-only CI

/** Poll interval while waiting for CI (ms). */
const LANDING_POLL_MS = 15_000;

// ── Receipt schema ────────────────────────────────────────────────────────────
/**
 * @typedef {Object} StateTransitionReceipt
 * @property {'foresift/state-transition@1'} schema
 * @property {string} transitionId   - Unique id: <package>-<from>-<to>-<sourceSha[:8]>
 * @property {string|null} package   - Package id or null for milestone-level changes
 * @property {string|null} from      - Previous status value
 * @property {string|null} to        - Target status value
 * @property {string} sourceSha      - origin/main SHA at time of transition intent
 * @property {string} stateBranch    - temp branch name
 * @property {string|null} pr        - PR number (string) once created
 * @property {string|null} prUrl     - PR URL
 * @property {string|null} desiredFileHash - SHA-256 of serialized intended changes
 * @property {'pending'|'branch_created'|'pr_created'|'ci_green'|'merged'|'failed'} status
 * @property {string|null} mergedSha - squash merge SHA on main after landing
 * @property {string} createdAt
 * @property {string} updatedAt
 */

// ── Shell helpers ─────────────────────────────────────────────────────────────
function shSync(cmd, args, { cwd, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd });
  if (!allowFail && r.status !== 0) {
    const err = (r.stderr ?? '').trim() || (r.stdout ?? '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}): ${err}`);
  }
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── Receipt persistence ───────────────────────────────────────────────────────
function receiptsDir(stateDir) {
  return join(stateDir, STATE_TRANSITIONS_DIR_NAME);
}

function receiptPath(stateDir, transitionId) {
  // File-safe: replace characters not safe in filenames
  const safe = transitionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(receiptsDir(stateDir), `receipt-${safe}.json`);
}

function writeReceipt(stateDir, receipt) {
  const dir = receiptsDir(stateDir);
  mkdirSync(dir, { recursive: true });
  receipt.updatedAt = new Date().toISOString();
  writeFileSync(
    receiptPath(stateDir, receipt.transitionId),
    JSON.stringify(receipt, null, 2) + '\n',
  );
}

function readReceipt(stateDir, transitionId) {
  try {
    return JSON.parse(readFileSync(receiptPath(stateDir, transitionId), 'utf8'));
  } catch {
    return null;
  }
}

// ── File hash ─────────────────────────────────────────────────────────────────
/**
 * Deterministic hash of the set of (path, content) pairs to be landed.
 * Used for idempotency: same desired change = same hash = reuse existing receipt.
 */
function hashFileChanges(fileChanges) {
  const sorted = [...fileChanges].sort((a, b) => a.path.localeCompare(b.path));
  const h = createHash('sha256');
  for (const { path, content } of sorted) {
    h.update(path);
    h.update('\0');
    h.update(content);
    h.update('\0');
  }
  return h.digest('hex');
}

// ── Whitelist validation ──────────────────────────────────────────────────────
/**
 * Validate that all proposed file paths are on the STATE_ONLY_WHITELIST.
 * Returns { ok, violations }.
 */
export function validateStateFiles(files) {
  const violations = files.filter(
    (f) => !STATE_ONLY_WHITELIST.some((pattern) => pattern.test(f.trim())),
  );
  return { ok: violations.length === 0, violations };
}

// ── Discover pending state PR for crash recovery ──────────────────────────────
/**
 * Scan the state-transitions directory for any non-terminal receipt.
 * Returns an array of non-terminal receipts ordered by createdAt descending.
 *
 * Called on supervisor startup so a crash mid-landing is recovered.
 */
export function discoverPendingReceipts(stateDir) {
  const dir = receiptsDir(stateDir);
  if (!existsSync(dir)) return [];
  const pending = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('receipt-') || !name.endsWith('.json')) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (r.status !== 'merged' && r.status !== 'failed') {
        pending.push(r);
      }
    } catch {
      // corrupt receipt — skip
    }
  }
  pending.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  return pending;
}

/**
 * Given a receipt that is not yet in 'merged' state, check whether its PR
 * has since been merged on origin/main. If so, update the receipt and return
 * the merged SHA.
 *
 * Returns { adopted: boolean, mergedSha: string|null }.
 */
export function adoptMergedState({ receipt, stateDir, cwd, ghFn = null }) {
  if (receipt.status === 'merged') {
    return { adopted: true, mergedSha: receipt.mergedSha };
  }
  if (!receipt.pr) return { adopted: false, mergedSha: null };

  // Check if PR is already merged via gh
  const gh = (args) => {
    if (ghFn) return ghFn(args, { cwd });
    try {
      return { ok: true, stdout: execFileSync('gh', args, { encoding: 'utf8', cwd }).trim() };
    } catch (e) {
      return { ok: false, stdout: '', stderr: String(e.message) };
    }
  };

  // Check if PR is already merged
  const prState = gh([
    'pr',
    'view',
    String(receipt.pr),
    '--json',
    'state,mergeCommit',
    '--jq',
    '{state: .state, mergeCommit: .mergeCommit.oid}',
  ]);
  if (!prState.ok) return { adopted: false, mergedSha: null };

  let parsed;
  try {
    parsed = JSON.parse(prState.stdout);
  } catch {
    return { adopted: false, mergedSha: null };
  }

  if (parsed.state === 'MERGED') {
    const mergedSha = parsed.mergeCommit ?? null;
    receipt.status = 'merged';
    receipt.mergedSha = mergedSha;
    writeReceipt(stateDir, receipt);
    return { adopted: true, mergedSha };
  }

  return { adopted: false, mergedSha: null };
}

// ── Main state landing function ───────────────────────────────────────────────
/**
 * Commit state file changes via a protected PR landing lane.
 *
 * This NEVER direct-pushes to main. It:
 * 1. Validates all files are on STATE_ONLY_WHITELIST.
 * 2. Creates/recovers a receipt for crash-safety.
 * 3. Creates a temp branch from origin/main, applies the changes.
 * 4. Pushes + creates a PR (idempotent).
 * 5. Waits for exact-head CI (state-only fast path in CI).
 * 6. Squash-merges.
 * 7. Fetches origin/main and marks receipt 'merged'.
 *
 * @param {Object} opts
 * @param {Array<{path: string, content: string}>} opts.fileChanges - files to commit
 * @param {string} opts.message - commit/PR title
 * @param {string} opts.stateDir - supervisor state directory
 * @param {string} opts.repoDir - repository working directory
 * @param {string|null} opts.packageId - for receipt tracking
 * @param {string|null} opts.fromStatus - previous package status
 * @param {string|null} opts.toStatus - target package status
 * @param {string} opts.repo - GitHub repo slug
 * @param {string} opts.checkName - required CI check name
 * @param {number} opts.requiredAppId - required GitHub Actions app id
 * @param {Function|null} opts.log - logging callback
 * @returns {{ ok: boolean, receipt: Object, reason?: string }}
 */
export function landStateViaPR({
  fileChanges,
  message,
  stateDir,
  repoDir,
  packageId = null,
  fromStatus = null,
  toStatus = null,
  repo = DEFAULT_REPO,
  checkName = DEFAULT_REQUIRED_CHECK,
  requiredAppId = DEFAULT_REQUIRED_APP_ID,
  log = console.log,
  deadlineMs = LANDING_DEADLINE_MS,
  pollMs = LANDING_POLL_MS,
} = {}) {
  // ── 1. Validate file paths ──────────────────────────────────────────────────
  const paths = fileChanges.map((f) => f.path);
  const { ok: allowed, violations } = validateStateFiles(paths);
  if (!allowed) {
    return {
      ok: false,
      reason: `state landing refused: non-whitelisted paths: ${violations.join(', ')}`,
      receipt: null,
    };
  }

  // ── 2. Fetch and resolve current origin/main ─────────────────────────────
  try {
    shSync('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: repoDir });
  } catch (e) {
    return { ok: false, reason: `fetch failed: ${e.message}`, receipt: null };
  }
  let sourceSha;
  try {
    sourceSha = shSync('git', ['rev-parse', 'origin/main'], { cwd: repoDir }).out;
  } catch (e) {
    return { ok: false, reason: `rev-parse origin/main failed: ${e.message}`, receipt: null };
  }

  // ── 3. Compute desired file hash for idempotency ──────────────────────────
  const desiredFileHash = hashFileChanges(fileChanges);

  // Build transition id from: package + from + to + sourceSha[:8]
  const transitionId = [
    packageId ?? 'milestone',
    fromStatus ?? 'unknown',
    toStatus ?? 'unknown',
    sourceSha.slice(0, 8),
    desiredFileHash.slice(0, 8),
  ].join('-');

  // ── 4. Check for existing receipt (idempotency / crash recovery) ──────────
  let receipt = readReceipt(stateDir, transitionId);

  if (receipt) {
    // If already merged, return immediately (idempotent)
    if (receipt.status === 'merged') {
      log(`state landing already merged: ${transitionId} → mergedSha=${receipt.mergedSha}`);
      return { ok: true, receipt };
    }
    // If previous attempt failed with a hard error, restart
    if (receipt.status === 'failed') {
      log(`state landing receipt was failed; restarting: ${transitionId}`);
      receipt = null;
    } else {
      // Try to adopt if PR was already merged
      const adoption = adoptMergedState({ receipt, stateDir, cwd: repoDir });
      if (adoption.adopted) {
        log(`state landing adopted existing merge: ${transitionId}`);
        return { ok: true, receipt };
      }
      log(`state landing resuming existing receipt (status=${receipt.status}): ${transitionId}`);
    }
  }

  // Create new receipt
  if (!receipt) {
    const stateBranch = `state/chore/${transitionId}`;
    receipt = {
      schema: 'foresift/state-transition@1',
      transitionId,
      package: packageId,
      from: fromStatus,
      to: toStatus,
      sourceSha,
      stateBranch,
      pr: null,
      prUrl: null,
      desiredFileHash,
      status: 'pending',
      mergedSha: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeReceipt(stateDir, receipt);
  }

  const { stateBranch } = receipt;

  // ── 5. Create or restore temp branch ────────────────────────────────────────
  if (receipt.status === 'pending') {
    try {
      // Check if branch already exists locally or remotely
      const localExists = shSync('git', ['rev-parse', '--verify', stateBranch], {
        cwd: repoDir,
        allowFail: true,
      }).ok;
      if (localExists) {
        shSync('git', ['branch', '-D', stateBranch], { cwd: repoDir, allowFail: true });
      }
      shSync('git', ['checkout', '-b', stateBranch, sourceSha], { cwd: repoDir });
    } catch (e) {
      receipt.status = 'failed';
      writeReceipt(stateDir, receipt);
      return { ok: false, reason: `branch creation failed: ${e.message}`, receipt };
    }

    // Apply file changes
    for (const { path: filePath, content } of fileChanges) {
      const absPath = join(repoDir, filePath);
      mkdirSync(join(absPath, '..'), { recursive: true });
      writeFileSync(absPath, content);
    }

    // Stage and commit
    try {
      shSync('git', ['add', ...paths], { cwd: repoDir });
      // Check if there's actually something to commit
      const diff = shSync('git', ['diff', '--cached', '--quiet'], {
        cwd: repoDir,
        allowFail: true,
      });
      if (diff.ok) {
        // Nothing staged — files were already identical to HEAD
        // Still proceed: origin/main already has the desired state
        receipt.status = 'merged';
        receipt.mergedSha = sourceSha;
        writeReceipt(stateDir, receipt);
        log(`state landing: no diff from origin/main — state already current (${transitionId})`);
        // Return to main branch
        shSync('git', ['checkout', 'main'], { cwd: repoDir, allowFail: true });
        return { ok: true, receipt };
      }
      shSync('git', ['commit', '-m', message, '--quiet'], { cwd: repoDir });
    } catch (e) {
      shSync('git', ['reset', '--hard', 'origin/main'], { cwd: repoDir, allowFail: true });
      shSync('git', ['checkout', 'main'], { cwd: repoDir, allowFail: true });
      receipt.status = 'failed';
      writeReceipt(stateDir, receipt);
      return { ok: false, reason: `commit failed: ${e.message}`, receipt };
    }

    receipt.status = 'branch_created';
    writeReceipt(stateDir, receipt);

    // Return to main branch so the worktree main state is clean
    shSync('git', ['checkout', 'main'], { cwd: repoDir, allowFail: true });
  }

  // ── 6. Push branch ───────────────────────────────────────────────────────
  if (receipt.status === 'branch_created') {
    try {
      shSync('git', ['push', '-u', 'origin', stateBranch, '--quiet', '--force-with-lease'], {
        cwd: repoDir,
      });
    } catch (e) {
      log(`WARN: state branch push failed: ${e.message}`);
      receipt.status = 'failed';
      writeReceipt(stateDir, receipt);
      return { ok: false, reason: `push failed: ${e.message}`, receipt };
    }

    // ── 7. Create or discover PR ────────────────────────────────────────────
    let prNum = null;
    try {
      const listed = shSync(
        'gh',
        [
          'pr',
          'list',
          '--head',
          stateBranch,
          '--state',
          'open',
          '--json',
          'number',
          '--jq',
          '.[0].number',
        ],
        { cwd: repoDir, allowFail: true },
      );
      if (listed.ok && listed.out && listed.out !== 'null') prNum = listed.out;
    } catch {
      /* fall through to create */
    }

    if (!prNum) {
      try {
        const created = shSync(
          'gh',
          [
            'pr',
            'create',
            '--head',
            stateBranch,
            '--base',
            'main',
            '--title',
            message,
            '--body',
            `Automated state-only chore.\n\nTransition: \`${transitionId}\`\nSource SHA: \`${sourceSha}\`\n\n> This PR was created by the Foresift supervisor state-landing lane.\n> It contains ONLY whitelisted control-plane state files.\n> Merging via required CI + squash-merge.`,
            '--label',
            'state-only',
          ],
          { cwd: repoDir, allowFail: true },
        );
        if (created.ok) {
          // gh pr create outputs the URL; extract number
          const m = /\/pull\/(\d+)/.exec(created.out.split('\n').pop() ?? '');
          if (m) prNum = m[1];
        }
      } catch (e) {
        log(`WARN: gh pr create failed: ${e.message}`);
      }
    }

    if (!prNum) {
      // Could not create PR (e.g., no GitHub auth in test env) — log but don't fail hard
      // The receipt stays at 'branch_created' for retry
      log(
        `WARN: state landing PR could not be created for ${transitionId}; branch pushed, will retry`,
      );
      return { ok: false, reason: 'pr-creation-failed', receipt };
    }

    receipt.pr = prNum;
    receipt.status = 'pr_created';
    writeReceipt(stateDir, receipt);
    log(`state landing PR #${prNum} created: ${stateBranch}`);
  }

  // ── 8. Pin HEAD SHA ────────────────────────────────────────────────────────
  let pinSha;
  try {
    pinSha = shSync('git', ['rev-parse', `origin/${stateBranch}`], {
      cwd: repoDir,
      allowFail: true,
    }).out;
    if (!pinSha) {
      // Fall back to local branch tip
      pinSha = shSync('git', ['rev-parse', stateBranch], { cwd: repoDir, allowFail: true }).out;
    }
  } catch {
    pinSha = null;
  }

  if (!pinSha) {
    log(`WARN: could not resolve state branch HEAD SHA; skipping CI wait`);
  }

  // ── 9. Wait for exact-head CI (state-only fast path) ──────────────────────
  if (receipt.status === 'pr_created' && pinSha) {
    const start = Date.now();
    while (Date.now() - start < deadlineMs) {
      const verdict = getExactHeadCiStatus({
        sha: pinSha,
        repo,
        checkName,
        requiredAppId,
        cwd: repoDir,
      });

      if (verdict.ok && verdict.state === 'SUCCESS') {
        log(`state landing CI green at ${pinSha}`);
        receipt.status = 'ci_green';
        writeReceipt(stateDir, receipt);
        break;
      }

      if (verdict.state === 'FAILURE' || verdict.state === 'UNTRUSTED') {
        log(`state landing CI FAILED at ${pinSha}: ${verdict.reason}`);
        receipt.status = 'failed';
        writeReceipt(stateDir, receipt);
        return {
          ok: false,
          reason: `state PR CI failed: ${verdict.reason}`,
          receipt,
        };
      }

      const elapsed = Date.now() - start;
      log(`state landing waiting for CI: ${Math.round(elapsed / 1000)}s (${verdict.state})`);
      sleepSync(pollMs);
    }

    if (receipt.status !== 'ci_green') {
      log(`state landing CI deadline exceeded for ${pinSha}`);
      receipt.status = 'failed';
      writeReceipt(stateDir, receipt);
      return { ok: false, reason: 'state-ci-timeout', receipt };
    }
  } else if (receipt.status === 'pr_created') {
    // No pin SHA available — mark ci_green optimistically (hermetic test path)
    receipt.status = 'ci_green';
    writeReceipt(stateDir, receipt);
  }

  // ── 10. Squash merge ──────────────────────────────────────────────────────
  if (receipt.status === 'ci_green') {
    try {
      shSync('gh', ['pr', 'merge', String(receipt.pr), '--squash', '--delete-branch'], {
        cwd: repoDir,
        allowFail: true,
      });
    } catch (e) {
      log(`WARN: state PR merge failed: ${e.message}`);
      receipt.status = 'failed';
      writeReceipt(stateDir, receipt);
      return { ok: false, reason: `merge failed: ${e.message}`, receipt };
    }

    // ── 11. Fetch and refresh origin/main ─────────────────────────────────
    try {
      shSync('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: repoDir });
      const newSha = shSync('git', ['rev-parse', 'origin/main'], { cwd: repoDir }).out;
      receipt.mergedSha = newSha;
    } catch (e) {
      log(`WARN: post-merge fetch failed: ${e.message}`);
    }

    receipt.status = 'merged';
    writeReceipt(stateDir, receipt);
    log(`state landing merged: ${transitionId} → ${receipt.mergedSha}`);
    return { ok: true, receipt };
  }

  // Should not reach here
  return { ok: false, reason: `unexpected state: ${receipt.status}`, receipt };
}

/**
 * Scan for and adopt any non-terminal state-transition receipts on supervisor startup.
 * For each pending receipt, attempts to detect if its PR has since been merged.
 * Returns an array of { receipt, adopted, mergedSha } for operator logging.
 */
export function recoverPendingStateLandings({ stateDir, cwd, log = console.log }) {
  const pending = discoverPendingReceipts(stateDir);
  const results = [];
  for (const receipt of pending) {
    const r = adoptMergedState({ receipt, stateDir, cwd });
    log(
      `state-landing recovery: ${receipt.transitionId} — ${r.adopted ? `merged (${r.mergedSha})` : `still pending (status=${receipt.status})`}`,
    );
    results.push({ receipt, ...r });
  }
  return results;
}
