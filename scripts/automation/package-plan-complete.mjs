#!/usr/bin/env node
// Deterministic scoped-planning completeness guard for ONE Foresift work
// package. Used as the Archon loop `until_bash` completion check for the
// work-package scoped planning stage:
//
//   node scripts/automation/package-plan-complete.mjs --package <id>
//
// Exit 0  — planning artifacts are complete and traceable.
// Exit 1  — incomplete (reasons printed to stdout as JSON).
// Never AI-judged; cheap enough to run after every planning iteration (<2 min).
//
// Checks (per the control-plane hardening contract):
//   - required scoped Spec Kit files exist and are non-empty;
//   - workflow artifact copies exist ($ARTIFACTS_DIR/plan.md, plan-context.md);
//   - no Spec Kit template placeholders / unresolved markers remain;
//   - every assigned requirement ID appears in spec.md;
//   - tasks exist and every requirement ID traced in tasks.md is one of the
//     package's assignments (out-of-scope tracing rejected);
//   - package metadata is structurally valid.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, loadCurrentMilestone, validateMilestoneState, findPackage } from './schema.mjs';

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--artifacts-dir') args.artifactsDir = process.argv[i + 1];
}
// until_bash guards receive NO ARTIFACTS_DIR environment variable (Archon
// v0.9.0, probe-verified — see docs/adr/0004-archon-until-bash-artifacts-contract.md):
// guards must pass --artifacts-dir "$ARTIFACTS_DIR", which archon textually
// substitutes in bare form. The env var remains the fallback for regular
// workflow bash nodes, where it IS exported.
const artifactsDir = args.artifactsDir ?? process.env.ARTIFACTS_DIR ?? '';
if (!args.package) fail('missing --package <id>');
if (!artifactsDir)
  fail(
    'missing artifacts directory: pass --artifacts-dir "$ARTIFACTS_DIR" ' +
      '(until_bash guards get no ARTIFACTS_DIR env var) or run inside an Archon bash node',
  );

function fail(msg) {
  console.log(JSON.stringify({ complete: false, errors: [msg] }, null, 2));
  process.exit(1);
}

const root = repoRoot();
const errors = [];
const pkgDir = join(root, 'specs', args.package);

// ── package metadata ──────────────────────────────────────────────────────────
const ms = loadCurrentMilestone(root);
if (!ms || validateMilestoneState(ms).length > 0)
  fail('current milestone state invalid or missing');
const pkg = findPackage(ms, args.package);
if (!pkg) fail(`package ${args.package} not found in milestone ${ms.milestoneId}`);
const assigned = new Set(pkg.requirementIds);

// ── required files ────────────────────────────────────────────────────────────
for (const f of ['spec.md', 'plan.md', 'tasks.md']) {
  const p = join(pkgDir, f);
  if (!existsSync(p)) errors.push(`missing specs/${args.package}/${f}`);
  else if (readFileSync(p, 'utf8').trim().length < 50)
    errors.push(`specs/${args.package}/${f} is effectively empty`);
}
for (const f of ['plan.md', 'plan-context.md']) {
  const p = join(artifactsDir, f);
  if (!existsSync(p)) errors.push(`missing artifact $ARTIFACTS_DIR/${f}`);
  else if (readFileSync(p, 'utf8').trim().length < 20)
    errors.push(`artifact $ARTIFACTS_DIR/${f} is effectively empty`);
}

// ── placeholder scan across scoped artifacts ─────────────────────────────────
const PLACEHOLDER_PATTERNS = [
  /\[PROJECT_NAME\]/,
  /\[PRINCIPLE_\d+_NAME\]/i,
  /\[PRINCIPLE_\d+_DESCRIPTION\]/i,
  /\[SECTION_\d+_NAME\]/,
  /\[SECTION_\d+_CONTENT\]/,
  /\[GOVERNANCE_RULES\]/,
  /\[CONSTITUTION_VERSION\]/,
  /\[NEEDS CLARIFICATION[^\]]*\]/,
  /\[PLACEHOLDER[^\]]*\]/i,
  /<TEMPLATE_[A-Z_]+>/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /^\s*\bTBD\b/,
];
if (existsSync(pkgDir)) {
  for (const f of ['spec.md', 'plan.md', 'tasks.md']) {
    const p = join(pkgDir, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const re of PLACEHOLDER_PATTERNS)
      if (re.test(text))
        errors.push(`template placeholder ${re} remains in specs/${args.package}/${f}`);
  }
}

// ── requirement traceability ──────────────────────────────────────────────────
const specText = existsSync(join(pkgDir, 'spec.md'))
  ? readFileSync(join(pkgDir, 'spec.md'), 'utf8')
  : '';
for (const rid of assigned)
  if (!specText.includes(rid))
    errors.push(`assigned requirement ${rid} does not appear in specs/${args.package}/spec.md`);

const tasksPath = join(pkgDir, 'tasks.md');
let taskCount = 0;
if (existsSync(tasksPath)) {
  const tasksText = readFileSync(tasksPath, 'utf8');
  taskCount = (tasksText.match(/^\s*[-*+]\s*\[[ xX]\]/gm) ?? []).length;
  if (taskCount < 1) errors.push('tasks.md contains no checkbox tasks');
  const tracedIds = [
    ...new Set(tasksText.match(/\b[A-Z]{2,}-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}\b/g) ?? []),
  ];
  for (const rid of tracedIds)
    if (!assigned.has(rid))
      errors.push(
        `tasks.md traces requirement ${rid} outside this package's assignment (out of scope)`,
      );
}

if (errors.length) {
  console.log(JSON.stringify({ complete: false, errors }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify({
    complete: true,
    package: args.package,
    requirements: [...assigned],
    tasks: taskCount,
  }),
);
process.exit(0);
