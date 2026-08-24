#!/usr/bin/env node
// Deterministic implementation-completion guard for ONE Foresift work package.
// Used as the Archon loop `until_bash` completion check for the work-package
// implementation stage:
//
//   node scripts/automation/package-implement-complete.mjs --package <id>
//
// Exit 0 — every scoped task is marked complete, scoped artifacts intact,
//          no unresolved placeholders. Heavy verification (tests/typecheck/
//          full gate) deliberately stays in the downstream deterministic gate
//          nodes; this guard only decides whether ANOTHER iteration is needed.
// Exit 1 — incomplete (reasons printed as JSON).
// Never AI-judged; runs after every implementation iteration (<2 min budget).
// The same verdict is imported by convergence-router.mjs (task spec §11).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoRoot, loadCurrentMilestone, validateMilestoneState, findPackage } from './schema.mjs';

/**
 * Deterministic completeness verdict for one package. Never throws for
 * ordinary "incomplete" states; returns { complete:false, errors:[...] }.
 */
export function implementationComplete(packageId, rootOverride) {
  const root = rootOverride ?? repoRoot();
  const errors = [];
  const pkgDir = join(root, 'specs', packageId);
  let uncheckedCount = 0;
  let total = 0;

  const ms = loadCurrentMilestone(root);
  if (!ms || validateMilestoneState(ms).length > 0)
    return {
      complete: false,
      remainingTasks: uncheckedCount,
      errors: ['current milestone state invalid or missing'],
    };
  const pkg = findPackage(ms, packageId);
  if (!pkg)
    return {
      complete: false,
      remainingTasks: uncheckedCount,
      errors: [`package ${packageId} not found in milestone ${ms.milestoneId}`],
    };

  // ── scoped artifacts must still exist (never deleted mid-implementation) ─────
  for (const f of ['spec.md', 'plan.md', 'tasks.md'])
    if (!existsSync(join(pkgDir, f)))
      errors.push(`scoped artifact specs/${packageId}/${f} is missing`);

  // ── every task checked ────────────────────────────────────────────────────────
  const tasksPath = join(pkgDir, 'tasks.md');
  let unchecked = [];
  if (existsSync(tasksPath)) {
    const lines = readFileSync(tasksPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*[-*+]\s*\[( |x|X)\]/);
      if (!m) continue;
      total += 1;
      if (m[1] === ' ') unchecked.push(line.trim().slice(0, 100));
    }
    uncheckedCount = unchecked.length;
    if (total === 0) errors.push('tasks.md contains no checkbox tasks');
    if (unchecked.length > 0)
      errors.push(
        `${unchecked.length} of ${total} tasks still unchecked; first few: ${unchecked.slice(0, 5).join(' | ')}`,
      );
  }

  // ── no unresolved markers left in the scoped artifacts ────────────────────────
  for (const f of ['spec.md', 'plan.md', 'tasks.md']) {
    const p = join(pkgDir, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const re of [/\[NEEDS CLARIFICATION[^\]]*\]/, /\bTODO\b/, /\bFIXME\b/, /^\s*\bTBD\b/])
      if (re.test(text)) errors.push(`unresolved marker ${re} remains in specs/${packageId}/${f}`);
  }

  // ── coherent units are committed additively (working tree may hold partials) ──
  try {
    const out = execFileSync('git', ['log', '--oneline', '--no-decorate', '-15'], {
      cwd: root,
      encoding: 'utf8',
    });
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (/^HEAD\b/.test(out) || branch === 'HEAD')
      errors.push('detached HEAD — implementation commits must land on the package branch');
  } catch (err) {
    errors.push(`git inspection failed: ${String(err?.message ?? err).slice(0, 120)}`);
  }

  // ── completion requires a committed tree ──────────────────────────────────
  // create-pr refuses a dirty tracked tree, so accepting "complete" over an
  // uncommitted working tree only moves the failure to the LAST node of the
  // chain — live run 8061381a lost its landing step to exactly that after its
  // scoped plan told the agent to leave everything uncommitted (defect #9).
  // Partial slices legitimately hold dirty trees across iterations; only the
  // complete verdict demands committed coherence.
  if (errors.length === 0) {
    try {
      const dirty = execFileSync('git', ['status', '--porcelain', '-uall'], {
        cwd: root,
        encoding: 'utf8',
      });
      const entries = dirty.split('\n').filter((l) => l.trim());
      if (entries.length > 0) {
        const shown = entries.slice(0, 8).map((l) => l.slice(3).trim());
        errors.push(
          `working tree has ${entries.length} uncommitted change(s) — commit coherent units ` +
            `before completion (create-pr refuses a dirty tree): ${shown.join(', ')}` +
            `${entries.length > 8 ? ', …' : ''}`,
        );
      }
    } catch (err) {
      errors.push(`git inspection failed: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }

  return errors.length
    ? { complete: false, remainingTasks: uncheckedCount, errors }
    : { complete: true, package: packageId, tasksCompleted: total };
}

const invokedDirectly = process.argv[1]?.endsWith('package-implement-complete.mjs');
if (invokedDirectly) {
  const args = {};
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  }
  if (!args.package) {
    console.log(JSON.stringify({ complete: false, errors: ['missing --package <id>'] }, null, 2));
    process.exit(1);
  }
  const result = implementationComplete(args.package);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.complete ? 0 : 1);
}
