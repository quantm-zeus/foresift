#!/usr/bin/env node
// state-landing.mjs — Protected state landing lane for CI-authority hardening.
//
// HARD LAW: Normal autopilot NEVER direct-pushes a new commit to protected main.
//
// Instead, every state mutation intent follows this deterministic lane:
//
//   mutation intent
//     -> in-memory desired milestone object
//     -> deterministic serialization
//     -> durable state-transition request/receipt
//     -> current origin/main SHA (fetched ONCE at creation)
//     -> isolated ephemeral Git worktree ($STATE_DIR/state-worktrees/<transitionId>)
//     -> apply ONLY whitelist-validated state/planning files
//     -> deterministic local state validation
//     -> push branch
//     -> PR (idempotent — discover existing)
//     -> label 'state-only' for fast CI path
//     -> exact-head CI authorization (durably persisted)
//     -> pre-merge HEAD verification (TOCTOU guard)
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
// INVARIANT: canonical current-milestone.json == origin/main version
//            BEFORE state PR merge. It is NEVER mutated locally before merge.
//
// Crash-safety: atomic state-transition receipts (v2) are written and updated
// at each step. On restart, discoverPendingReceipts() finds any non-terminal receipt
// and advanceStateTransition() resumes progression one step at a time.
//
// Receipt v2 persists desiredFiles, authorizedHeadSha, and the full state needed
// for recovery without caller memory.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { formatMilestoneText } from './schema.mjs';
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

const PROTECTED_CONTROL_PLANE_WHITELIST = [
  ...STATE_ONLY_WHITELIST,
  /^specs\/[a-z0-9]+(?:-[a-z0-9]+)*(?:@g\d+)?\/(?:spec|plan|tasks)\.md$/,
];

// Receipt v2 status values
export const RECEIPT_STATUSES = {
  REQUESTED: 'REQUESTED',
  BRANCH_READY: 'BRANCH_READY',
  BRANCH_PUSHED: 'BRANCH_PUSHED',
  PR_READY: 'PR_READY',
  WAITING_CI: 'WAITING_CI',
  CI_AUTHORIZED: 'CI_AUTHORIZED',
  MERGE_READY: 'MERGE_READY',
  MERGE_REQUESTED: 'MERGE_REQUESTED',
  MERGED: 'MERGED',
  FAILED: 'FAILED',
};

