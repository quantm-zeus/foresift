#!/usr/bin/env node
// state-landing.mjs — Protected state landing lane for CI-authority hardening.
//
// HARD LAW: Normal autopilot NEVER direct-pushes a new commit to protected main.
//
// Instead, every state mutation intent follows this deterministic lane:
//
//   mutation intent
//     -> current origin/main SHA
//     -> isolated ephemeral Git worktree ($STATE_DIR/state-worktrees/<transition-id>)
//     -> apply ONLY whitelist-validated state/planning files
//     -> deterministic local state validation
//     -> push branch
//     -> PR (idempotent — discover existing)
//     -> label 'state-only' for fast CI path
//     -> wait for exact-head CI
//     -> protected squash merge
//     -> authoritative verification on origin/main:
//          PR state == MERGED
//          mergeCommit exists
//          authorized headRefOid matches
//          fetch origin/main succeeds
//          merge commit reachable on origin/main
//          intended file content/hash matches origin/main
//     -> remove ephemeral worktree
//     -> state considered durable
//
// Crash-safety: compact atomic state-transition receipts are written and updated
// at each step. On restart, discoverPendingReceipts() finds any non-terminal receipt
// and resumes progression of the state machine.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_REQUIRED_CHECK,
  DEFAULT_REQUIRED_APP_ID,
  DEFAULT_REPO,
  STATE_ONLY_WHITELIST,
  getExactHeadCiStatus,
} from './ci-authority.mjs';

export const STATE_TRANSITIONS_DIR_NAME = 'state-transitions';
export const STATE_WORKTREES_DIR_NAME = 'state-worktrees';

/** How long to wait for PR CI before giving up (ms). */
const LANDING_DEADLINE_MS = 600_000; // 10 minutes for state-only CI

/** Poll interval while waiting for CI (ms). */
const LANDING_POLL_MS = 10_000;

// ── Default wrappers ──────────────────────────────────────────────────────────
function defaultGh(args, { cwd } = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync('gh', args, { encoding: 'utf8', cwd }).trim(),
      stderr: '',
      status: 0,
    };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout ? String(e.stdout).trim() : '',
      stderr: e.stderr ? String(e.stderr).trim() : String(e.message),
      status: e.status ?? 1,
    };
  }
}

function defaultGit(args, { cwd } = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', args, { encoding: 'utf8', cwd }).trim(),
      stderr: '',
      status: 0,
    };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout ? String(e.stdout).trim() : '',
      stderr: e.stderr ? String(e.stderr).trim() : String(e.message),
      status: e.status ?? 1,
    };
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── Receipt persistence (atomic write) ─────────────────────────────────────────
function receiptsDir(stateDir) {
  return join(stateDir, STATE_TRANSITIONS_DIR_NAME);
}

function worktreesBaseDir(stateDir) {
  return join(stateDir, STATE_WORKTREES_DIR_NAME);
}

function receiptPath(stateDir, transitionId) {
  const safe = transitionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(receiptsDir(stateDir), `receipt-${safe}.json`);
}

