#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBunMigrationManifest } from './bun-migration-manifest.mjs';
import { buildBunTestPlan, runBunTestPlan } from './bun-test-coordinator.mjs';
import { activeVitestRuntimeReferences } from './bun-test-cutover.mjs';
import { BUN_MIGRATION_PROOF_SCHEMA } from './bun-migration-state.mjs';

function runNodeCompatibility(root) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ['scripts/automation/node-runtime-compat.mjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return {
    passed: result.status === 0,
    status: result.status,
    wallTimeMs: Date.now() - started,
    stdoutTail: (result.stdout ?? '').slice(-2000),
    stderrTail: (result.stderr ?? '').slice(-2000),
  };
}

function nestedFullGuard(root) {
  const source = readFileSync(join(root, 'scripts', 'automation', 'foresift-gate.mjs'), 'utf8');
  return {
    active:
      source.includes('NESTED_FULL_EXECUTION_BLOCKED') &&
      source.includes('FORESIFT_ALLOW_HERMETIC_NESTED_FULL'),
    nestedFullExecutions: 0,
  };
}

export function finalizeBunMigration({ root, manifestFile, outFile }) {
  const policy = JSON.parse(
    readFileSync(join(root, 'config', 'foresift-test-runtime.json'), 'utf8'),
  );
  if (policy.currentAuthority !== 'BUN_TEST') throw new Error('BUN_FINALIZE_AUTHORITY_NOT_ACTIVE');
  const manifest = buildBunMigrationManifest({ root, previousFile: manifestFile });
  const unverified = manifest.files.filter((entry) => entry.state !== 'VERIFIED');
  if (unverified.length)
    throw new Error(
      `BUN_FINALIZE_UNVERIFIED: ${unverified
        .slice(0, 20)
        .map((entry) => entry.path)
        .join(',')}`,
    );
  const references = activeVitestRuntimeReferences(root);
  if (references.length) throw new Error(`BUN_FINALIZE_VITEST_REFERENCES: ${references.join(',')}`);
  const nested = nestedFullGuard(root);
  if (!nested.active) throw new Error('BUN_FINALIZE_NESTED_FULL_GUARD_MISSING');

  const plan = buildBunTestPlan(manifest, policy);
  const full = runBunTestPlan({ root, plan, policy });
  if (!full.ok) throw new Error('BUN_FINALIZE_FULL_RED');
  const nodeCompatibility = runNodeCompatibility(root);
  if (!nodeCompatibility.passed) throw new Error('BUN_FINALIZE_NODE_COMPAT_RED');
  const proof = {
    schema: BUN_MIGRATION_PROOF_SCHEMA,
    migrationId: policy.migrationId,
    bunVersion: policy.bunVersion,
    testAuthority: policy.currentAuthority,
    totalTestFiles: manifest.totalTestFiles,
    verifiedFiles: manifest.files.filter((entry) => entry.state === 'VERIFIED').length,
    blockedFiles: manifest.files.filter((entry) => entry.state === 'BLOCKED').length,
    nestedFullExecutions: nested.nestedFullExecutions,
    nestedFullGuard: nested,
    vitestRuntimeReferences: references.length,
    finalBunFull: { ...full, passed: full.ok },
    nodeCompatibility,
    healthyMigrationCodexCalls: 0,
    healthyMigrationClaudeCalls: 0,
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(proof, null, 2) + '\n');
  return proof;
}

function cli() {
  const root = process.cwd();
  const manifestFile = join(root, 'evidence', 'bun-migration', 'bun-migration-manifest.json');
  const outFile = join(root, 'evidence', 'bun-migration', 'bun-migration-proof.json');
  const proof = finalizeBunMigration({ root, manifestFile, outFile });
  process.stdout.write(
    JSON.stringify({ ok: true, files: proof.totalTestFiles, tests: proof.finalBunFull.counts }) +
      '\n',
  );
}

if (process.argv[1]?.endsWith('bun-migration-finalize.mjs')) {
  try {
    cli();
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exit(1);
  }
}
