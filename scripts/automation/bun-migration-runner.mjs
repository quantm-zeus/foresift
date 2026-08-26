#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { analyzeTestFile, buildBunMigrationManifest } from './bun-migration-manifest.mjs';
import { runMechanicalCodemod } from './bun-migration-codemod.mjs';
import { buildBunTestPlan, runBunTestPlan } from './bun-test-coordinator.mjs';

const DEFAULT_MANIFEST = 'evidence/bun-migration/bun-migration-manifest.json';

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return groups;
}

function chunks(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

export function planMigrationBatches(manifest) {
  const batches = [];
  for (const [locality, entries] of groupBy(
    manifest.files.filter((entry) => entry.state === 'CODEMOD_READY'),
    (entry) => `${entry.package}:${entry.workload}`,
  )) {
    const heavy = /DATABASE_PGLITE|META_GATE/.test(locality);
    for (const [index, part] of chunks(entries, heavy ? 10 : 40).entries())
      batches.push({
        id: `mechanical-${locality.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${index + 1}`,
        engine: 'CODEMOD',
        workload: part[0].workload,
        files: part.map((entry) => entry.path),
        state: 'PENDING',
      });
  }
  const semantic = manifest.files.filter((entry) => entry.state === 'AGY_REQUIRED');
  const semanticParts = semantic.length <= 25 ? [semantic] : chunks(semantic, 25);
  for (const [index, part] of semanticParts.entries()) {
    if (part.length)
      batches.push({
        id: `agy-semantic-${index + 1}`,
        engine: 'AGY',
        workload: part.some((entry) => ['DATABASE_PGLITE', 'META_GATE'].includes(entry.workload))
          ? 'OTHER_HEAVY'
          : 'PURE',
        files: part.map((entry) => entry.path),
        state: 'PENDING',
        attempts: 0,
      });
  }
  return batches.sort((a, b) => a.id.localeCompare(b.id));
}

function saveManifest(file, manifest) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

function commitCheckpoint(root, message) {
  const add = git(['add', '--all'], root);
  if (add.status !== 0) throw new Error(`BUN_MIGRATION_GIT_ADD_FAILED: ${add.stderr}`);
  const staged = git(['diff', '--cached', '--quiet'], root);
  if (staged.status === 0) return git(['rev-parse', 'HEAD'], root).stdout.trim();
  const commit = git(
    [
      '-c',
      'user.name=Foresift Bun Migration Coordinator',
      '-c',
      'user.email=noreply@foresift.local',
      'commit',
      '-m',
      message,
    ],
    root,
  );
  if (commit.status !== 0) throw new Error(`BUN_MIGRATION_COMMIT_FAILED: ${commit.stderr}`);
  return git(['rev-parse', 'HEAD'], root).stdout.trim();
}

function updateFileStates(manifest, files, state, root = null) {
  const selected = new Set(files);
  for (const [index, entry] of manifest.files.entries()) {
    if (!selected.has(entry.path)) continue;
    if (root && ['MIGRATED', 'VERIFIED'].includes(state)) {
      manifest.files[index] = { ...analyzeTestFile(root, entry.path), state };
    } else {
      entry.state = state;
    }
  }
  manifest.counts = Object.fromEntries(
    ['CODEMOD_READY', 'AGY_REQUIRED', 'MIGRATED', 'VERIFIED', 'BLOCKED'].map((value) => [
      value,
      manifest.files.filter((entry) => entry.state === value).length,
    ]),
  );
}

function targetedVerify(root, manifest, policy, files) {
  const plan = buildBunTestPlan(manifest, policy, files);
  const evidence = runBunTestPlan({ root, plan, policy });
  return { plan, evidence };
}

export function runMechanicalBatches({ root, manifestFile, manifest, policy }) {
  for (const batch of manifest.batches.filter(
    (entry) => entry.engine === 'CODEMOD' && entry.state !== 'VERIFIED',
  )) {
    runMechanicalCodemod({ root, manifest, paths: batch.files, write: true });
    updateFileStates(manifest, batch.files, 'MIGRATED', root);
    const verification = targetedVerify(root, manifest, policy, batch.files);
    batch.verification = verification.evidence;
    if (!verification.evidence.ok) {
      batch.state = 'BLOCKED';
      updateFileStates(manifest, batch.files, 'BLOCKED');
      saveManifest(manifestFile, manifest);
      throw new Error(`BUN_MECHANICAL_BATCH_RED: ${batch.id}`);
    }
    batch.state = 'VERIFIED';
    batch.codexCalls = 0;
    batch.claudeCalls = 0;
    updateFileStates(manifest, batch.files, 'VERIFIED', root);
    manifest.generatedAt = new Date().toISOString();
    batch.testedHead = git(['rev-parse', 'HEAD'], root).stdout.trim();
    saveManifest(manifestFile, manifest);
    batch.checkpointHead = commitCheckpoint(root, `test(bun): migrate ${batch.id}`);
  }
  return manifest;
}

function spawnAgyExecutor({ root, batch, worktree, base, filesFile, resultsDir, policy }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        join(root, 'scripts', 'automation', 'exec-agy-bun-migration.mjs'),
        '--batch',
        batch.id,
        '--worktree',
        worktree,
        '--base',
        base,
        '--files-json',
        filesFile,
        '--results-dir',
        resultsDir,
        '--model',
        policy.agyModel,
        '--effort',
        policy.agyEffort,
        '--print-timeout',
        '40m',
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function prepareAgyWorktree({ root, artifactsDir, batch, base }) {
  const worktree = join(artifactsDir, 'worktrees', batch.id);
  const resultsDir = join(artifactsDir, 'batches', batch.id);
  const filesFile = join(resultsDir, 'files.json');
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(filesFile, JSON.stringify(batch.files, null, 2) + '\n');
  const branch = `foresift/bun-migration-${base.slice(0, 10)}-${batch.id}`;
  const add = git(['worktree', 'add', '-b', branch, worktree, base], root);
  if (add.status !== 0) throw new Error(`BUN_AGY_WORKTREE_ADD_FAILED: ${batch.id}: ${add.stderr}`);
  return { worktree, resultsDir, filesFile, branch };
}

function cleanupAgyWorktree(root, prepared) {
  const status = git(['status', '--porcelain=v1'], prepared.worktree);
  if (status.status !== 0 || status.stdout.trim()) return false;
  const remove = git(['worktree', 'remove', prepared.worktree], root);
  if (remove.status !== 0) return false;
  git(['worktree', 'prune'], root);
  return true;
}

export async function runAgyBatches({ root, artifactsDir, manifestFile, manifest, policy }) {
  const pending = manifest.batches.filter(
    (batch) => batch.engine === 'AGY' && batch.state !== 'VERIFIED',
  );
  if (pending.length === 0) return manifest;
  const pinnedBase = git(['rev-parse', 'HEAD'], root).stdout.trim();
  const max = Math.min(3, Math.max(1, Number(policy.agyMaxConcurrency ?? 2)));
  const prepared = pending.map((batch) => ({
    batch,
    ...prepareAgyWorktree({ root, artifactsDir, batch, base: pinnedBase }),
  }));
  for (let offset = 0; offset < prepared.length;) {
    const first = prepared[offset];
    const heavy = first.batch.workload !== 'PURE';
    const width = heavy ? 1 : max;
    const wave = prepared.slice(offset, offset + width);
    const results = await Promise.all(
      wave.map(async (item) => {
        let result = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          item.batch.attempts = attempt;
          result = await spawnAgyExecutor({
            root,
            batch: item.batch,
            worktree: item.worktree,
            base: pinnedBase,
            filesFile: item.filesFile,
            resultsDir: item.resultsDir,
            policy,
          });
          if (result.status === 0) break;
        }
        return { item, result };
      }),
    );
    for (const { item, result } of results) {
      if (result.status !== 0) {
        item.batch.state = 'BLOCKED';
        item.batch.failure = result.stderr.slice(-2000);
        saveManifest(manifestFile, manifest);
        throw new Error(`BUN_AGY_BATCH_BLOCKED: ${item.batch.id}`);
      }
      const batchResult = JSON.parse(readFileSync(join(item.resultsDir, 'result.json'), 'utf8'));
      const pick = git(['cherry-pick', batchResult.headSha], root);
      if (pick.status !== 0) {
        git(['cherry-pick', '--abort'], root);
        throw new Error(`BUN_AGY_INTEGRATION_CONFLICT: ${item.batch.id}: ${pick.stderr}`);
      }
      updateFileStates(manifest, item.batch.files, 'MIGRATED', root);
      const verification = targetedVerify(root, manifest, policy, item.batch.files);
      item.batch.verification = verification.evidence;
      if (!verification.evidence.ok) {
        item.batch.state = 'BLOCKED';
        updateFileStates(manifest, item.batch.files, 'BLOCKED');
        saveManifest(manifestFile, manifest);
        throw new Error(`BUN_AGY_BATCH_RED: ${item.batch.id}`);
      }
      item.batch.state = 'VERIFIED';
      item.batch.codexCalls = 0;
      item.batch.claudeCalls = 0;
      item.batch.model = policy.agyModel;
      item.batch.reasoning = policy.agyEffort;
      updateFileStates(manifest, item.batch.files, 'VERIFIED', root);
      item.batch.testedHead = git(['rev-parse', 'HEAD'], root).stdout.trim();
      saveManifest(manifestFile, manifest);
      item.batch.checkpointHead = commitCheckpoint(root, `chore(bun): checkpoint ${item.batch.id}`);
      item.batch.worktreeRemoved = cleanupAgyWorktree(root, item);
    }
    offset += width;
  }
  return manifest;
}

export function prepareMigration({ root, manifestFile }) {
  const previousFile = existsSync(manifestFile) ? manifestFile : null;
  const previous = previousFile ? JSON.parse(readFileSync(previousFile, 'utf8')) : null;
  const manifest = buildBunMigrationManifest({ root, previousFile });
  const previousBatches = new Map((previous?.batches ?? []).map((batch) => [batch.id, batch]));
  const completed = (previous?.batches ?? []).filter((batch) => batch.state === 'VERIFIED');
  const planned = planMigrationBatches(manifest).map(
    (batch) => previousBatches.get(batch.id) ?? batch,
  );
  manifest.batches = [...completed, ...planned].filter(
    (batch, index, all) => all.findIndex((candidate) => candidate.id === batch.id) === index,
  );
  saveManifest(manifestFile, manifest);
  return manifest;
}

async function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = value('--root') ?? process.cwd();
  const manifestFile = value('--manifest') ?? join(root, DEFAULT_MANIFEST);
  const policy = JSON.parse(
    readFileSync(value('--policy') ?? join(root, 'config', 'foresift-test-runtime.json'), 'utf8'),
  );
  const manifest = prepareMigration({ root, manifestFile });
  if (argv.includes('--prepare')) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        total: manifest.totalTestFiles,
        batches: manifest.batches.length,
      }) + '\n',
    );
    return;
  }
  if (argv.includes('--mechanical')) {
    runMechanicalBatches({ root, manifestFile, manifest, policy });
    process.stdout.write(JSON.stringify({ ok: true, counts: manifest.counts }) + '\n');
    return;
  }
  if (argv.includes('--agy')) {
    await runAgyBatches({
      root,
      artifactsDir: value('--artifacts-dir') ?? join(root, '.archon', 'bun-migration'),
      manifestFile,
      manifest,
      policy,
    });
    process.stdout.write(JSON.stringify({ ok: true, counts: manifest.counts }) + '\n');
    return;
  }
  console.error('usage: bun-migration-runner.mjs --prepare|--mechanical|--agy [--root dir]');
  process.exit(2);
}

if (process.argv[1]?.endsWith('bun-migration-runner.mjs'))
  cli().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  });