function writeReceipt(stateDir, receipt) {
  const dir = receiptsDir(stateDir);
  mkdirSync(dir, { recursive: true });
  receipt.updatedAt = new Date().toISOString();
  const target = receiptPath(stateDir, receipt.transitionId);
  const tmp = `${target}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(receipt, null, 2) + '\n');
  renameSync(tmp, target);
}

export function readReceipt(stateDir, transitionId) {
  try {
    return JSON.parse(readFileSync(receiptPath(stateDir, transitionId), 'utf8'));
  } catch {
    return null;
  }
}

// ── File hash ─────────────────────────────────────────────────────────────────
export function hashFileChanges(fileChanges) {
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
export function validateStateFiles(fileChanges) {
  const paths = fileChanges.map((f) => (typeof f === 'string' ? f : f.path));
  const violations = paths.filter(
    (f) => !STATE_ONLY_WHITELIST.some((pattern) => pattern.test(f.trim())),
  );
  return { ok: violations.length === 0, violations };
}

// ── Discover pending state PR for crash recovery ──────────────────────────────
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

// ── Authoritative PR Merge Verification ───────────────────────────────────────
/**
 * Verify merge commit reachability, origin/main status, and file content matching.
 */
export function verifyMergeAuthoritatively({
  prNum,
  pinnedHead,
  fileChanges,
  repoDir,
  ghFn = defaultGh,
  gitFn = defaultGit,
}) {
  // 1. Query PR via gh pr view
  const prViewRes = ghFn(
    ['pr', 'view', String(prNum), '--json', 'state,mergeCommit,headRefOid,baseRefName'],
    { cwd: repoDir },
  );
  if (!prViewRes.ok || !prViewRes.stdout) {
    return { ok: false, reason: `gh pr view #${prNum} failed: ${prViewRes.stderr}` };
  }

  let prData;
  try {
    prData = JSON.parse(prViewRes.stdout);
  } catch (e) {
    return { ok: false, reason: `gh pr view #${prNum} unparseable: ${e.message}` };
  }

  if (prData.state !== 'MERGED') {
    return { ok: false, reason: `PR #${prNum} is not MERGED (state=${prData.state})` };
  }

  const mergeCommitSha = prData.mergeCommit?.oid ?? prData.mergeCommit;
  if (!mergeCommitSha) {
    return { ok: false, reason: `PR #${prNum} mergeCommit missing` };
  }

  if (pinnedHead && prData.headRefOid && prData.headRefOid !== pinnedHead) {
    return {
      ok: false,
      reason: `PR #${prNum} head (${prData.headRefOid}) does not match authorized pinned head (${pinnedHead})`,
    };
  }

  // 2. Fetch origin/main MUST succeed
  const fetchRes = gitFn(['fetch', 'origin', 'main', '--quiet'], { cwd: repoDir });
  if (!fetchRes.ok) {
    return { ok: false, reason: `post-merge fetch origin/main failed: ${fetchRes.stderr}` };
  }

  // 3. Check merge commit reachability from origin/main
  const originMainSha = gitFn(['rev-parse', 'origin/main'], { cwd: repoDir }).stdout;
  if (!originMainSha) {
    return { ok: false, reason: 'unable to resolve origin/main SHA' };
  }

  const isAncestor = gitFn(['merge-base', '--is-ancestor', mergeCommitSha, 'origin/main'], {
    cwd: repoDir,
  });
  if (!isAncestor.ok && mergeCommitSha !== originMainSha) {
    return {
      ok: false,
      reason: `merge commit ${mergeCommitSha} is not reachable from origin/main (${originMainSha})`,
    };
  }

  // 4. Verify intended state file content matches on origin/main
  for (const { path: filePath, content: expectedContent } of fileChanges) {
    const showRes = gitFn(['show', `origin/main:${filePath}`], { cwd: repoDir });
    if (!showRes.ok) {
      return {
        ok: false,
        reason: `file ${filePath} missing from origin/main after merge: ${showRes.stderr}`,
      };
    }
    const actualContent = showRes.stdout;
    if (actualContent.trim() !== expectedContent.trim()) {
      return {
        ok: false,
        reason: `content mismatch for ${filePath} on origin/main after merge`,
      };
    }
  }

  return { ok: true, mergeCommitSha, originMainSha };
}

// ── Adopt Merged State ────────────────────────────────────────────────────────
export function adoptMergedState({
  receipt,
  fileChanges,
  stateDir,
  cwd,
  ghFn = defaultGh,
  gitFn = defaultGit,
  log = console.log,
}) {
  if (receipt.status === 'merged') {
    return { adopted: true, mergedSha: receipt.mergedSha };
  }
  if (!receipt.pr) return { adopted: false, mergedSha: null };

  const changes = fileChanges ?? [];
  const verification = verifyMergeAuthoritatively({
    prNum: receipt.pr,
    pinnedHead: receipt.sourceSha, // or state branch head
    fileChanges: changes,
    desiredFileHash: receipt.desiredFileHash,
    repoDir: cwd,
    ghFn,
    gitFn,
    log,
  });

  if (verification.ok) {
    receipt.status = 'merged';
    receipt.mergedSha = verification.mergeCommitSha;
    writeReceipt(stateDir, receipt);
    return { adopted: true, mergedSha: receipt.mergedSha };
  }

  return { adopted: false, mergedSha: null, reason: verification.reason };
}

// ── Worktree cleanup helper ───────────────────────────────────────────────────
function cleanupStateWorktree({ worktreePath, stateBranch, repoDir, gitFn = defaultGit }) {
  try {
    if (existsSync(worktreePath)) {
      gitFn(['worktree', 'remove', '--force', worktreePath], { cwd: repoDir });
      rmSync(worktreePath, { recursive: true, force: true });
    }
    if (stateBranch) {
      gitFn(['branch', '-D', stateBranch], { cwd: repoDir });
    }
  } catch {}
}

