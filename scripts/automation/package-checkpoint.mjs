#!/usr/bin/env node
// Durable implementation checkpoint (task spec §12).
//
//   $ARTIFACTS_DIR/implementation-checkpoint.json
//
// CACHE/INDEX only — never an authority. Completion authority stays
// package-implement-complete.mjs; the gate stays the verification authority.
// Fresh implementation turns read a VALIDATED checkpoint to avoid rereading
// large irrelevant contract sections; any hash mismatch invalidates it.
//
// CLI:
//   package-checkpoint.mjs --build    --package <id> --artifacts-dir <dir> [options]
//   package-checkpoint.mjs --validate --package <id> --artifacts-dir <dir>
//   (exit 0 = valid / written; nonzero = invalid or refused; JSON on stdout)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CHECKPOINT_FILE = 'implementation-checkpoint.json';

export function sha256File(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

/** Count checked/unchecked Spec Kit tasks in tasks.md text. */
export function parseTasksMd(text) {
  const completed = (text.match(/^\s*- \[x\]/gim) ?? []).length;
  const open = (text.match(/^\s*- \[ \]/gim) ?? []).length;
  return { completed, total: completed + open, remaining: open };
}

/**
 * Build a checkpoint record. `sources` maps label → absolute path of every
 * authoritative file whose content the cached context depends on (spec kit
 * artifacts, milestone state, plan artifacts). Their content hashes ride in
 * the record so any later change invalidates the cache.
 */
export function buildCheckpoint(input) {
  const required = ['packageId', 'headSha', 'slice', 'tasks'];
  for (const k of required)
    if (input[k] === undefined || input[k] === null || input[k] === '')
      throw new Error(`checkpoint field '${k}' is required`);
  const sources = {};
  for (const [label, p] of Object.entries(input.sources ?? {}))
    sources[label] = { path: p, sha256: sha256File(p) };
  return {
    schema: 'foresift/implementation-checkpoint@1',
    packageId: input.packageId,
    headSha: input.headSha,
    completedTasks: input.tasks.completed,
    totalTasks: input.tasks.total,
    remainingTasks: input.tasks.remaining,
    slice: {
      id: input.slice.id ?? null,
      description: input.slice.description ?? null,
      taskIds: input.slice.taskIds ?? [],
      nextTaskId: input.slice.nextTaskId ?? null,
    },
    requirementIds: input.requirementIds ?? [],
    acceptanceIds: input.acceptanceIds ?? [],
    filesTouched: input.filesTouched ?? [],
    targetedChecks: input.targetedChecks ?? [], // [{command, result}]
    sourceHashes: sources,
    prdReferences: input.prdReferences ?? [],
    adrReferences: input.adrReferences ?? [],
    blocker: input.blocker ?? null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validate a checkpoint against current reality: HEAD must match and every
 * recorded source hash must still match the file on disk. Returns
 * { valid, reasons } — NEVER throws for an invalid cache; callers treat an
 * invalid checkpoint as "absent" (rebuild, do not trust).
 */
export function validateCheckpoint(cp, expected = {}) {
  const reasons = [];
  if (!cp || cp.schema !== 'foresift/implementation-checkpoint@1')
    return { valid: false, reasons: ['missing or unknown checkpoint schema'] };
  if (expected.packageId && cp.packageId !== expected.packageId)
    reasons.push(`packageId ${cp.packageId} ≠ ${expected.packageId}`);
  if (expected.headSha && cp.headSha !== expected.headSha)
    reasons.push(
      `HEAD moved since checkpoint (${cp.headSha?.slice(0, 8)} ≠ ${expected.headSha.slice(0, 8)})`,
    );
  for (const [label, rec] of Object.entries(cp.sourceHashes ?? {})) {
    if (!rec.path) {
      reasons.push(`source '${label}' has no recorded path`);
      continue;
    }
    if (rec.sha256 == null) {
      // Absent at build time (optional sources such as plan artifacts are
      // recorded with a null hash). Still absent ⇒ nothing drifted; APPEARED
      // since ⇒ the cached context never saw a file now sitting at a tracked
      // path, which is drift.
      if (existsSync(rec.path)) reasons.push(`source '${label}' appeared since checkpoint`);
      continue;
    }
    if (!existsSync(rec.path)) {
      reasons.push(`source '${label}' no longer exists`);
      continue;
    }
    const now = sha256File(rec.path);
    if (now !== rec.sha256) reasons.push(`source '${label}' changed since checkpoint`);
  }
  if (typeof cp.completedTasks !== 'number' || typeof cp.totalTasks !== 'number')
    reasons.push('task counters missing');
  return { valid: reasons.length === 0, reasons };
}

function parseArgs(argv) {
  const a = { sources: {} };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--build':
        a.build = true;
        break;
      case '--validate':
        a.validate = true;
        break;
      case '--package':
        a.package = argv[++i];
        break;
      case '--artifacts-dir':
        a.artifactsDir = argv[++i];
        break;
      case '--repo-root':
        a.repoRoot = argv[++i];
        break;
      case '--head':
        a.head = argv[++i];
        break;
      case '--slice-id':
        a.sliceId = argv[++i];
        break;
      case '--slice-tasks':
        a.sliceTasks = argv[++i];
        break; // comma-separated ids
      case '--files':
        a.files = argv[++i];
        break; // comma-separated
      case '--checks':
        a.checks = argv[++i];
        break; // JSON [{command,result}]
      case '--blocker':
        a.blocker = argv[++i];
        break;
      case '--source': {
        const [label, p] = String(argv[++i]).split('=', 2);
        a.sources[label] = resolve(p);
        break;
      }
    }
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.package || !a.artifactsDir || !(a.build ^ a.validate)) {
    console.error(
      'usage: package-checkpoint.mjs (--build | --validate) --package <id> --artifacts-dir <dir> [--source label=path ...]',
    );
    process.exit(2);
  }
  const file = join(a.artifactsDir, CHECKPOINT_FILE);
  const repo = a.repoRoot ?? process.cwd();

  if (a.validate) {
    let cp = null;
    try {
      cp = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.log(JSON.stringify({ valid: false, reasons: ['checkpoint absent or unreadable'] }));
      process.exit(1);
    }
    const verdict = validateCheckpoint(cp, {
      packageId: a.package,
      headSha: a.head ?? null,
    });
    console.log(JSON.stringify(verdict));
    process.exit(verdict.valid ? 0 : 1);
  }

  // Build: derive durable facts from the repo instead of trusting the caller.
  const tasksPath = join(repo, 'specs', a.package, 'tasks.md');
  const tasks = parseTasksMd(existsSync(tasksPath) ? readFileSync(tasksPath, 'utf8') : '');
  let head = a.head ?? null;
  if (!head) {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  }
  const defaultSources = {
    tasks: tasksPath,
    milestone: join(repo, 'specs', 'implementation', 'current-milestone.json'),
    plan: join(a.artifactsDir, 'plan.md'),
    planContext: join(a.artifactsDir, 'plan-context.md'),
  };
  const cp = buildCheckpoint({
    packageId: a.package,
    headSha: head,
    tasks,
    slice: { id: a.sliceId ?? null, taskIds: a.sliceTasks ? a.sliceTasks.split(',') : [] },
    filesTouched: a.files ? a.files.split(',') : [],
    targetedChecks: a.checks ? JSON.parse(a.checks) : [],
    sources: { ...defaultSources, ...a.sources },
    blocker: a.blocker ?? null,
  });
  writeFileSync(file, JSON.stringify(cp, null, 2) + '\n');
  console.log(
    JSON.stringify({ written: file, completedTasks: cp.completedTasks, totalTasks: cp.totalTasks }),
  );
}

const invokedDirectly = process.argv[1]?.endsWith('package-checkpoint.mjs');
if (invokedDirectly) main();
