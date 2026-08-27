#!/usr/bin/env node
// classify-ci-diff.mjs — Deterministic semantic CI diff classifier.
//
// Single source of truth for CI workflow and state landing lane.
//
// HARD CONTRACT:
//   - Only semantically validated changes to `specs/implementation/current-milestone.json`
//     modifying supervisor-owned fields (`status`, `generation`) qualify for STATE_ONLY.
//   - All other changes (roadmap.json, plan.md, spec.md, tasks.md, product code, tests, etc.)
//     require FULL CI.
//   - Fail-closed: any parse error, diff failure, or empty diff produces FULL CI.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ALLOWED_STATUS_TRANSITIONS } from './schema.mjs';

function sh(args, { cwd } = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', args, { encoding: 'utf8', cwd }).trim(),
      stderr: '',
    };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout ? String(e.stdout).trim() : '',
      stderr: e.stderr ? String(e.stderr).trim() : String(e.message),
    };
  }
}

/**
 * Compare two current-milestone.json objects semantically.
 * Returns { ok: true, changes: [...] } if only allowed fields changed,
 * or { ok: false, reason: string } if non-allowed fields changed.
 */
export function compareMilestoneJsonSemantic(before, after) {
  if (!before || !after) {
    return { ok: false, reason: 'missing milestone JSON object' };
  }

  function getDiffs(b, a, path = '') {
    if (b === a) return [];
    if (Array.isArray(b) && Array.isArray(a)) {
      if (b.length !== a.length) {
        return [{ path, type: 'length', before: b.length, after: a.length }];
      }
      let diffs = [];
      for (let i = 0; i < b.length; i++) {
        diffs.push(...getDiffs(b[i], a[i], `${path}/${i}`));
      }
      return diffs;
    }
    if (b && a && typeof b === 'object' && typeof a === 'object') {
      let diffs = [];
      const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
      for (const k of keys) {
        if (!(k in b)) diffs.push({ path: `${path}/${k}`, type: 'added', after: a[k] });
        else if (!(k in a)) diffs.push({ path: `${path}/${k}`, type: 'removed', before: b[k] });
        else diffs.push(...getDiffs(b[k], a[k], `${path}/${k}`));
      }
      return diffs;
    }
    return [{ path, type: 'changed', before: b, after: a }];
  }

  const diffs = getDiffs(before, after);

  if (diffs.length === 0) {
    return { ok: false, reason: 'empty diff (no changes)' };
  }

  const changes = [];

  for (const diff of diffs) {
    const p = diff.path;
    const packageStatusMatch = p.match(/^\/packages\/(\d+)\/status$/);
    const packageGenMatch = p.match(/^\/packages\/(\d+)\/generation$/);

    if (p === '/packages') {
      return { ok: false, reason: 'package addition/removal (length change)' };
    }

    if (packageStatusMatch) {
      const idx = packageStatusMatch[1];
      const pkgBefore = before.packages[idx];
      const pkgAfter = after.packages[idx];

      const transitionKey = `${pkgBefore.status}->${pkgAfter.status}`;
      if (!ALLOWED_STATUS_TRANSITIONS.has(transitionKey)) {
        return {
          ok: false,
          reason: `package '${pkgBefore?.id || idx}' disallowed status transition: ${transitionKey}`,
        };
      }
      changes.push({
        packageId: pkgBefore.id,
        field: 'status',
        from: pkgBefore.status,
        to: pkgAfter.status,
      });
    } else if (packageGenMatch) {
      const idx = packageGenMatch[1];
      const pkgBefore = before.packages[idx];
      const pkgAfter = after.packages[idx];

      if (typeof pkgAfter.generation !== 'number' && pkgAfter.generation !== undefined) {
        return {
          ok: false,
          reason: `package '${pkgBefore?.id || idx}' invalid generation '${pkgAfter.generation}'`,
        };
      }
      changes.push({
        packageId: pkgBefore.id,
        field: 'generation',
        from: pkgBefore.generation,
        to: pkgAfter.generation,
      });
    } else {
      return { ok: false, reason: `disallowed pointer change: ${p}` };
    }
  }

  if (changes.length === 0) {
    return { ok: false, reason: 'no valid semantic changes found' };
  }

  return { ok: true, changes };
}

/**
 * Classify a git diff between base and head.
 *
 * @param {Object} opts
 * @param {string} [opts.repoDir]
 * @param {string} [opts.baseSha]
 * @param {string} [opts.headSha]
 * @returns {{ mode: 'STATE_ONLY'|'FULL', changedFiles: string[], semanticChanges?: any[], reason: string }}
 */