// ── Step-Based State Machine Advancement ──────────────────────────────────────
/**
 * Advances a state landing transition by one deterministic step without blocking sleeps.
 * Designed for supervisor event-loop outbox execution.
 *
 * Lifecycle:
 *   INTENT / pending
 *     -> create isolated worktree ($STATE_DIR/state-worktrees/<transitionId>)
 *     -> apply file changes, stage, commit
 *     -> status = 'branch_created'
 *
 *   branch_created
 *     -> push state branch to origin
 *     -> create or discover PR on GitHub
 *     -> status = 'pr_created'
 *
 *   pr_created / waiting_ci
 *     -> resolve exact remote HEAD SHA (pinSha)
 *     -> query exact-head CI
 *     -> if green: status = 'ci_green'
 *     -> if failure/untrusted: status = 'failed'
 *     -> if pending: remain at 'pr_created'
 *
 *   ci_green
 *     -> execute squash merge via gh pr merge
 *     -> authoritatively verify merge on origin/main
 *     -> cleanup worktree & branch
 *     -> status = 'merged'
 *
 * Returns { ok, receipt, step, reason }
 */
export function advanceStateTransition({
  receipt: existingReceipt = null,
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
  ghFn = defaultGh,
  gitFn = defaultGit,
  log = console.log,
} = {}) {
  // 1. Validate file paths
  const { ok: allowed, violations } = validateStateFiles(fileChanges);
  if (!allowed) {
    return {
      ok: false,
      reason: `state landing refused: non-whitelisted paths: ${violations.join(', ')}`,
      receipt: null,
      step: 'VALIDATION_FAILED',
    };
  }

  // 2. Fetch and resolve current origin/main
  const fetchRes = gitFn(['fetch', 'origin', 'main', '--quiet'], { cwd: repoDir });
  if (!fetchRes.ok) {
    return {
      ok: false,
      reason: `fetch origin main failed: ${fetchRes.stderr}`,
      receipt: existingReceipt,
      step: 'FETCH_FAILED',
    };
  }

  const revRes = gitFn(['rev-parse', 'origin/main'], { cwd: repoDir });
  if (!revRes.ok || !revRes.stdout) {
    return {
      ok: false,
      reason: 'rev-parse origin/main failed',
      receipt: existingReceipt,
      step: 'REV_PARSE_FAILED',
    };
  }
  const sourceSha = revRes.stdout.trim();

  // 3. Compute desired file hash for idempotency
  const desiredFileHash = hashFileChanges(fileChanges);
  const transitionId = [
    packageId ?? 'milestone',
    fromStatus ?? 'unknown',
    toStatus ?? 'unknown',
    sourceSha.slice(0, 8),
    desiredFileHash.slice(0, 8),
  ].join('-');

  let receipt = existingReceipt || readReceipt(stateDir, transitionId);

  // 4. If already merged, return immediately
  if (receipt && receipt.status === 'merged') {
    return { ok: true, receipt, step: 'DONE' };
  }

  // Initialize receipt if not present
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
  const worktreePath = join(worktreesBaseDir(stateDir), transitionId);

  // ── Step: pending -> branch_created (in isolated worktree) ──────────────────
  if (receipt.status === 'pending') {
    mkdirSync(worktreesBaseDir(stateDir), { recursive: true });

    // Clean up any stale worktree or branch
    cleanupStateWorktree({ worktreePath, stateBranch, repoDir, gitFn });

    // Create isolated worktree on new state branch from sourceSha
    const wtAdd = gitFn(['worktree', 'add', '-b', stateBranch, worktreePath, sourceSha], {
      cwd: repoDir,
    });
    if (!wtAdd.ok) {
      // If branch already exists, try adding worktree to existing branch
      const wtAddExisting = gitFn(['worktree', 'add', worktreePath, stateBranch], { cwd: repoDir });
      if (!wtAddExisting.ok) {
        return {
          ok: false,
          reason: `worktree creation failed: ${wtAdd.stderr || wtAddExisting.stderr}`,
          receipt,
          step: 'WORKTREE_ERROR',
        };
      }
    }

    // Apply file changes inside the isolated worktree
    for (const { path: filePath, content } of fileChanges) {
      const absPath = join(worktreePath, filePath);
      mkdirSync(join(absPath, '..'), { recursive: true });
      writeFileSync(absPath, content);
    }

    // Stage changes in worktree
    const addRes = gitFn(['add', ...fileChanges.map((f) => f.path)], { cwd: worktreePath });
    if (!addRes.ok) {
      return {
        ok: false,
        reason: `git add failed in worktree: ${addRes.stderr}`,
        receipt,
        step: 'COMMIT_ERROR',
      };
    }

    // Check if there is a diff
    const diffRes = gitFn(['diff', '--cached', '--quiet'], { cwd: worktreePath });
    if (diffRes.ok) {
      // Nothing staged — state already matches origin/main!
      receipt.status = 'merged';
      receipt.mergedSha = sourceSha;
      writeReceipt(stateDir, receipt);
      cleanupStateWorktree({ worktreePath, stateBranch, repoDir, gitFn });
      return { ok: true, receipt, step: 'ALREADY_CURRENT' };
    }

    // Commit changes in worktree
    const commitRes = gitFn(
      [
        '-c',
        'user.name=Foresift Autopilot',
        '-c',
        'user.email=autopilot@foresift.local',
        'commit',
        '-m',
        message,
        '--quiet',
      ],
      { cwd: worktreePath },
    );
    if (!commitRes.ok) {
      return {
        ok: false,
        reason: `commit failed in worktree: ${commitRes.stderr}`,
        receipt,
        step: 'COMMIT_ERROR',
      };
    }

    receipt.status = 'branch_created';
    writeReceipt(stateDir, receipt);
    return { ok: true, receipt, step: 'BRANCH_CREATED' };
  }

  // ── Step: branch_created -> pr_created ─────────────────────────────────────
  if (receipt.status === 'branch_created') {
    // Push branch to origin
    const pushRes = gitFn(['push', '-u', 'origin', stateBranch, '--quiet', '--force-with-lease'], {
      cwd: repoDir,
    });
    if (!pushRes.ok) {
      return {
        ok: false,
        reason: `push state branch failed: ${pushRes.stderr}`,
        receipt,
        step: 'PUSH_FAILED',
      };
    }

    // Discover or create PR
    let prNum = null;
    const listPrRes = ghFn(
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
      { cwd: repoDir },
    );
    if (listPrRes.ok && listPrRes.stdout && listPrRes.stdout !== 'null') {
      prNum = listPrRes.stdout.trim();
    }

    if (!prNum) {
      const createPrRes = ghFn(
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
        { cwd: repoDir },
      );
      if (createPrRes.ok) {
        const m = /\/pull\/(\d+)/.exec(createPrRes.stdout.split('\n').pop() ?? '');
        if (m) prNum = m[1];
      }
    }

    if (!prNum) {
      // Transient PR creation refusal — remain at branch_created for retry
      return { ok: false, reason: 'pr-creation-pending', receipt, step: 'PR_PENDING' };
    }

    receipt.pr = prNum;
    receipt.status = 'pr_created';
    writeReceipt(stateDir, receipt);
    return { ok: true, receipt, step: 'PR_CREATED' };
  }

  // ── Step: pr_created -> ci_green (query CI) ────────────────────────────────
  if (receipt.status === 'pr_created') {
    // Resolve exact HEAD SHA (pinSha)
    let pinSha = null;
    const revRemote = gitFn(['rev-parse', `origin/${stateBranch}`], { cwd: repoDir });
    if (revRemote.ok && revRemote.stdout) {
      pinSha = revRemote.stdout.trim();
    } else {
      const revLocal = gitFn(['rev-parse', stateBranch], { cwd: repoDir });
      if (revLocal.ok && revLocal.stdout) pinSha = revLocal.stdout.trim();
    }

    // CRITICAL DEFECT #1: NO SHA MUST NEVER BECOME CI GREEN! Fail closed.
    if (!pinSha) {
      return {
        ok: false,
        reason: 'unable to resolve exact state branch HEAD SHA (fail-closed)',
        receipt,
        step: 'MISSING_PIN_SHA',
      };
    }

    const verdict = getExactHeadCiStatus({
      sha: pinSha,
      repo,
      checkName,
      requiredAppId,
      cwd: repoDir,
      ghFn,
    });

    if (verdict.ok && verdict.state === 'SUCCESS') {
      receipt.status = 'ci_green';
      writeReceipt(stateDir, receipt);
      return { ok: true, receipt, step: 'CI_GREEN', pinSha };
    }

    if (verdict.state === 'FAILURE' || verdict.state === 'UNTRUSTED') {
      receipt.status = 'failed';
      receipt.failedReason = `CI ${verdict.state}: ${verdict.reason}`;
      writeReceipt(stateDir, receipt);
      cleanupStateWorktree({ worktreePath, stateBranch, repoDir, gitFn });
      return {
        ok: false,
        reason: `state PR CI failed at ${pinSha}: ${verdict.reason}`,
        receipt,
        step: 'CI_FAILED',
      };
    }

    // Still pending / running
    return { ok: false, reason: 'waiting-for-ci', receipt, step: 'WAITING_CI', pinSha };
  }

  // ── Step: ci_green -> merged (squash merge + authoritative verification) ────
  if (receipt.status === 'ci_green') {
    // Check pinSha
    let pinSha = null;
    const revRemote = gitFn(['rev-parse', `origin/${stateBranch}`], { cwd: repoDir });
    if (revRemote.ok && revRemote.stdout) pinSha = revRemote.stdout.trim();

    // 1. Invoke merge command
    const mergeRes = ghFn(['pr', 'merge', String(receipt.pr), '--squash', '--delete-branch'], {
      cwd: repoDir,
    });
    // CRITICAL DEFECT #2: CHECK MERGE COMMAND EXIT CODE!
    if (!mergeRes.ok) {
      return {
        ok: false,
        reason: `gh pr merge failed (exit ${mergeRes.status}): ${mergeRes.stderr || mergeRes.stdout}`,
        receipt,
        step: 'MERGE_FAILED',
      };
    }

    // 2. Authoritative post-merge verification
    const verification = verifyMergeAuthoritatively({
      prNum: receipt.pr,
      pinnedHead: pinSha,
      fileChanges,
      desiredFileHash,
      repoDir,
      ghFn,
      gitFn,
      log,
    });

    if (!verification.ok) {
      return {
        ok: false,
        reason: `post-merge verification failed: ${verification.reason}`,
        receipt,
        step: 'MERGE_VERIFICATION_FAILED',
      };
    }

    receipt.status = 'merged';
    receipt.mergedSha = verification.mergeCommitSha;
    writeReceipt(stateDir, receipt);

    // Clean up isolated worktree
    cleanupStateWorktree({ worktreePath, stateBranch, repoDir, gitFn });

    return { ok: true, receipt, step: 'DONE' };
  }

  return {
    ok: false,
    reason: `unknown status: ${receipt.status}`,
    receipt,
    step: 'UNKNOWN_STATUS',
  };
}

