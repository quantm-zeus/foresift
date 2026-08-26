#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateLaneOwnership } from './path-ownership.mjs';

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length - 1; index++)
    if (argv[index].startsWith('--')) out[argv[index].slice(2)] = argv[index + 1];
  return out;
}

function changedPaths(worktree, base) {
  const committed = git(['diff', '--name-only', `${base}..HEAD`], worktree).stdout;
  const dirty = git(['status', '--porcelain=v1'], worktree).stdout;
  return [
    ...committed.split('\n').filter(Boolean),
    ...dirty
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).split(' -> ').at(-1)),
  ].filter((path, index, all) => all.indexOf(path) === index);
}

export function runAgyBunMigration(input) {
  for (const field of ['batch', 'worktree', 'base', 'files-json', 'results-dir'])
    if (!input[field]) throw new Error(`AGY_BUN_ARGUMENT_MISSING: ${field}`);
  const files = JSON.parse(readFileSync(input['files-json'], 'utf8'));
  if (!Array.isArray(files) || files.length === 0) throw new Error('AGY_BUN_FILES_INVALID');
  const resultsDir = input['results-dir'];
  mkdirSync(resultsDir, { recursive: true });
  const prompt = [
    `Migrate Foresift Bun Test batch ${input.batch}.`,
    `Worktree: ${input.worktree}`,
    `Pinned base: ${input.base}`,
    `Exact allowed test files: ${files.join(', ')}`,
    '',
    "Replace Vitest test-runner semantics with installed Bun 1.4.0's bun:test semantics.",
    'Preserve every test, assertion, skip/todo state, fixture, and failure direction.',
    'Do not edit product source, control-plane code, package manifests, configs, or files',
    'outside the exact allowed list. Run only:',
    `bun test --no-orphans --isolate --parallel=1 --max-concurrency=1 --timeout=30000 ${files.join(' ')}`,
    `Write ${join(resultsDir, 'agent-result.json')} containing`,
    '{"files":[...],"testsRun":[...],"result":"GREEN","blockers":[]}.',
    'Commit the test-only change as Foresift AGY Test Migrator <noreply@foresift.local>.',
  ].join('\n');
  const started = Date.now();
  const result = spawnSync(
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
      cwd: input.worktree,
      input: `${JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } })}\n`,
      encoding: 'utf8',
      timeout: Number(input['timeout-ms'] ?? 45 * 60_000),
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  writeFileSync(join(resultsDir, 'agy-run.jsonl'), result.stdout ?? '');
  if (result.error) throw new Error(`AGY_BUN_SPAWN_FAILED: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`AGY_BUN_FAILED: ${(result.stderr ?? '').slice(-1000)}`);
  const agentResultFile = join(resultsDir, 'agent-result.json');
  if (!existsSync(agentResultFile)) throw new Error('AGY_BUN_RESULT_CONTRACT_MISSING');
  const actual = changedPaths(input.worktree, input.base);
  const allowed = new Set(files);
  const outside = actual.filter((path) => !allowed.has(path));
  const ownership = validateLaneOwnership({ engine: 'AGY', role: 'test', changedPaths: actual });
  if (!ownership.ok)
    throw new Error(`${ownership.violationCode}: ${ownership.violatingPaths.join(',')}`);
  if (outside.length) throw new Error(`AGY_BUN_SCOPE_VIOLATION: ${outside.join(',')}`);
  const head = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  if (head === input.base) throw new Error('AGY_BUN_NO_COMMIT');
  const evidence = {
    schema: 'foresift/bun-migration-batch-result@1',
    batchId: input.batch,
    engine: 'AGY',
    model: input.model ?? 'gemini-3.7-flash-high',
    reasoning: input.effort ?? 'high',
    baseHead: input.base,
    headSha: head,
    files,
    changedPaths: actual,
    ownership,
    wallTimeMs: Date.now() - started,
    outcome: 'SUCCESS',
  };
  writeFileSync(join(resultsDir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

if (process.argv[1]?.endsWith('exec-agy-bun-migration.mjs')) {
  try {
    const result = runAgyBunMigration(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
  } catch (error) {
    console.error(`agy-bun-migration: ${error.message}`);
    process.exit(1);
  }
}
