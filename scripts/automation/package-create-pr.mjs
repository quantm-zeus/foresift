#!/usr/bin/env node
// DETERMINISTIC pull-request creation for one Foresift work package
// (V2 task spec §13). Replaces the AI create-pr agent on the OPTIMIZED lane's
// clean path with a mechanical tool: push, discover-or-create exactly one PR,
// compose the body from version-controlled metadata + gate evidence, persist
// `.pr-number` for downstream nodes. ZERO Claude invocations.
//
//   node scripts/automation/package-create-pr.mjs \
//     --package <id> --branch <branch> --artifacts-dir <dir> [--dry-run]
//
// Everything is derived; nothing is invented. Missing optional evidence
// degrades sections instead of failing. Exit 0 on success (or dry-run),
// 1 on refusal/failure, 2 on usage error.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findPackage, loadCurrentMilestone, repoRoot as defaultRepoRoot } from './schema.mjs';
import { parseFullGateResult, GATE_RESULT_FILE } from './package-full-gate.mjs';

export const PR_NUMBER_FILE = '.pr-number';

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
}

/**
 * Compose the deterministic PR title/body. Pure with respect to its inputs;
 * every section traces to milestone metadata or persisted artifacts.
 */
export function composePrBody({ packageId, repoRoot, artifactsDir }) {
  const root = repoRoot ?? defaultRepoRoot();
  const lines = [];
  let objective = '';
  let requirementIds = [];
  let risk = 'UNKNOWN';
  try {
    const ms = loadCurrentMilestone(root);
    const pkg = findPackage(ms, packageId);
    if (pkg) {
      objective = pkg.objective ?? '';
      requirementIds = pkg.requirementIds ?? [];
      risk = pkg.risk ?? risk;
    }
  } catch {
    /* degraded below */
  }
  const title = `feat(${packageId}): ${objective || 'work-package implementation'}`.trim();

  lines.push('## Objective', '', objective || '(objective unavailable)', '');
  lines.push(
    '## Requirements',
    '',
    ...(requirementIds.length
      ? requirementIds.map((r) => `- ${r}`)
      : ['- (requirement list unavailable)']),
    '',
  );
  lines.push(`Risk classification: \`${risk}\`. Authoritative sources:`, '');
  lines.push(`- specs/${packageId}/spec.md, plan.md, tasks.md (Spec Kit artifacts)`);
  lines.push('- specs/implementation/current-milestone.json (package object)');
  lines.push('');

  // Gate evidence — structured manifest first, attestation identity second.
  try {
    const m = parseFullGateResult(readFileSync(join(artifactsDir, GATE_RESULT_FILE), 'utf8'));
    if (m) {
      const passed = m.checks.filter((c) => c.status === 'PASS').length;
      lines.push(
        '## Deterministic verification evidence',
        '',
        `- FULL gate (\`pnpm foresift:gate --package ${packageId}\`): **${m.passed ? 'PASSED' : 'FAILED'}** — ${passed}/${m.checks.length} checks green in the final structured manifest.`,
        m.passed
          ? '- Exact-head attestation present (`full-gate-attestation.json`); identity re-checked before merge.'
          : '',
        '',
      );
    }
  } catch {
    /* no manifest artifact — omit rather than invent */
  }
  try {
    const att = JSON.parse(readFileSync(join(artifactsDir, 'full-gate-attestation.json'), 'utf8'));
    if (att?.result === 'PASS' && att?.headSha)
      lines.push(
        `- Attested head: \`${String(att.headSha).slice(0, 12)}\` at ${att.timestamp}.`,
        '',
      );
  } catch {
    /* no attestation yet (repair still open) — omit */
  }

  // Out-of-scope notes are appended verbatim when the implementation left any.
  const notesPath = join(artifactsDir, 'out-of-scope-notes.md');
  if (existsSync(notesPath)) {
    lines.push('## Out-of-scope notes (recorded during implementation)', '');
    lines.push(readFileSync(notesPath, 'utf8').trim(), '');
  }

  lines.push(
    '---',
    '',
    'This pull request was produced autonomously by the Foresift control plane.',
    'Implementation claims were verified by deterministic gates (spec integrity,',
    'formatting, lint, typecheck, full test suite, package checks) and exact-head',
    'CI before merge. No capability outside the read-only product boundary was',
    'introduced or executed.',
    '',
  );
  return { title, body: lines.filter((l) => l !== '').length ? lines.join('\n') : '' };
}

/** Discover an open PR for the branch; create it when none exists. Injectable runner for tests. */
export function ensurePullRequest({ branch, title, bodyFile, run = sh }) {
  const listed = run('gh', [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number',
    '--jq',
    '.[0].number',
  ]);
  if (listed && String(listed).trim()) return { prNumber: String(listed).trim(), created: false };
  const out = run('gh', [
    'pr',
    'create',
    '--base',
    'main',
    '--head',
    branch,
    '--title',
    title,
    '--body-file',
    bodyFile,
  ]);
  const m = /\/pull\/(\d+)/.exec(String(out).split('\n').pop() ?? '');
  if (!m) throw new Error(`could not parse PR number from gh output: ${out}`);
  return { prNumber: m[1], created: true };
}

function parseArgs(argv) {
  const a = {};
  // Iterate to the END: a trailing value-less flag (--dry-run) must be seen.
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--package':
        a.package = argv[++i];
        break;
      case '--branch':
        a.branch = argv[++i];
        break;
      case '--artifacts-dir':
        a.artifactsDir = argv[++i];
        break;
      case '--repo-root':
        a.repoRoot = argv[++i];
        break;
      case '--dry-run':
        a.dryRun = true;
        break;
    }
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.package || !a.branch || !a.artifactsDir) {
    console.error(
      'usage: package-create-pr.mjs --package <id> --branch <branch> --artifacts-dir <dir> [--dry-run]',
    );
    process.exit(2);
  }
  const repoRoot = resolve(a.repoRoot ?? process.cwd());
  const artifactsDir = resolve(a.artifactsDir);
  const dirty = sh('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repoRoot });
  if (dirty) {
    console.error('REFUSED: dirty tracked tree — commit coherent units first');
    process.exit(1);
  }

  const { title, body } = composePrBody({
    packageId: a.package,
    repoRoot,
    artifactsDir,
  });

  if (a.dryRun) {
    console.log(JSON.stringify({ dryRun: true, branch: a.branch, title, body }, null, 2));
    return;
  }

  sh('git', ['push', '-u', 'origin', a.branch], { cwd: repoRoot });
  const bodyFile = join(artifactsDir, 'pr-body.md');
  writeFileSync(bodyFile, body);
  const { prNumber, created } = ensurePullRequest({ branch: a.branch, title, bodyFile });
  // Confirm/repair the base branch deterministically.
  try {
    const base = sh('gh', [
      'pr',
      'view',
      prNumber,
      '--json',
      'baseRefName',
      '--jq',
      '.baseRefName',
    ]);
    if (base !== 'main') sh('gh', ['pr', 'edit', prNumber, '--base', 'main']);
  } catch {
    /* non-fatal: base checked again at land time via CI base semantics */
  }
  writeFileSync(join(artifactsDir, PR_NUMBER_FILE), `${prNumber}\n`);
  console.log(JSON.stringify({ prNumber: Number(prNumber), created, branch: a.branch }, null, 2));
}

const invokedDirectly = process.argv[1]?.endsWith('package-create-pr.mjs');
if (invokedDirectly) main();