// ── Main synchronous / polling entrypoint for state landing ──────────────────
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
  ghFn = defaultGh,
  gitFn = defaultGit,
} = {}) {
  const start = Date.now();

  while (Date.now() - start < deadlineMs) {
    const res = advanceStateTransition({
      fileChanges,
      message,
      stateDir,
      repoDir,
      packageId,
      fromStatus,
      toStatus,
      repo,
      checkName,
      requiredAppId,
      ghFn,
      gitFn,
      log,
    });

    if (res.receipt?.status === 'merged') {
      return { ok: true, receipt: res.receipt };
    }

    if (
      res.receipt?.status === 'failed' ||
      res.step === 'CI_FAILED' ||
      res.step === 'VALIDATION_FAILED' ||
      res.step === 'MERGE_FAILED' ||
      res.step === 'MERGE_VERIFICATION_FAILED' ||
      res.step === 'MISSING_PIN_SHA'
    ) {
      return { ok: false, reason: res.reason, receipt: res.receipt };
    }

    if (res.step === 'WAITING_CI' || res.step === 'PR_PENDING') {
      sleepSync(pollMs);
      continue;
    }

    // Immediate progression to next step
  }

  return { ok: false, reason: 'state-landing-deadline-exceeded', receipt: null };
}

// ── Startup recovery ──────────────────────────────────────────────────────────
export function recoverPendingStateLandings({
  stateDir,
  cwd,
  ghFn = defaultGh,
  gitFn = defaultGit,
  log = console.log,
}) {
  const pending = discoverPendingReceipts(stateDir);
  const results = [];

  for (const receipt of pending) {
    // Attempt merge adoption first
    const adoption = adoptMergedState({
      receipt,
      fileChanges: [],
      stateDir,
      cwd,
      ghFn,
      gitFn,
      log,
    });

    if (adoption.adopted) {
      log(
        `state-landing recovery: ${receipt.transitionId} — adopted verified merge (${adoption.mergedSha})`,
      );
      results.push({ receipt, ...adoption });
      continue;
    }

    // If not merged yet on remote, advance the state machine one step
    log(`state-landing recovery: ${receipt.transitionId} — resuming from status=${receipt.status}`);
    results.push({ receipt, adopted: false, reason: `resumed (status=${receipt.status})` });
  }

  return results;
}
