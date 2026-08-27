#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBunMigrationManifest } from './bun-migration-manifest.mjs';
import { buildBunTestPlan, runBunTestPlan } from './bun-test-coordinator.mjs';

const root = process.cwd();
const policy = JSON.parse(readFileSync(join(root, 'config', 'foresift-test-runtime.json'), 'utf8'));
const manifest = buildBunMigrationManifest({ root });

const bunFiles = manifest.files
  .filter((entry) => ['MIGRATED', 'VERIFIED'].includes(entry.state))
  .map((entry) => entry.path);
const unmigrated = manifest.files
  .filter((entry) => !['MIGRATED', 'VERIFIED'].includes(entry.state))
  .map((entry) => entry.path);

if (policy.currentAuthority !== 'BUN_TEST') {
  console.error(`INVALID_TEST_AUTHORITY: expected BUN_TEST, got ${policy.currentAuthority}`);
  process.exit(1);
}

if (unmigrated.length > 0) {
  console.error(`BUN_AUTHORITY_UNMIGRATED_FILES: ${unmigrated.slice(0, 20).join(',')}`);
  process.exit(1);
}

if (bunFiles.length > 0) {
  const plan = buildBunTestPlan(manifest, policy, bunFiles);
  const evidence = runBunTestPlan({ root, plan, policy });
  if (!evidence.ok) {
    for (const r of evidence.results ?? []) {
      if (r.status !== 0) {
        console.error(`FAILED GROUP: ${r.id} (${r.workload}) - files: ${r.files.join(', ')}`);
        console.error(`STDOUT:\n${r.stdoutTail}`);
        console.error(`STDERR:\n${r.stderrTail}`);
      }
    }
    process.exit(1);
  }
}

process.stdout.write(
  JSON.stringify({
    schema: 'foresift/test-authority-result@1',
    authority: policy.currentAuthority,
    vitestFiles: 0,
    bunFiles: bunFiles.length,
    passed: true,
  }) + '\n',
);
