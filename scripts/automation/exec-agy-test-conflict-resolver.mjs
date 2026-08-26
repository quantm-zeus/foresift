#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateLaneOwnership } from './path-ownership.mjs';

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function lines(value) {
  return String(value ?? '')
    .split('\n')
    .filter(Boolean);
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function snapshotOutside(worktree, allowed) {
  const result = git(['ls-files', '-co', '--exclude-standard'], worktree);
  if (result.status !== 0) throw new Error(`AGY_CONFLICT_FILE_SCAN_FAILED: ${result.stderr}`);
  return new Map(
    [...new Set(lines(result.stdout))]
      .filter((path) => !allowed.has(path) && existsSync(join(worktree, path)))
      .map((path) => [path, hashFile(join(worktree, path))]),
  );
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length - 1; index++)
    if (argv[index].startsWith('--')) out[argv[index].slice(2)] = argv[index + 1];
  return out;
}

export function runAgyTestConflictResolver(input) {
  for (const field of ['worktree', 'allowed-paths', 'results-dir'])
    if (!input[field]) throw new Error(`AGY_CONFLICT_ARGUMENT_MISSING: ${field}`);
  const worktree = input.worktree;
  const allowedList = JSON.parse(readFileSync(input['allowed-paths'], 'utf8'));
  const allowed = new Set(allowedList);
  const unmergedBefore = lines(git(['diff', '--name-only', '--diff-filter=U'], worktree).stdout);
  if (
    unmergedBefore.length === 0 ||
    unmergedBefore.some((path) => !allowed.has(path)) ||
    allowedList.some((path) => !unmergedBefore.includes(path))
  )
    throw new Error(`AGY_CONFLICT_SET_INVALID: ${unmergedBefore.join(',')}`);
  const ownership = validateLaneOwnership({
    engine: 'AGY',
    role: 'test',
    changedPaths: allowedList,
  });
  if (!ownership.ok)
    throw new Error(`${ownership.violationCode}: ${ownership.violatingPaths.join(',')}`);
  const outsideBefore = snapshotOutside(worktree, allowed);
  const resultsDir = input['results-dir'];
  mkdirSync(resultsDir, { recursive: true });
  const reportFile = join(resultsDir, 'agent-result.json');
  const prompt = [
    'Resolve only these Git merge-conflicted test-owned paths:',
    ...allowedList.map((path) => `- ${path}`),
    '',
    'Preserve the useful semantics from both sides. The current package side carries',
    'dynamic first-unlanded-package selection; origin/main carries Bun-native hermetic',
    'gate execution, a runner-neutral helper, and the nested-FULL structural guard.',
    'The final files must preserve all of those behaviors and use bun:test only in the',
    'test file, never in the shared helper. Remove all conflict markers. Run targeted',
    'Bun Test for the gate file. Do not modify any other path. Stage the two resolved',
    'files with git add, but DO NOT commit the merge.',
    `Write ${reportFile} as JSON with {"testsRun":[],"result":"GREEN","blockers":[]}.`,
  ].join('\n');
  const run = spawnSync(
    'agy',
    [
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--disable-slash-commands',
      '--dangerously-skip-permissions',
      '--model',
      input.model ?? 'gemini-3.7-flash-high',
      '--effort',
      input.effort ?? 'high',
      '--print-timeout',
      input['print-timeout'] ?? '40m',
    ],
    {
      cwd: worktree,
      input: `${JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } })}\n`,
      encoding: 'utf8',
      timeout: Number(input['timeout-ms'] ?? 45 * 60_000),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  writeFileSync(join(resultsDir, 'agy-run.jsonl'), run.stdout ?? '');
  if (run.error) throw new Error(`AGY_CONFLICT_SPAWN_FAILED: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`AGY_CONFLICT_FAILED: ${(run.stderr ?? '').slice(-1000)}`);
  if (!existsSync(reportFile)) throw new Error('AGY_CONFLICT_RESULT_MISSING');
  const unmergedAfter = lines(git(['diff', '--name-only', '--diff-filter=U'], worktree).stdout);
  if (unmergedAfter.length) throw new Error(`AGY_CONFLICT_UNRESOLVED: ${unmergedAfter.join(',')}`);
  const outsideAfter = snapshotOutside(worktree, allowed);
  const changedOutside = [...new Set([...outsideBefore.keys(), ...outsideAfter.keys()])].filter(
    (path) => outsideBefore.get(path) !== outsideAfter.get(path),
  );
  if (changedOutside.length)
    throw new Error(`AGY_CONFLICT_SCOPE_VIOLATION: ${changedOutside.join(',')}`);
  // A valid resolution may exactly match the current HEAD side. In that case
  // `git add` removes the unmerged index stages without producing a staged
  // diff for the path. The zero-unmerged check above is the authoritative
  // proof; requiring every allowed path to appear in `--cached` would reject
  // that safe and common resolution.
  return {
    schema: 'foresift/agy-test-conflict-result@1',
    engine: 'AGY',
    model: input.model ?? 'gemini-3.7-flash-high',
    reasoning: input.effort ?? 'high',
    resolvedPaths: allowedList,
    outsidePathsChanged: [],
    ownership,
  };
}

if (process.argv[1]?.endsWith('exec-agy-test-conflict-resolver.mjs')) {
  try {
    const result = runAgyTestConflictResolver(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