export function classifyCiDiff({
  repoDir = process.cwd(),
  baseSha = 'HEAD~1',
  headSha = 'HEAD',
} = {}) {
  // 1. Get changed files
  const diffRes = sh(['diff', '--name-only', baseSha, headSha], { cwd: repoDir });
  if (!diffRes.ok) {
    return { mode: 'FULL', changedFiles: [], reason: `git diff failed: ${diffRes.stderr}` };
  }

  const changedFiles = diffRes.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (changedFiles.length === 0) {
    return { mode: 'FULL', changedFiles: [], reason: 'no changed files detected (fail-closed)' };
  }

  // 2. Check if ONLY current-milestone.json changed
  const isOnlyMilestoneJson =
    changedFiles.length === 1 && changedFiles[0] === 'specs/implementation/current-milestone.json';

  if (!isOnlyMilestoneJson) {
    return {
      mode: 'FULL',
      changedFiles,
      reason: `non-milestone files changed: ${changedFiles.filter((f) => f !== 'specs/implementation/current-milestone.json').join(', ')}`,
    };
  }

  // 3. Read content at base and head for current-milestone.json
  const showBaseRes = sh(['show', `${baseSha}:specs/implementation/current-milestone.json`], {
    cwd: repoDir,
  });
  if (!showBaseRes.ok) {
    return {
      mode: 'FULL',
      changedFiles,
      reason: `failed to read base milestone JSON: ${showBaseRes.stderr}`,
    };
  }

  let headContent = '';
  if (headSha === 'HEAD' || headSha === 'WORKING_TREE') {
    try {
      headContent = readFileSync(
        join(repoDir, 'specs', 'implementation', 'current-milestone.json'),
        'utf8',
      );
    } catch {
      const showHeadRes = sh(['show', `${headSha}:specs/implementation/current-milestone.json`], {
        cwd: repoDir,
      });
      if (!showHeadRes.ok) {
        return {
          mode: 'FULL',
          changedFiles,
          reason: `failed to read head milestone JSON: ${showHeadRes.stderr}`,
        };
      }
      headContent = showHeadRes.stdout;
    }
  } else {
    const showHeadRes = sh(['show', `${headSha}:specs/implementation/current-milestone.json`], {
      cwd: repoDir,
    });
    if (!showHeadRes.ok) {
      return {
        mode: 'FULL',
        changedFiles,
        reason: `failed to read head milestone JSON: ${showHeadRes.stderr}`,
      };
    }
    headContent = showHeadRes.stdout;
  }

  let beforeJson;
  let afterJson;
  try {
    beforeJson = JSON.parse(showBaseRes.stdout);
    afterJson = JSON.parse(headContent);
  } catch (e) {
    return { mode: 'FULL', changedFiles, reason: `milestone JSON parse error: ${e.message}` };
  }

  // 4. Semantic comparison
  const comparison = compareMilestoneJsonSemantic(beforeJson, afterJson);
  if (!comparison.ok) {
    return {
      mode: 'FULL',
      changedFiles,
      reason: `semantic check failed: ${comparison.reason}`,
    };
  }

  return {
    mode: 'STATE_ONLY',
    changedFiles,
    semanticChanges: comparison.changes,
    reason: `state-only verified: ${comparison.changes.map((c) => `${c.packageId}.${c.field}: ${c.from}->${c.to}`).join(', ')}`,
  };
}

// ── CLI invocation ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { base: 'HEAD~1', head: 'HEAD', json: false, ghOutput: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) args.base = argv[++i];
    else if (argv[i] === '--head' && argv[i + 1]) args.head = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--gh-output') args.ghOutput = true;
  }
  return args;
}

if (process.argv[1]?.endsWith('classify-ci-diff.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const res = classifyCiDiff({ baseSha: args.base, headSha: args.head });

  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`MODE: ${res.mode}`);
    console.log(`REASON: ${res.reason}`);
    console.log(`CHANGED_FILES: ${res.changedFiles.join(' ')}`);
  }

  if (process.env.GITHUB_OUTPUT) {
    const isStateOnly = res.mode === 'STATE_ONLY';
    const fs = await import('node:fs');
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `state_only=${isStateOnly}\nmode=${res.mode}\nreason=${res.reason}\n`,
    );
  }

  process.exit(0);
}
