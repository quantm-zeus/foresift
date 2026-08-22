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

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoRoot, loadCurrentMilestone, validateMilestoneState, findPackage } from './schema.mjs';

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
}
if (!args.package) fail('missing --package <id>');

function fail(msg) {
  console.log(JSON.stringify({ complete: false, errors: [msg] }, null, 2));
  process.exit(1);
}

const root = repoRoot();
const errors = [];
const pkgDir = join(root, 'specs', args.package);

const ms = loadCurrentMilestone(root);
if (!ms || validateMilestoneState(ms).length > 0)
  fail('current milestone state invalid or missing');
const pkg = findPackage(ms, args.package);
if (!pkg) fail(`package ${args.package} not found in milestone ${ms.milestoneId}`);

// ── scoped artifacts must still exist (never deleted mid-implementation) ─────
for (const f of ['spec.md', 'plan.md', 'tasks.md'])
  if (!existsSync(join(pkgDir, f)))
    errors.push(`scoped artifact specs/${args.package}/${f} is missing`);

// ── every task checked ────────────────────────────────────────────────────────
const tasksPath = join(pkgDir, 'tasks.md');
let unchecked = [];
let total = 0;
if (existsSync(tasksPath)) {
  const lines = readFileSync(tasksPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*[-*+]\s*\[( |x|X)\]/);
    if (!m) continue;
    total += 1;
    if (m[1] === ' ') unchecked.push(line.trim().slice(0, 100));
  }
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
    if (re.test(text)) errors.push(`unresolved marker ${re} remains in specs/${args.package}/${f}`);
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

if (errors.length) {
  console.log(
    JSON.stringify({ complete: false, remainingTasks: unchecked.length, errors }, null, 2),
  );
  process.exit(1);
}
console.log(JSON.stringify({ complete: true, package: args.package, tasksCompleted: total }));
process.exit(0);
