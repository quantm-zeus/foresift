#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBunMigrationManifest } from './bun-migration-manifest.mjs';

const CONFIG_FILES = [
  'vitest.config.ts',
  'packages/domain/vitest.config.ts',
  'packages/evidence/vitest.config.ts',
  'packages/object-store/vitest.config.ts',
  'packages/persistence/vitest.config.ts',
  'packages/provider-lifecycle/vitest.config.ts',
  'packages/providers/vitest.config.ts',
  'packages/security/vitest.config.ts',
  'packages/shared-schemas/vitest.config.ts',
  'packages/tenant-isolation/vitest.config.ts',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function packageJsonFiles(root) {
  const result = spawnSync('git', ['ls-files', 'packages/*/package.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`BUN_CUTOVER_PACKAGE_SCAN_FAILED: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean);
}

export function activeVitestRuntimeReferences(root) {
  const manifest = buildBunMigrationManifest({ root });
  const references = [];
  for (const entry of manifest.files)
    if (entry.vitestImports.length > 0 || entry.features.includes('vitest-runtime-reference'))
      references.push(`${entry.path}:test-runtime`);
  for (const file of ['package.json', ...packageJsonFiles(root)]) {
    const value = readJson(join(root, file));
    if (value.dependencies?.vitest || value.devDependencies?.vitest)
      references.push(`${file}:dependency`);
    for (const [name, command] of Object.entries(value.scripts ?? {}))
      if (/\bvitest\b/.test(command)) references.push(`${file}:scripts.${name}`);
  }
  for (const file of CONFIG_FILES) if (existsSync(join(root, file))) references.push(file);
  const ciFile = join(root, '.github', 'workflows', 'ci.yml');
  if (existsSync(ciFile) && /\bvitest\b/.test(readFileSync(ciFile, 'utf8')))
    references.push('.github/workflows/ci.yml');
  return references;
}

export function assertMigrationReady(root, manifestFile) {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const current = buildBunMigrationManifest({ root, previousFile: manifestFile });
  const missing = current.files.filter((entry) => entry.state !== 'VERIFIED');
  if (current.totalTestFiles !== manifest.totalTestFiles)
    throw new Error(
      `BUN_CUTOVER_INVENTORY_DRIFT: ${manifest.totalTestFiles} -> ${current.totalTestFiles}`,
    );
  if (missing.length)
    throw new Error(
      `BUN_CUTOVER_UNVERIFIED: ${missing
        .slice(0, 20)
        .map((entry) => entry.path)
        .join(',')}`,
    );
  return current;
}

export function applyBunCutover({ root, manifestFile }) {
  const manifest = assertMigrationReady(root, manifestFile);
  const rootPackageFile = join(root, 'package.json');
  const rootPackage = readJson(rootPackageFile);
  rootPackage.scripts.test = 'node scripts/automation/test-authority.mjs';
  rootPackage.scripts['test:unit'] =
    'node scripts/automation/bun-test-coordinator.mjs --manifest evidence/bun-migration/bun-migration-manifest.json --workload PURE';
  rootPackage.scripts['test:integration'] =
    'node scripts/automation/bun-test-coordinator.mjs --manifest evidence/bun-migration/bun-migration-manifest.json --workload PROCESS,DATABASE_PGLITE,META_GATE';
  rootPackage.scripts['test:watch'] = 'bun test --watch';
  delete rootPackage.dependencies?.vitest;
  delete rootPackage.devDependencies?.vitest;
  writeJson(rootPackageFile, rootPackage);

  for (const file of packageJsonFiles(root)) {
    const absolute = join(root, file);
    const value = readJson(absolute);
    if (value.scripts?.test) {
      value.scripts.test = 'bun test';
      writeJson(absolute, value);
    }
  }

  const tsconfigFile = join(root, 'tsconfig.json');
  const tsconfig = readJson(tsconfigFile);
  if (Array.isArray(tsconfig.compilerOptions?.types))
    tsconfig.compilerOptions.types = tsconfig.compilerOptions.types.filter(
      (entry) => entry !== 'vitest/globals',
    );
  tsconfig.compilerOptions.types ??= [];
  if (!tsconfig.compilerOptions.types.includes('bun')) tsconfig.compilerOptions.types.push('bun');
  writeJson(tsconfigFile, tsconfig);

  for (const file of CONFIG_FILES) {
    const absolute = join(root, file);
    if (existsSync(absolute)) unlinkSync(absolute);
  }

  const policyFile = join(root, 'config', 'foresift-test-runtime.json');
  const policy = readJson(policyFile);
  policy.currentAuthority = 'BUN_TEST';
  writeJson(policyFile, policy);

  const ciFile = join(root, '.github', 'workflows', 'ci.yml');
  const ci = readFileSync(ciFile, 'utf8');
  if (!ci.includes('oven-sh/setup-bun')) {
    const anchor = '      - name: Install dependencies (frozen lockfile)\n';
    if (!ci.includes(anchor)) throw new Error('BUN_CUTOVER_CI_ANCHOR_MISSING');
    writeFileSync(
      ciFile,
      ci.replace(
        anchor,
        '      - name: Install Bun Test (pinned)\n' +
          '        uses: oven-sh/setup-bun@v2\n' +
          '        with:\n' +
          `          bun-version: ${policy.bunVersion}\n\n` +
          anchor,
      ),
    );
  }

  const install = spawnSync('pnpm', ['install', '--lockfile-only'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10 * 60_000,
  });
  if (install.status !== 0)
    throw new Error(`BUN_CUTOVER_LOCKFILE_FAILED: ${(install.stderr ?? '').slice(-2000)}`);
  const references = activeVitestRuntimeReferences(root);
  if (references.length) throw new Error(`BUN_CUTOVER_VITEST_REFERENCES: ${references.join(',')}`);
  return { manifest, references, bunVersion: policy.bunVersion };
}

function cli() {
  const root = process.cwd();
  const manifestFile = join(root, 'evidence', 'bun-migration', 'bun-migration-manifest.json');
  const result = applyBunCutover({ root, manifestFile });
  process.stdout.write(
    JSON.stringify({ ok: true, totalTestFiles: result.manifest.totalTestFiles }) + '\n',
  );
}

if (process.argv[1]?.endsWith('bun-test-cutover.mjs')) {
  try {
    cli();
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exit(1);
  }
}