const TERMINAL_STATUSES = new Set([RECEIPT_STATUSES.MERGED, RECEIPT_STATUSES.FAILED]);

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
      // stdio pipes are explicit: without one, execFileSync inherits the
      // parent's stderr and every handled git failure (e.g. a deleted state
      // branch fetched during receipt reconciliation) leaks a raw `fatal:`
      // line into the supervisor journal.
      stdout: execFileSync('git', args, {
        encoding: 'utf8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim(),
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

function computeContentSha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function desiredFilesAreComplete(desiredFiles) {
  return (
    Array.isArray(desiredFiles) &&
    desiredFiles.length > 0 &&
    desiredFiles.every(
      (f) =>
        typeof f.path === 'string' &&
        f.path.length > 0 &&
        typeof f.content === 'string' &&
        typeof f.contentSha256 === 'string' &&
        f.contentSha256 === computeContentSha256(f.content),
    )
  );
}

function revokeAuthorization(receipt) {
  receipt.authorizedHeadSha = null;
  receipt.authorizedAt = null;
  receipt.authorizedCheckName = null;
  receipt.authorizedAppId = null;
}

// ── Whitelist validation ──────────────────────────────────────────────────────
export function validateStateFiles(fileChanges) {
  const paths = fileChanges.map((f) => (typeof f === 'string' ? f : f.path));
  const violations = paths.filter(
    (f) => !PROTECTED_CONTROL_PLANE_WHITELIST.some((pattern) => pattern.test(f.trim())),
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
      if (!TERMINAL_STATUSES.has(r.status)) {
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
  repo = DEFAULT_REPO,
  authorizedCheckName,
  authorizedAppId,
  ghFn = defaultGh,
  gitFn = defaultGit,
}) {
  if (!pinnedHead || !authorizedCheckName || !authorizedAppId) {
    return { ok: false, reason: 'missing immutable exact-head CI authority' };
  }
  if (!Array.isArray(fileChanges) || fileChanges.length === 0) {
    return { ok: false, reason: 'desiredFiles must be non-empty for merge verification' };
  }
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

  if (!prData.headRefOid || prData.headRefOid !== pinnedHead) {
    return {
      ok: false,
      reason: `PR #${prNum} head (${prData.headRefOid}) does not match authorized pinned head (${pinnedHead})`,
    };
  }

  const ciVerdict = getExactHeadCiStatus({
    sha: pinnedHead,
    repo,
    checkName: authorizedCheckName,
    requiredAppId: authorizedAppId,
    cwd: repoDir,
    ghFn,
  });
  if (!ciVerdict.ok || ciVerdict.state !== 'SUCCESS') {
    return {
      ok: false,
      reason: `trusted exact-head CI is not SUCCESS for authorized head ${pinnedHead}: ${ciVerdict.reason}`,
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
  stateDir,
  cwd,
  ghFn = defaultGh,
  gitFn = defaultGit,
  log = console.log,
}) {
  if (receipt.schema !== 'foresift/state-transition@2') {
    return { adopted: false, mergedSha: null, reason: 'LEGACY_RECEIPT_BLOCKED' };
  }
  if (!receipt.prNumber && !receipt.pr) return { adopted: false, mergedSha: null };
  const authorityComplete =
    desiredFilesAreComplete(receipt.desiredFiles) &&
    typeof receipt.authorizedHeadSha === 'string' &&
    receipt.authorizedHeadSha.length > 0 &&
    typeof receipt.authorizedCheckName === 'string' &&
    receipt.authorizedCheckName.length > 0 &&
    Number.isInteger(Number(receipt.authorizedAppId)) &&
    Number(receipt.authorizedAppId) > 0;
  if (!authorityComplete) {
    return { adopted: false, mergedSha: null, reason: 'missing complete v2 merge authority' };
  }

  const fileChanges = receipt.desiredFiles.map((f) => ({
    path: f.path,
    content: f.content,
  }));

  const verification = verifyMergeAuthoritatively({
    prNum: receipt.prNumber ?? receipt.pr,
    pinnedHead: receipt.authorizedHeadSha,
    fileChanges,
    repoDir: cwd,
    authorizedCheckName: receipt.authorizedCheckName,
    authorizedAppId: receipt.authorizedAppId,
    ghFn,
    gitFn,
    log,
  });

  if (verification.ok) {
    receipt.status = RECEIPT_STATUSES.MERGED;
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

// ── Legacy v1 receipt migration ───────────────────────────────────────────────
function migrateV1Receipt(v1) {
  if (v1.schema === 'foresift/state-transition@2') return v1;

  // v1 receipts lack desiredFiles and authorizedHeadSha.
  // If they have enough information we can migrate; otherwise block.
  const v2 = {
    schema: 'foresift/state-transition@2',
    transitionId: v1.transitionId,
    logicalTransitionKey: v1.transitionId, // best effort
    packageId: v1.package ?? null,
    fromStatus: v1.from ?? null,
    toStatus: v1.to ?? null,
    sourceMainSha: v1.sourceSha ?? null,
    desiredFileHash: v1.desiredFileHash ?? null,
    desiredFiles: [], // v1 did not persist these
    commitMessage: null,
    stateBranch: v1.stateBranch,
    stateWorktree: null,
    prNumber: v1.pr ?? null,
    prUrl: v1.prUrl ?? null,
    authorizedHeadSha: null, // v1 did not persist this
    authorizedAt: null,
    authorizedCheckName: null,
    authorizedAppId: null,
    status: mapV1Status(v1.status),
    retryClass: null,
    retryCount: 0,
    nextRetryAt: null,
    mergedSha: v1.mergedSha ?? null,
    failedReason: v1.failedReason ?? null,
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
  };

  // No legacy status, including a claimed merge, may bypass missing immutable authority.
  if (v2.desiredFiles.length === 0) {
    v2.status = RECEIPT_STATUSES.FAILED;
    v2.failedReason = 'LEGACY_RECEIPT_BLOCKED: v1 receipt lacks desiredFiles for safe recovery';
    v2.retryClass = 'TERMINAL_CORRUPTION';
  }

  return v2;
}

function mapV1Status(v1Status) {
  const map = {
    pending: RECEIPT_STATUSES.REQUESTED,
    branch_created: RECEIPT_STATUSES.BRANCH_READY,
    pr_created: RECEIPT_STATUSES.PR_READY,
    ci_green: RECEIPT_STATUSES.CI_AUTHORIZED,
    merged: RECEIPT_STATUSES.MERGED,
    failed: RECEIPT_STATUSES.FAILED,
  };
  return map[v1Status] || RECEIPT_STATUSES.REQUESTED;
}

// ── Step-Based State Machine Advancement ──────────────────────────────────────
/**
 * Advances a state landing transition by one deterministic step without blocking sleeps.
 * Designed for supervisor event-loop outbox execution.
 *
 * Receipt v2 lifecycle:
 *   REQUESTED
 *     -> create isolated worktree ($STATE_DIR/state-worktrees/<transitionId>)
 *     -> apply file changes, stage, commit
 *     -> status = 'BRANCH_READY'
 *
 *   BRANCH_READY
 *     -> push state branch to origin
 *     -> status = 'BRANCH_PUSHED'
 *
 *   BRANCH_PUSHED
 *     -> create or discover PR on GitHub
 *     -> status = 'PR_READY'
 *
 *   PR_READY / WAITING_CI
 *     -> resolve exact remote HEAD SHA
 *     -> query exact-head CI
 *     -> if green: persist authorization, status = 'CI_AUTHORIZED'
 *     -> if failure/untrusted: status = 'FAILED'
 *     -> if pending: status = 'WAITING_CI', return immediately
 *
 *   CI_AUTHORIZED
 *     -> verify authorizedHeadSha still matches PR HEAD and remote branch HEAD
 *     -> re-verify CI at authorizedHeadSha
 *     -> if all checks pass: status = 'MERGE_READY'
 *     -> if HEAD changed: clear authorization, status = 'WAITING_CI'
 *
 *   MERGE_READY
 *     -> execute squash merge via gh pr merge
 *     -> status = 'MERGE_REQUESTED'
 *
 *   MERGE_REQUESTED
 *     -> authoritatively verify merge on origin/main
 *     -> cleanup worktree & branch
 *     -> status = 'MERGED'
 *
 * Returns { ok, receipt, step, reason }
 *
 * CRITICAL DESIGN INVARIANT:
 *   - Transition identity (transitionId, sourceMainSha) is created ONCE at receipt creation.
 *   - If an existingReceipt is provided, its identity is NEVER re-derived.
 *   - A different origin/main appearing while state PR waits does NOT create another transition.
 */
export async function advanceStateTransition({
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
  initializeOnly = false,
  ghFn = defaultGh,
  gitFn = defaultGit,
  log = console.log,
} = {}) {
  // ── Migrate legacy v1 receipts ───────────────────────────────────────────────
  if (existingReceipt && existingReceipt.schema === 'foresift/state-transition@1') {
    existingReceipt = migrateV1Receipt(existingReceipt);
    writeReceipt(stateDir, existingReceipt);
    if (existingReceipt.status === RECEIPT_STATUSES.FAILED) {
      return {
        ok: false,
        reason: existingReceipt.failedReason,
        receipt: existingReceipt,
        step: 'LEGACY_BLOCKED',
      };
    }
  }

  // ── If existing receipt has identity, use it (F6: create once, never re-derive) ──
  let receipt = existingReceipt;
  let sourceMainSha;
  let desiredFileHash;
  let transitionId;

  if (receipt && receipt.transitionId) {
    // EXISTING RECEIPT: use its persisted identity
    sourceMainSha = receipt.sourceMainSha ?? receipt.sourceSha;
    desiredFileHash = receipt.desiredFileHash;
    transitionId = receipt.transitionId;

    // Use desiredFiles from receipt if caller didn't provide fileChanges
    if ((!fileChanges || fileChanges.length === 0) && receipt.desiredFiles?.length > 0) {
      fileChanges = receipt.desiredFiles.map((f) => ({ path: f.path, content: f.content }));
    }
  } else {
    // NEW RECEIPT: fetch origin/main ONCE, create identity
    if (!Array.isArray(fileChanges) || fileChanges.length === 0) {
      return {
        ok: false,
        reason: 'state landing refused: desiredFiles must be non-empty',
        receipt: null,
        step: 'VALIDATION_FAILED',
      };
    }
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

    // 1b. Prettier-format JSON content so state PRs never fail format:check.
    // (Prettier collapses short arrays; raw JSON.stringify does not — observed
    // live 2026-08-30 on state PR #102, whose CI failed Formatting check.)
    fileChanges = await Promise.all(
      fileChanges.map(async (f) => ({
        path: f.path,
        content: await formatMilestoneText(f.content),
      })),
    );

    // 2. Fetch and resolve current origin/main ONCE
    const fetchRes = gitFn(['fetch', 'origin', 'main', '--quiet'], { cwd: repoDir });
    if (!fetchRes.ok) {
      return {
        ok: false,
        reason: `fetch origin main failed: ${fetchRes.stderr}`,
        receipt: null,
        step: 'FETCH_FAILED',
      };
    }

    const revRes = gitFn(['rev-parse', 'origin/main'], { cwd: repoDir });
    if (!revRes.ok || !revRes.stdout) {
      return {
        ok: false,
        reason: 'rev-parse origin/main failed',
        receipt: null,
        step: 'REV_PARSE_FAILED',
      };
    }
    sourceMainSha = revRes.stdout.trim();

    // 3. Compute desired file hash for idempotency
    desiredFileHash = hashFileChanges(fileChanges);

    // 4. Build stable logical transition key (does NOT include sourceMainSha)
    const logicalTransitionKey = [
      packageId ?? 'milestone',
      fromStatus ?? 'unknown',
      toStatus ?? 'unknown',
      desiredFileHash.slice(0, 12),
    ].join('-');

    // 5. Build transitionId (includes sourceMainSha for uniqueness)
    transitionId = [
      packageId ?? 'milestone',
      fromStatus ?? 'unknown',
      toStatus ?? 'unknown',
      sourceMainSha.slice(0, 8),
      desiredFileHash.slice(0, 8),
    ].join('-');

    // Check for existing receipt with same transitionId
    receipt = readReceipt(stateDir, transitionId);

    // Already merged? Return immediately
    if (receipt && receipt.status === RECEIPT_STATUSES.MERGED) {
      return { ok: true, receipt, step: 'DONE' };
    }

    // Also check for existing receipt with same logicalTransitionKey but different sourceMainSha
    // (This prevents creating a second transition if main advanced)
    if (!receipt) {
      const allPending = discoverPendingReceipts(stateDir);
      const existingLogical = allPending.find(
        (r) => r.logicalTransitionKey === logicalTransitionKey,
      );
      if (existingLogical) {
        // Reuse the existing transition — do NOT create a second one
        receipt = existingLogical;
        transitionId = receipt.transitionId;
        sourceMainSha = receipt.sourceMainSha;
        desiredFileHash = receipt.desiredFileHash;
        log(
          `state-landing: reusing existing transition ${transitionId} (main advanced but logical key matches)`,
        );
      }
    }

    // Initialize receipt if not present
    if (!receipt) {
      const stateBranch = `state/chore/${transitionId}`;
      const worktreePath = join(worktreesBaseDir(stateDir), transitionId);

      receipt = {
        schema: 'foresift/state-transition@2',
        transitionId,
        logicalTransitionKey,
        packageId,
        fromStatus,
        toStatus,
        sourceMainSha,
        desiredFileHash,
        desiredFiles: fileChanges.map((f) => ({
          path: f.path,
          content: f.content,
          contentSha256: computeContentSha256(f.content),
        })),
        commitMessage: message,
        stateBranch,
        stateWorktree: worktreePath,
        prNumber: null,
        prUrl: null,
        authorizedHeadSha: null,
        authorizedAt: null,
        authorizedCheckName: null,
        authorizedAppId: null,
        status: RECEIPT_STATUSES.REQUESTED,
        retryClass: null,
        retryCount: 0,
        nextRetryAt: null,
        mergedSha: null,
        failedReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeReceipt(stateDir, receipt);
    }
  }

  const { stateBranch } = receipt;
  const worktreePath = receipt.stateWorktree || join(worktreesBaseDir(stateDir), transitionId);

  if (!desiredFilesAreComplete(receipt.desiredFiles)) {
    receipt.status = RECEIPT_STATUSES.FAILED;
    receipt.failedReason = 'v2 receipt has missing or invalid desired file hashes';
    receipt.retryClass = 'TERMINAL_CORRUPTION';
    writeReceipt(stateDir, receipt);
    return { ok: false, receipt, reason: receipt.failedReason, step: 'INVALID_RECEIPT' };
  }

  if (initializeOnly) {
    return { ok: true, receipt, step: receipt.status };
  }

  if (
    receipt.status === RECEIPT_STATUSES.WAITING_CI &&
    receipt.nextRetryAt &&
    new Date(receipt.nextRetryAt).getTime() > Date.now()
  ) {
    return { ok: false, receipt, reason: 'waiting-for-ci-retry-window', step: 'WAITING_CI' };
  }

  // ── Step: REQUESTED -> BRANCH_READY (in isolated worktree) ──────────────────
  if (receipt.status === RECEIPT_STATUSES.REQUESTED) {
    mkdirSync(worktreesBaseDir(stateDir), { recursive: true });

    // Clean up any stale worktree or branch
    cleanupStateWorktree({ worktreePath, stateBranch, repoDir, gitFn });

    // Need a valid sourceMainSha to create worktree from
    const srcSha = receipt.sourceMainSha || sourceMainSha;
    if (!srcSha) {
      return {
        ok: false,
        reason: 'no sourceMainSha available for worktree creation',
        receipt,
        step: 'MISSING_SOURCE_SHA',
      };
    }

    // Create isolated worktree on new state branch from sourceMainSha
    const wtAdd = gitFn(['worktree', 'add', '-b', stateBranch, worktreePath, srcSha], {
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
      receipt.status = RECEIPT_STATUSES.MERGED;
      receipt.mergedSha = srcSha;
      writeReceipt(stateDir, receipt);
      cleanupStateWorktree({ worktreePath, stateBranch, repoDir, gitFn });
      return { ok: true, receipt, step: 'ALREADY_CURRENT' };
    }

    // Commit changes in worktree
    const commitMsg = receipt.commitMessage || message;
    const commitRes = gitFn(
      [
        '-c',
        'user.name=Foresift Autopilot',
        '-c',
        'user.email=autopilot@foresift.local',
        'commit',
        '-m',
        commitMsg,
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

    receipt.status = RECEIPT_STATUSES.BRANCH_READY;
    writeReceipt(stateDir, receipt);
    return { ok: true, receipt, step: 'BRANCH_READY' };
  }

  // ── Step: BRANCH_READY -> BRANCH_PUSHED ─────────────────────────────────────
  if (receipt.status === RECEIPT_STATUSES.BRANCH_READY) {
    const pushRes = gitFn(['push', '-u', 'origin', stateBranch, '--quiet', '--force-with-lease'], {
      cwd: repoDir,
    });
    if (!pushRes.ok) {
      receipt.retryCount = (receipt.retryCount || 0) + 1;
      receipt.retryClass = 'RETRYABLE';
      receipt.nextRetryAt = new Date(Date.now() + 30_000).toISOString();
      writeReceipt(stateDir, receipt);
      return {
        ok: false,
        reason: `push state branch failed: ${pushRes.stderr}`,
        receipt,
        step: 'PUSH_FAILED',
      };
    }

    receipt.status = RECEIPT_STATUSES.BRANCH_PUSHED;
    writeReceipt(stateDir, receipt);
    return { ok: true, receipt, step: 'BRANCH_PUSHED' };
  }

  // ── Step: BRANCH_PUSHED -> PR_READY ─────────────────────────────────────────
  if (receipt.status === RECEIPT_STATUSES.BRANCH_PUSHED) {
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
      const srcSha = receipt.sourceMainSha || sourceMainSha;
      const commitMsg = receipt.commitMessage || message;
      const isStateOnly = (receipt.desiredFiles || []).every((file) =>
        STATE_ONLY_WHITELIST.some((pattern) => pattern.test(file.path)),
      );
      const prBody =
        `Automated protected control-plane chore.\n\nTransition: \`${transitionId}\`\nSource SHA: \`${srcSha}\`\n\n` +
        '> This PR was created by the Foresift supervisor state-landing lane.\n' +
        '> CI classifies the actual diff and runs the required exact-head gate before merge.';
      let createPrRes = ghFn(
        [
          'pr',
          'create',
          '--head',
          stateBranch,
          '--base',
          'main',
          '--title',
          commitMsg,
          '--body',
          prBody,
          ...(isStateOnly ? ['--label', 'state-only'] : []),
        ],
        { cwd: repoDir },
      );
      if (!createPrRes.ok) {
        createPrRes = ghFn(
          [
            'pr',
            'create',
            '--head',
            stateBranch,
            '--base',
            'main',
            '--title',
            commitMsg,
            '--body',
            prBody,
          ],
          { cwd: repoDir },
        );
      }
      if (createPrRes.ok) {
        const m = /\/pull\/(\d+)/.exec(createPrRes.stdout.split('\n').pop() ?? '');
        if (m) prNum = m[1];
      }
    }

    if (!prNum) {
      // Transient PR creation refusal — remain at BRANCH_PUSHED for retry
      receipt.retryCount = (receipt.retryCount || 0) + 1;
      receipt.retryClass = 'RETRYABLE';
      receipt.nextRetryAt = new Date(Date.now() + 30_000).toISOString();
      writeReceipt(stateDir, receipt);
      return { ok: false, reason: 'pr-creation-pending', receipt, step: 'PR_PENDING' };
    }

    receipt.prNumber = prNum;
    receipt.status = RECEIPT_STATUSES.PR_READY;
    writeReceipt(stateDir, receipt);
    return { ok: true, receipt, step: 'PR_READY' };
  }

  // ── Step: PR_READY / WAITING_CI -> CI_AUTHORIZED ────────────────────────────
  if (
    receipt.status === RECEIPT_STATUSES.PR_READY ||
    receipt.status === RECEIPT_STATUSES.WAITING_CI
  ) {
    // Resolve exact HEAD SHA of the state branch on remote
    let pinSha = null;
    const fetchBranchRes = gitFn(['fetch', 'origin', stateBranch, '--quiet'], { cwd: repoDir });
    if (fetchBranchRes.ok) {
      const revRemote = gitFn(['rev-parse', `origin/${stateBranch}`], { cwd: repoDir });
      if (revRemote.ok && revRemote.stdout) {
        pinSha = revRemote.stdout.trim();
      }
    }
    if (!pinSha) {
      const revLocal = gitFn(['rev-parse', stateBranch], { cwd: repoDir });
      if (revLocal.ok && revLocal.stdout) pinSha = revLocal.stdout.trim();
    }

    // FAIL CLOSED: NO SHA MUST NEVER BECOME CI GREEN!
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
      // F4: Persist authorization BEFORE moving to CI_AUTHORIZED
      receipt.authorizedHeadSha = pinSha;
      receipt.authorizedAt = new Date().toISOString();
      receipt.authorizedCheckName = checkName;
      receipt.authorizedAppId = requiredAppId;
      receipt.status = RECEIPT_STATUSES.CI_AUTHORIZED;
      writeReceipt(stateDir, receipt);
      return { ok: true, receipt, step: 'CI_AUTHORIZED', pinSha };
    }

    if (verdict.state === 'FAILURE' || verdict.state === 'UNTRUSTED') {
      receipt.status = RECEIPT_STATUSES.FAILED;
      receipt.failedReason = `CI ${verdict.state}: ${verdict.reason}`;
      receipt.retryClass = 'AUTHORITY_REFUSAL';
      writeReceipt(stateDir, receipt);
      // Do NOT destroy worktree on authority refusal — preserve evidence
      return {
        ok: false,
        reason: `state PR CI failed at ${pinSha}: ${verdict.reason}`,
        receipt,
        step: 'CI_FAILED',
      };
    }

    // Still pending / running — mark WAITING_CI and return immediately (NO BLOCKING)
    receipt.status = RECEIPT_STATUSES.WAITING_CI;
    receipt.nextRetryAt = new Date(Date.now() + 15_000).toISOString();
    writeReceipt(stateDir, receipt);
    return { ok: false, reason: 'waiting-for-ci', receipt, step: 'WAITING_CI', pinSha };
  }

  // ── Step: CI_AUTHORIZED -> MERGE_READY ──────────────────────────────────────
  if (receipt.status === RECEIPT_STATUSES.CI_AUTHORIZED) {
    // F4/F8: TOCTOU guard — verify authorizedHeadSha still matches PR HEAD
    const prViewRes = ghFn(
      ['pr', 'view', String(receipt.prNumber), '--json', 'state,headRefOid,baseRefName'],
      { cwd: repoDir },
    );
    if (!prViewRes.ok) {
      return {
        ok: false,
        reason: `cannot query PR for TOCTOU check: ${prViewRes.stderr}`,
        receipt,
        step: 'TOCTOU_QUERY_FAILED',
      };
    }

    let prData;
    try {
      prData = JSON.parse(prViewRes.stdout);
    } catch {
      return {
        ok: false,
        reason: 'PR query unparseable',
        receipt,
        step: 'TOCTOU_QUERY_FAILED',
      };
    }

    // Check 1: PR headRefOid matches authorizedHeadSha
    if (prData.headRefOid !== receipt.authorizedHeadSha) {
      const revokedHead = receipt.authorizedHeadSha;
      log(
        `state-landing TOCTOU: PR HEAD (${prData.headRefOid}) !== authorized (${receipt.authorizedHeadSha}). Clearing authorization.`,
      );
      revokeAuthorization(receipt);
      receipt.status = RECEIPT_STATUSES.WAITING_CI;
      writeReceipt(stateDir, receipt);
      return {
        ok: false,
        reason: `HEAD changed: authorized=${revokedHead}, actual=${prData.headRefOid}`,
        receipt,
        step: 'HEAD_CHANGED',
      };
    }

    // Check 2: Remote state branch HEAD matches authorizedHeadSha
    const fetchBranchRes = gitFn(['fetch', 'origin', stateBranch, '--quiet'], { cwd: repoDir });
    if (fetchBranchRes.ok) {
      const revRemote = gitFn(['rev-parse', `origin/${stateBranch}`], { cwd: repoDir });
      if (revRemote.ok && revRemote.stdout) {
        const remoteBranchHead = revRemote.stdout.trim();
        if (remoteBranchHead !== receipt.authorizedHeadSha) {
          log(
            `state-landing TOCTOU: remote branch HEAD (${remoteBranchHead}) !== authorized (${receipt.authorizedHeadSha}). Clearing authorization.`,
          );
          revokeAuthorization(receipt);
          receipt.status = RECEIPT_STATUSES.WAITING_CI;
          writeReceipt(stateDir, receipt);
          return {
            ok: false,
            reason: `remote branch HEAD changed`,
            receipt,
            step: 'HEAD_CHANGED',
          };
        }
      }
    }

    // Check 3: Re-verify CI at authorizedHeadSha
    const reVerdict = getExactHeadCiStatus({
      sha: receipt.authorizedHeadSha,
      repo,
      checkName: receipt.authorizedCheckName || checkName,
      requiredAppId: receipt.authorizedAppId || requiredAppId,
      cwd: repoDir,
      ghFn,
    });

    if (!reVerdict.ok || reVerdict.state !== 'SUCCESS') {
      const revokedHead = receipt.authorizedHeadSha;
      revokeAuthorization(receipt);
      receipt.status = RECEIPT_STATUSES.WAITING_CI;
      writeReceipt(stateDir, receipt);
      return {
        ok: false,
        reason: `CI re-verification failed for ${revokedHead}`,
        receipt,
        step: 'CI_REVERIFY_FAILED',
      };
    }

    receipt.status = RECEIPT_STATUSES.MERGE_READY;
    writeReceipt(stateDir, receipt);
    return { ok: true, receipt, step: 'MERGE_READY' };
  }

  // ── Step: MERGE_READY -> MERGE_REQUESTED ────────────────────────────────────
  if (receipt.status === RECEIPT_STATUSES.MERGE_READY) {
    if (
      !receipt.authorizedHeadSha ||
      !receipt.authorizedCheckName ||
      receipt.authorizedAppId === null ||
      receipt.authorizedAppId === undefined
    ) {
      return {
        ok: false,
        reason: 'merge authority is incomplete',
        receipt,
        step: 'MISSING_AUTHORITY',
      };
    }
    const prViewRes = ghFn(
      ['pr', 'view', String(receipt.prNumber), '--json', 'state,headRefOid,baseRefName'],
      { cwd: repoDir },
    );
    let prData;
    try {
      prData = prViewRes.ok ? JSON.parse(prViewRes.stdout) : null;
    } catch {
      prData = null;
    }
    // Reconciliation: the PR may already be MERGED — the merge can land in a
    // process that dies before finalizing, or an operator may merge directly.
    // A merged PR at the AUTHORIZED head is not an authority violation; it is
    // a completed merge whose receipt must finalize through the same
    // authoritative post-merge verification as the MERGE_REQUESTED step.
    // (Observed live 2026-08-28: PR #82 merged while its receipt sat at
    // CI_AUTHORIZED, then this step's OPEN-only guard revoked and re-authorized
    // forever — a permanent CI_AUTHORIZED ↔ MERGE_READY live-lock.)
    if (prData && prData.state === 'MERGED') {
      if (prData.headRefOid !== receipt.authorizedHeadSha) {
        receipt.status = RECEIPT_STATUSES.FAILED;
        receipt.failedReason = `PR #${receipt.prNumber} merged at unauthorized head ${prData.headRefOid} (authorized ${receipt.authorizedHeadSha})`;
        receipt.retryClass = 'AUTHORITY_REFUSAL';
        writeReceipt(stateDir, receipt);
        return {
          ok: false,
          reason: receipt.failedReason,
          receipt,
          step: 'MERGE_AUTHORITY_CHANGED',
        };
      }
      const verification = verifyMergeAuthoritatively({
        prNum: receipt.prNumber,
        pinnedHead: receipt.authorizedHeadSha,
        fileChanges: (receipt.desiredFiles || []).map((f) => ({
          path: f.path,
          content: f.content,
        })),
        repoDir,
        repo,
        authorizedCheckName: receipt.authorizedCheckName,
        authorizedAppId: receipt.authorizedAppId,
        ghFn,
        gitFn,
        log,
      });
      if (!verification.ok) {
        // Bounded retry for transient verification failures (API/fetch blips);
        // a verification that keeps failing is an authority refusal the
        // operator must reconcile — never an automatic live-lock.
        receipt.retryCount = (receipt.retryCount || 0) + 1;
        if (receipt.retryCount > 5) {
          receipt.status = RECEIPT_STATUSES.FAILED;
          receipt.failedReason = `post-merge verification failed: ${verification.reason}`;
          receipt.retryClass = 'AUTHORITY_REFUSAL';
        } else {
          receipt.retryClass = 'RETRYABLE';
          receipt.nextRetryAt = new Date(Date.now() + 30_000).toISOString();
        }
        writeReceipt(stateDir, receipt);
        return {
          ok: false,
          reason: `post-merge verification failed: ${verification.reason}`,
          receipt,
          step: 'MERGE_VERIFICATION_FAILED',
        };
      }
      receipt.status = RECEIPT_STATUSES.MERGED;
      receipt.mergedSha = verification.mergeCommitSha;
      writeReceipt(stateDir, receipt);
      cleanupStateWorktree({ worktreePath, stateBranch, repoDir, gitFn });
      return { ok: true, receipt, step: 'DONE' };
    }
    const fetchBranchRes = gitFn(['fetch', 'origin', stateBranch, '--quiet'], { cwd: repoDir });
    const remoteHeadRes = fetchBranchRes.ok
      ? gitFn(['rev-parse', `origin/${stateBranch}`], { cwd: repoDir })
      : { ok: false, stdout: '' };
    const ciVerdict = getExactHeadCiStatus({
      sha: receipt.authorizedHeadSha,
      repo,
      checkName: receipt.authorizedCheckName,
      requiredAppId: receipt.authorizedAppId,
      cwd: repoDir,
      ghFn,
    });
    if (
      !prData ||
      prData.state !== 'OPEN' ||
      prData.headRefOid !== receipt.authorizedHeadSha ||
      !remoteHeadRes.ok ||
      remoteHeadRes.stdout.trim() !== receipt.authorizedHeadSha ||
      !ciVerdict.ok ||
      ciVerdict.state !== 'SUCCESS'
    ) {
      revokeAuthorization(receipt);
      receipt.status = RECEIPT_STATUSES.WAITING_CI;
      receipt.nextRetryAt = new Date(Date.now() + 15_000).toISOString();
      writeReceipt(stateDir, receipt);
      return {
        ok: false,
        reason: 'immediate pre-merge exact-head authority check failed',
        receipt,
        step: 'MERGE_AUTHORITY_CHANGED',
      };
    }
    const mergeRes = ghFn(
      [
        'pr',
        'merge',
        String(receipt.prNumber),
        '--squash',
        '--delete-branch',
        '--match-head-commit',
        receipt.authorizedHeadSha,
      ],
      { cwd: repoDir },
    );
    if (!mergeRes.ok) {
      // Merge rejected — may be transient or authority issue
      if (mergeRes.status === 1) {
        receipt.retryCount = (receipt.retryCount || 0) + 1;
        receipt.retryClass = 'RETRYABLE';
        receipt.nextRetryAt = new Date(Date.now() + 30_000).toISOString();
        writeReceipt(stateDir, receipt);
      }
      return {
        ok: false,
        reason: `gh pr merge failed (exit ${mergeRes.status}): ${mergeRes.stderr || mergeRes.stdout}`,
        receipt,
        step: 'MERGE_FAILED',
      };
    }

    receipt.status = RECEIPT_STATUSES.MERGE_REQUESTED;
    writeReceipt(stateDir, receipt);
    return { ok: true, receipt, step: 'MERGE_REQUESTED' };
  }

  // ── Step: MERGE_REQUESTED -> MERGED (authoritative verification) ────────────
  if (receipt.status === RECEIPT_STATUSES.MERGE_REQUESTED) {
    const verifyFileChanges = (receipt.desiredFiles || []).map((f) => ({
      path: f.path,
      content: f.content,
    }));

    const verification = verifyMergeAuthoritatively({
      prNum: receipt.prNumber,
      pinnedHead: receipt.authorizedHeadSha,
      fileChanges: verifyFileChanges,
      repoDir,
      repo,
      authorizedCheckName: receipt.authorizedCheckName,
      authorizedAppId: receipt.authorizedAppId,
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

    receipt.status = RECEIPT_STATUSES.MERGED;
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

// ── Startup recovery ──────────────────────────────────────────────────────────
/**
 * On startup, discover non-terminal receipts and resume each one.
 * This MUST actually advance each receipt, not just log.
 */
export async function recoverPendingStateLandings({
  stateDir,
  repoDir,
  cwd,
  repo = DEFAULT_REPO,
  checkName = DEFAULT_REQUIRED_CHECK,
  requiredAppId = DEFAULT_REQUIRED_APP_ID,
  ghFn = defaultGh,
  gitFn = defaultGit,
  log = console.log,
}) {
  const pending = discoverPendingReceipts(stateDir);
  const results = [];
  const effectiveRepoDir = repoDir || cwd;

  for (const receipt of pending) {
    // Attempt merge adoption first (handles remote PR already MERGED but receipt stale)
    const adoption = adoptMergedState({
      receipt,
      stateDir,
      cwd: effectiveRepoDir,
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

    // If not merged yet on remote, actually advance the state machine one step
    log(
      `state-landing recovery: ${receipt.transitionId} — advancing from status=${receipt.status}`,
    );

    // Extract fileChanges from receipt's desiredFiles for advancement
    const fileChanges = (receipt.desiredFiles || []).map((f) => ({
      path: f.path,
      content: f.content,
    }));

    const advanceResult = await advanceStateTransition({
      receipt,
      fileChanges,
      message: receipt.commitMessage || `chore: resume state transition ${receipt.transitionId}`,
      stateDir,
      repoDir: effectiveRepoDir,
      packageId: receipt.packageId,
      fromStatus: receipt.fromStatus,
      toStatus: receipt.toStatus,
      repo,
      checkName,
      requiredAppId,
      ghFn,
      gitFn,
      log,
    });

    results.push({
      receipt: advanceResult.receipt || receipt,
      adopted: false,
      advanced: true,
      step: advanceResult.step,
      reason: advanceResult.reason || `advanced (step=${advanceResult.step})`,
    });
  }

  return results;
}
