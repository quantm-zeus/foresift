// Bun Migration Infrastructure deterministic contract suite.
// Covers test-authority migration state transitions, barrier evaluation,
// maintenance workflow topology, manifest integrity, resource-bounded
// coordination, affected-test selection, cutover safety, and Node 24 compat.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  BUN_MIGRATION_PROOF_SCHEMA,
  evaluateBunMigrationBarrier,
  validateBunMigrationProof,
} from '../../scripts/automation/bun-migration-state.mjs';
import {
  BUN_MIGRATION_MANIFEST_SCHEMA,
  analyzeTestFile,
  buildBunMigrationManifest,
  isTestFile,
} from '../../scripts/automation/bun-migration-manifest.mjs';
import { migrateMechanicalFile } from '../../scripts/automation/bun-migration-codemod.mjs';
import {
  planMigrationBatches,
  prepareMigration,
  runMechanicalBatches,
} from '../../scripts/automation/bun-migration-runner.mjs';
import { buildBunTestPlan, bunTestArgs } from '../../scripts/automation/bun-test-coordinator.mjs';
import {
  repositorySourcePaths,
  selectAffectedTests,
} from '../../scripts/automation/bun-affected-tests.mjs';
import {
  activeVitestRuntimeReferences,
  assertMigrationReady,
} from '../../scripts/automation/bun-test-cutover.mjs';
import { validateLaneOwnership } from '../../scripts/automation/path-ownership.mjs';
import { canStartPackage } from '../../scripts/automation/schema.mjs';
import { disposeGitFixtureBase, gitFixture } from '../helpers/git-fixture.js';

const REPO = process.cwd();
const POLICY_FILE = join(REPO, 'config', 'foresift-test-runtime.json');
const DEFAULT_POLICY = JSON.parse(readFileSync(POLICY_FILE, 'utf8'));

let scratch: string;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'foresift-bun-spec-'));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  disposeGitFixtureBase();
});

const writeScratch = (rel: string, content: string) => {
  const p = join(scratch, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
  return p;
};

// ── Contract 1: CURRENT_PACKAGE permits only g0-tool-core; PROVEN requires migration barrier ──
describe('Contract 1: Bun migration barrier and package eligibility', () => {
  const baseMilestone = {
    milestoneId: 'G0',
    status: 'ACTIVE',
    packages: [
      { id: 'g0-contracts-data-truth', status: 'PROVEN' },
      { id: 'g0-security-perimeter', status: 'PROVEN' },
      { id: 'g0-tool-core', status: 'RUNNING' },
      { id: 'g0-provider-lifecycle', status: 'PENDING' },
    ],
  };

  it('CURRENT_PACKAGE permits g0-tool-core while its status is RUNNING or PENDING', () => {
    const verdict = evaluateBunMigrationBarrier({
      policy: DEFAULT_POLICY,
      milestone: baseMilestone,
      runtimeState: null,
      proof: null,
    });
    expect(verdict.state).toBe('CURRENT_PACKAGE');
    expect(verdict.reason).toBe('current-package-RUNNING');
  });

  it('CURRENT_PACKAGE is returned when g0-tool-core is missing from milestone packages', () => {
    const verdict = evaluateBunMigrationBarrier({
      policy: DEFAULT_POLICY,
      milestone: { milestoneId: 'G0', packages: [] },
      runtimeState: null,
      proof: null,
    });
    expect(verdict.state).toBe('CURRENT_PACKAGE');
    expect(verdict.reason).toBe('current-package-missing');
  });

  it('after g0-tool-core is PROVEN, barrier enters BUN_MIGRATION_REQUIRED without valid proof', () => {
    const provenMilestone = {
      ...baseMilestone,
      packages: baseMilestone.packages.map((pkg) =>
        pkg.id === 'g0-tool-core' ? { ...pkg, status: 'PROVEN' } : pkg,
      ),
    };
    const verdict = evaluateBunMigrationBarrier({
      policy: DEFAULT_POLICY,
      milestone: provenMilestone,
      runtimeState: null,
      proof: null,
    });
    expect(verdict.state).toBe('BUN_MIGRATION_REQUIRED');
    expect(verdict.reason).toMatch(/^proof-invalid:/);
  });

  it('migrationNotRequired policy bypasses barrier directly to BUN_MIGRATION_PROVEN', () => {
    const verdict = evaluateBunMigrationBarrier({
      policy: { ...DEFAULT_POLICY, migrationRequired: false },
      milestone: baseMilestone,
      runtimeState: null,
      proof: null,
    });
    expect(verdict.state).toBe('BUN_MIGRATION_PROVEN');
    expect(verdict.reason).toBe('migration-not-required');
  });
});

// ── Contract 2: RUNNING survives restart; valid durable proof releases; invalid proof fails ──
describe('Contract 2: Durable proof lifecycle and crash-safe state restart', () => {
  const validProof = {
    schema: BUN_MIGRATION_PROOF_SCHEMA,
    migrationId: DEFAULT_POLICY.migrationId,
    bunVersion: DEFAULT_POLICY.bunVersion,
    testAuthority: 'BUN_TEST',
    totalTestFiles: 95,
    verifiedFiles: 95,
    blockedFiles: 0,
    nestedFullExecutions: 0,
    nestedFullGuard: { active: true },
    vitestRuntimeReferences: 0,
    finalBunFull: { passed: true, counts: { passed: 95, failed: 0, skipped: 0 } },
    nodeCompatibility: { passed: true },
    healthyMigrationCodexCalls: 0,
    healthyMigrationClaudeCalls: 0,
    generatedAt: '2026-08-26T00:00:00.000Z',
  };

  it('RUNNING status in runtime state survives restart against proven g0-tool-core', () => {
    const provenMilestone = {
      milestoneId: 'G0',
      packages: [{ id: 'g0-tool-core', status: 'PROVEN' }],
    };
    const verdict = evaluateBunMigrationBarrier({
      policy: DEFAULT_POLICY,
      milestone: provenMilestone,
      runtimeState: { status: 'BUN_MIGRATION_RUNNING', runId: 'run-123' },
      proof: null,
    });
    expect(verdict.state).toBe('BUN_MIGRATION_RUNNING');
    expect(verdict.reason).toBe('tracked-maintenance-run');
  });

  it('valid durable proof releases barrier to BUN_MIGRATION_PROVEN', () => {
    const proofValidation = validateBunMigrationProof(validProof, DEFAULT_POLICY);
    expect(proofValidation.valid).toBe(true);
    expect(proofValidation.reasons).toEqual([]);

    const verdict = evaluateBunMigrationBarrier({
      policy: DEFAULT_POLICY,
      milestone: { milestoneId: 'G0', packages: [{ id: 'g0-tool-core', status: 'PROVEN' }] },
      runtimeState: null,
      proof: validProof,
    });
    expect(verdict.state).toBe('BUN_MIGRATION_PROVEN');
    expect(verdict.reason).toBe('durable-proof');
  });

  it.each([
    ['schema', { schema: 'invalid-schema' }],
    ['migrationId', { migrationId: 'wrong-id' }],
    ['bunVersion', { bunVersion: '9.9.9' }],
    ['testAuthority', { testAuthority: 'VITEST_TRANSITION' }],
    ['totalTestFiles', { totalTestFiles: 0 }],
    ['verifiedFiles', { verifiedFiles: 94 }],
    ['blockedFiles', { blockedFiles: 1 }],
    ['nestedFullExecutions', { nestedFullExecutions: 1 }],
    ['nestedFullGuard', { nestedFullGuard: { active: false } }],
    ['vitestRuntimeReferences', { vitestRuntimeReferences: 1 }],
    ['finalBunFull', { finalBunFull: { passed: false } }],
    ['nodeCompatibility', { nodeCompatibility: { passed: false } }],
    ['healthyMigrationCodexCalls', { healthyMigrationCodexCalls: 1 }],
    ['healthyMigrationClaudeCalls', { healthyMigrationClaudeCalls: 1 }],
  ])('invalid proof property %s fails validation and blocks barrier release', (key, override) => {
    const invalid = { ...validProof, ...override };
    const verdict = validateBunMigrationProof(invalid, DEFAULT_POLICY);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain(key);
  });
});

// ── Contract 3: Maintenance workflow structure, topology, and execution bounds ──
describe('Contract 3: Maintenance workflow topology and bounds', () => {
  const workflowPath = join(
    REPO,
    '.archon',
    'workflows',
    'foresift',
    'foresift-bun-test-migration.yaml',
  );
  const workflowText = readFileSync(workflowPath, 'utf8');

  it('workflow contains all required nodes in exact topological order', () => {
    expect(workflowText).toContain('id: preflight');
    expect(workflowText).toContain('id: mechanical-batches');
    expect(workflowText).toContain('id: agy-semantic-batches');
    expect(workflowText).toContain('id: cutover');
    expect(workflowText).toContain('id: authoritative-bun-full');
    expect(workflowText).toContain('id: exact-head-ci-and-merge');

    // Dependencies enforce strict serial progression:
    expect(workflowText).toContain('depends_on: [preflight]');
    expect(workflowText).toContain('depends_on: [mechanical-batches]');
    expect(workflowText).toContain('depends_on: [agy-semantic-batches]');
    expect(workflowText).toContain('depends_on: [cutover]');
    expect(workflowText).toContain('depends_on: [authoritative-bun-full]');
  });

  it('workflow is bash-only and defines zero Codex or Claude agent nodes', () => {
    expect(workflowText).not.toMatch(/agent:\s*codex/i);
    expect(workflowText).not.toMatch(/agent:\s*claude/i);
    expect(workflowText).not.toMatch(/prompt:\s*\|/i);
    // Every node has a bash script payload:
    const bashMatches = [...workflowText.matchAll(/bash:\s*\|/g)];
    expect(bashMatches.length).toBe(6);
  });

  it('maintenance preflight installs frozen pnpm lockfile before invoking TypeScript-dependent Bun migration modules', () => {
    const preflightMatch = workflowText.match(/- id:\s*preflight[\s\S]*?(?=- id:|$)/);
    expect(preflightMatch).not.toBeNull();
    const preflightText = preflightMatch![0];

    // Must install frozen lockfile
    expect(preflightText).toContain('pnpm install --frozen-lockfile');

    // pnpm install must occur before invoking migration modules
    const pnpmInstallIndex = preflightText.indexOf('pnpm install --frozen-lockfile');
    const stateScriptIndex = preflightText.indexOf('scripts/automation/bun-migration-state.mjs');
    const runnerScriptIndex = preflightText.indexOf('scripts/automation/bun-migration-runner.mjs');

    expect(pnpmInstallIndex).toBeGreaterThan(-1);
    expect(stateScriptIndex).toBeGreaterThan(pnpmInstallIndex);
    expect(runnerScriptIndex).toBeGreaterThan(pnpmInstallIndex);

    // Verify imported dependencies: runner and manifest/codemod depend on typescript
    const manifestCode = readFileSync(
      join(REPO, 'scripts', 'automation', 'bun-migration-manifest.mjs'),
      'utf8',
    );
    const codemodCode = readFileSync(
      join(REPO, 'scripts', 'automation', 'bun-migration-codemod.mjs'),
      'utf8',
    );
    const affectedCode = readFileSync(
      join(REPO, 'scripts', 'automation', 'bun-affected-tests.mjs'),
      'utf8',
    );

    expect(manifestCode).toContain("from 'typescript'");
    expect(codemodCode).toContain("from 'typescript'");
    expect(affectedCode).toContain("from 'typescript'");
  });

  it('operator-authorized merge node uses explicit supported gh pr merge --admin path without gh pr checks --watch after authoritative-bun-full', () => {
    const mergeMatch = workflowText.match(/- id:\s*exact-head-ci-and-merge[\s\S]*?(?=- id:|$)/);
    expect(mergeMatch).not.toBeNull();
    const mergeText = mergeMatch![0];

    // Node must depend strictly on authoritative-bun-full
    expect(mergeText).toContain('depends_on: [authoritative-bun-full]');

    // Must not call gh pr checks --watch or wait on remote CI queue
    expect(mergeText).not.toMatch(/gh\s+pr\s+checks/);
    expect(mergeText).not.toContain('--watch');

    // Must use explicit admin merge path
    expect(mergeText).toContain('gh pr merge "$PR" --squash --admin');
    expect(mergeText).not.toContain('--delete-branch');

    // Must verify durable merge audit record
    expect(mergeText).toContain(
      'gh pr view "$PR" --json state,mergedAt,mergeCommit > "$ARTIFACTS_DIR/merged-pr.json"',
    );
    expect(mergeText).toContain('test "$(jq -r .state "$ARTIFACTS_DIR/merged-pr.json")" = MERGED');
  });

  it('policy specifies AGY Gemini 3.7 Flash (High) with bounded concurrency', () => {
    expect(DEFAULT_POLICY.agyModel).toBe('gemini-3.7-flash-high');
    expect(DEFAULT_POLICY.agyEffort).toBe('high');
    expect(DEFAULT_POLICY.agyMaxConcurrency).toBeLessThanOrEqual(3);
    expect(DEFAULT_POLICY.agyHeavyMaxConcurrency).toBe(1);
  });
});

// ── Contract 4: Manifest inventory parity, mechanical vs semantic, batch resumption ──
describe('Contract 4: Manifest inventory integrity and batch classification', () => {
  it('isTestFile identifies standard and negative test naming patterns', () => {
    expect(isTestFile('tests/automation/control-plane.spec.ts')).toBe(true);
    expect(isTestFile('packages/domain/test/account.test.ts')).toBe(true);
    expect(isTestFile('tests/negative/AC-020.negative.spec.ts')).toBe(true);
    expect(isTestFile('packages/domain/src/index.ts')).toBe(false);
    expect(isTestFile('tests/helpers/v2-fixtures.ts')).toBe(false);
  });

  it('detects disappearing test files as BUN_MIGRATION_TEST_LOSS (fail-closed)', () => {
    const previousManifestFile = writeScratch(
      'manifest-loss-test.json',
      JSON.stringify({
        schema: BUN_MIGRATION_MANIFEST_SCHEMA,
        totalTestFiles: 2,
        files: [
          { path: 'tests/automation/control-plane.spec.ts', state: 'VERIFIED', sha256: 'a1' },
          { path: 'tests/nonexistent-lost-test.spec.ts', state: 'VERIFIED', sha256: 'a2' },
        ],
      }),
    );
    expect(() =>
      buildBunMigrationManifest({ root: REPO, previousFile: previousManifestFile }),
    ).toThrow(/BUN_MIGRATION_TEST_LOSS/);
  });

  it('classifies simple mechanical vitest imports as CODEMOD_READY', () => {
    const dir = mkdtempSync(join(scratch, 'mechanical-'));
    const testPath = 'pkg.spec.ts';
    writeFileSync(
      join(dir, testPath),
      "import { describe, expect, it } from 'vitest';\ndescribe('m', () => { it('t', () => { expect(1).toBe(1); }); });\n",
    );
    const analysis = analyzeTestFile(dir, testPath);
    expect(analysis.migrationType).toBe('EASY_MECHANICAL');
    expect(analysis.state).toBe('CODEMOD_READY');
  });

  it('classifies semantic vitest constructs (mocks, vi namespace, each) as AGY_REQUIRED', () => {
    const dir = mkdtempSync(join(scratch, 'semantic-'));
    const testPath = 'semantic.spec.ts';
    writeFileSync(
      join(dir, testPath),
      "import { describe, expect, it, vi } from 'vitest';\nvi.mock('./mod');\ndescribe('s', () => { it('t', () => {}); });\n",
    );
    const analysis = analyzeTestFile(dir, testPath);
    expect(analysis.migrationType).toBe('SEMANTIC_REWRITE');
    expect(analysis.state).toBe('AGY_REQUIRED');
  });

  it('mechanical codemod transforms vitest import to bun:test cleanly', () => {
    const dir = mkdtempSync(join(scratch, 'codemod-exec-'));
    const testPath = 'unit.spec.ts';
    writeFileSync(
      join(dir, testPath),
      "import { describe, expect, it } from 'vitest';\ndescribe('a', () => { it('b', () => {}); });\n",
    );
    const entry = analyzeTestFile(dir, testPath);
    const result = migrateMechanicalFile(dir, entry, { write: true });
    expect(result.changed).toBe(true);
    expect(result.output).toContain("import { describe, expect, it } from 'bun:test';");
    expect(result.output).not.toContain('vitest');
  });

  it('previously verified batches and files resume without reprocessing', () => {
    const fx = gitFixture('resume-fixture');
    fx.writeFile(
      'packages/domain/test/unit.spec.ts',
      "import { describe, it } from 'bun:test';\ndescribe('a', () => { it('b', () => {}); });\n",
    );
    const manifest = {
      schema: BUN_MIGRATION_MANIFEST_SCHEMA,
      migrationId: 'bun-test-authority-v1',
      totalTestFiles: 1,
      files: [{ path: 'packages/domain/test/unit.spec.ts', state: 'VERIFIED', workload: 'PURE' }],
      batches: [
        {
          id: 'mechanical-batch-1',
          engine: 'CODEMOD',
          state: 'VERIFIED',
          files: ['packages/domain/test/unit.spec.ts'],
        },
      ],
    };
    const manifestPath = join(fx.root, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const prepared = prepareMigration({ root: fx.root, manifestFile: manifestPath });
    const batch = prepared.batches.find((b) => b.id === 'mechanical-batch-1');
    expect(batch?.state).toBe('VERIFIED');
  });

  it('classifies Bun-native imports as ALREADY_MIGRATED and MIGRATED state', () => {
    const dir = mkdtempSync(join(scratch, 'pre-migrated-'));
    const testPath = 'bun-native.spec.ts';
    writeFileSync(
      join(dir, testPath),
      "import { describe, expect, it } from 'bun:test';\ndescribe('native', () => { it('t', () => { expect(1).toBe(1); }); });\n",
    );
    const analysis = analyzeTestFile(dir, testPath);
    expect(analysis.migrationType).toBe('ALREADY_MIGRATED');
    expect(analysis.state).toBe('MIGRATED');
  });

  it('manifest entry in MIGRATED state produces a VERIFY_EXISTING batch rather than being silently omitted', () => {
    const manifest = {
      schema: BUN_MIGRATION_MANIFEST_SCHEMA,
      migrationId: 'bun-test-authority-v1',
      totalTestFiles: 2,
      files: [
        {
          path: 'packages/domain/test/pre-migrated.spec.ts',
          package: '@foresift/domain',
          workload: 'PURE',
          migrationType: 'ALREADY_MIGRATED',
          state: 'MIGRATED',
        },
        {
          path: 'packages/db/test/pre-migrated-db.spec.ts',
          package: '@foresift/db',
          workload: 'DATABASE_PGLITE',
          migrationType: 'ALREADY_MIGRATED',
          state: 'MIGRATED',
        },
      ],
      batches: [],
    };
    const batches = planMigrationBatches(manifest);
    expect(batches.length).toBe(2);

    const pureBatch = batches.find((b) =>
      b.files.includes('packages/domain/test/pre-migrated.spec.ts'),
    );
    expect(pureBatch).toBeDefined();
    expect(pureBatch?.engine).toBe('VERIFY_EXISTING');
    expect(pureBatch?.id).toBe('verify-existing--foresift-domain-pure-1');
    expect(pureBatch?.workload).toBe('PURE');
    expect(pureBatch?.state).toBe('PENDING');

    const dbBatch = batches.find((b) =>
      b.files.includes('packages/db/test/pre-migrated-db.spec.ts'),
    );
    expect(dbBatch).toBeDefined();
    expect(dbBatch?.engine).toBe('VERIFY_EXISTING');
    expect(dbBatch?.id).toBe('verify-existing--foresift-db-database-pglite-1');
    expect(dbBatch?.workload).toBe('DATABASE_PGLITE');
    expect(dbBatch?.state).toBe('PENDING');
  });

  it('VERIFY_EXISTING batch advances Bun-native file to VERIFIED with zero inference and no codemod rewrite', () => {
    const fx = gitFixture('verify-existing-fx');
    const testFile = 'packages/domain/test/native-unit.spec.ts';
    const sourceContent = [
      "import { describe, expect, it } from 'bun:test';",
      '// preserved exact comments without rewrite',
      "describe('native unit test', () => {",
      "  it('executes directly under bun', () => {",
      '    expect(10 + 20).toBe(30);',
      '  });',
      '});',
      '',
    ].join('\n');
    fx.writeFile(testFile, sourceContent);
    fx.commitAll('add bun-native test');

    const manifestPath = join(fx.root, 'manifest.json');
    const preparedManifest = prepareMigration({ root: fx.root, manifestFile: manifestPath });

    const initialEntry = preparedManifest.files.find((f) => f.path === testFile);
    expect(initialEntry?.state).toBe('MIGRATED');
    expect(initialEntry?.migrationType).toBe('ALREADY_MIGRATED');

    const batch = preparedManifest.batches.find((b) => b.files.includes(testFile));
    expect(batch).toBeDefined();
    expect(batch?.engine).toBe('VERIFY_EXISTING');
    expect(batch?.state).toBe('PENDING');

    const resultManifest = runMechanicalBatches({
      root: fx.root,
      manifestFile: manifestPath,
      manifest: preparedManifest,
      policy: DEFAULT_POLICY,
    });

    expect(batch?.state).toBe('VERIFIED');
    expect(batch?.codexCalls).toBe(0);
    expect(batch?.claudeCalls).toBe(0);
    expect(batch?.verification?.ok).toBe(true);

    const updatedEntry = resultManifest.files.find((f) => f.path === testFile);
    expect(updatedEntry?.state).toBe('VERIFIED');

    // Content remains completely untouched (no codemod rewrite performed)
    const contentOnDisk = readFileSync(join(fx.root, testFile), 'utf8');
    expect(contentOnDisk).toBe(sourceContent);
  });

  it('previously VERIFIED pre-migrated entries remain skipped on restart', () => {
    const fx = gitFixture('verify-existing-restart-fx');
    const testFile = 'packages/domain/test/restart-unit.spec.ts';
    const sourceContent = [
      "import { describe, expect, it } from 'bun:test';",
      "describe('restart test', () => {",
      "  it('passes', () => {",
      '    expect(true).toBe(true);',
      '  });',
      '});',
      '',
    ].join('\n');
    fx.writeFile(testFile, sourceContent);
    fx.commitAll('add restart test');

    const manifestPath = join(fx.root, 'manifest.json');
    const manifest = prepareMigration({ root: fx.root, manifestFile: manifestPath });
    runMechanicalBatches({
      root: fx.root,
      manifestFile: manifestPath,
      manifest,
      policy: DEFAULT_POLICY,
    });

    expect(manifest.files.find((f) => f.path === testFile)?.state).toBe('VERIFIED');
    const batch = manifest.batches.find((b) => b.files.includes(testFile));
    expect(batch?.state).toBe('VERIFIED');

    // Restart: re-prepare migration with saved manifest
    const restartedManifest = prepareMigration({ root: fx.root, manifestFile: manifestPath });
    const restartedEntry = restartedManifest.files.find((f) => f.path === testFile);
    expect(restartedEntry?.state).toBe('VERIFIED');

    const restartedBatch = restartedManifest.batches.find((b) => b.files.includes(testFile));
    expect(restartedBatch?.state).toBe('VERIFIED');

    const pendingBatches = restartedManifest.batches.filter(
      (b) => ['CODEMOD', 'VERIFY_EXISTING'].includes(b.engine) && b.state !== 'VERIFIED',
    );
    expect(pendingBatches).toHaveLength(0);
  });

  it('restarts replan pending AGY batches to exclude now-native files while retaining attempt counts and verified checkpoints', () => {
    const fx = gitFixture('stale-pending-replan-fx');
    const verifiedFile = 'packages/domain/test/verified.spec.ts';
    const nowNativeFile = 'packages/domain/test/now-native.spec.ts';
    const semanticRemainingFile = 'packages/domain/test/semantic-remaining.spec.ts';

    const verifiedContent =
      "import { describe, expect, it } from 'bun:test';\ndescribe('verified', () => { it('v', () => { expect(1).toBe(1); }); });\n";
    const nowNativeContent =
      "import { describe, expect, it } from 'bun:test';\ndescribe('native', () => { it('n', () => { expect(2).toBe(2); }); });\n";
    const semanticContent =
      "import { describe, expect, it, vi } from 'vitest';\nvi.mock('./mod');\ndescribe('semantic', () => { it('s', () => {}); });\n";

    fx.writeFile(verifiedFile, verifiedContent);
    fx.writeFile(nowNativeFile, nowNativeContent);
    fx.writeFile(semanticRemainingFile, semanticContent);
    fx.commitAll('add fixture test files for stale pending replan test');

    const verifiedSha = createHash('sha256').update(verifiedContent).digest('hex');

    const previousManifest = {
      schema: BUN_MIGRATION_MANIFEST_SCHEMA,
      migrationId: 'bun-test-authority-v1',
      totalTestFiles: 3,
      files: [
        {
          path: verifiedFile,
          package: '@foresift/domain',
          workload: 'PURE',
          migrationType: 'ALREADY_MIGRATED',
          state: 'VERIFIED',
          sha256: verifiedSha,
        },
        {
          path: nowNativeFile,
          package: '@foresift/domain',
          workload: 'PURE',
          migrationType: 'SEMANTIC_REWRITE',
          state: 'AGY_REQUIRED',
          sha256: 'stale-hash-1',
        },
        {
          path: semanticRemainingFile,
          package: '@foresift/domain',
          workload: 'PURE',
          migrationType: 'SEMANTIC_REWRITE',
          state: 'AGY_REQUIRED',
          sha256: 'stale-hash-2',
        },
      ],
      batches: [
        {
          id: 'mechanical-checkpoint-1',
          engine: 'CODEMOD',
          workload: 'PURE',
          files: [verifiedFile],
          state: 'VERIFIED',
          checkpointHead: 'deadbeef1234',
          codexCalls: 0,
          claudeCalls: 0,
        },
        {
          id: 'agy-semantic-1',
          engine: 'AGY',
          workload: 'PURE',
          files: [nowNativeFile, semanticRemainingFile],
          state: 'PENDING',
          attempts: 2,
        },
      ],
    };

    const manifestPath = join(fx.root, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(previousManifest, null, 2) + '\n');

    const prepared = prepareMigration({ root: fx.root, manifestFile: manifestPath });

    // 1. VERIFIED checkpoint batches remain preserved exactly and skipped
    const verifiedBatch = prepared.batches.find((b) => b.id === 'mechanical-checkpoint-1');
    expect(verifiedBatch).toBeDefined();
    expect(verifiedBatch?.state).toBe('VERIFIED');
    expect(verifiedBatch?.files).toEqual([verifiedFile]);
    expect(verifiedBatch?.checkpointHead).toBe('deadbeef1234');
    expect(verifiedBatch?.codexCalls).toBe(0);

    // 2. The already Bun-native file routes to VERIFY_EXISTING, not AGY
    const verifyExistingBatch = prepared.batches.find((b) => b.files.includes(nowNativeFile));
    expect(verifyExistingBatch).toBeDefined();
    expect(verifyExistingBatch?.engine).toBe('VERIFY_EXISTING');
    expect(verifyExistingBatch?.state).toBe('PENDING');
    expect(verifyExistingBatch?.files).toEqual([nowNativeFile]);

    // 3. The new AGY batch contains only currently AGY_REQUIRED files (stale file list not retained)
    const agyBatch = prepared.batches.find((b) => b.id === 'agy-semantic-1');
    expect(agyBatch).toBeDefined();
    expect(agyBatch?.engine).toBe('AGY');
    expect(agyBatch?.state).toBe('PENDING');
    expect(agyBatch?.files).toEqual([semanticRemainingFile]);
    expect(agyBatch?.files.includes(nowNativeFile)).toBe(false);

    // 4. Prior attempt count is retained from previous pending batch
    expect(agyBatch?.attempts).toBe(2);

    // 5. File states in prepared manifest reflect current disk state
    expect(prepared.files.find((f) => f.path === verifiedFile)?.state).toBe('VERIFIED');
    expect(prepared.files.find((f) => f.path === nowNativeFile)?.state).toBe('MIGRATED');
    expect(prepared.files.find((f) => f.path === semanticRemainingFile)?.state).toBe(
      'AGY_REQUIRED',
    );
  });
});

// ── Contract 5: AGY lane ownership enforcement and zero Codex/Claude calls ──
describe('Contract 5: AGY lane ownership validation and zero legacy calls', () => {
  it('AGY test lane accepts test files and helper paths', () => {
    const ownership = validateLaneOwnership({
      engine: 'AGY',
      role: 'test',
      changedPaths: [
        'tests/automation/bun-migration.spec.ts',
        'tests/helpers/v2-fixtures.ts',
        'packages/domain/test/unit.spec.ts',
      ],
    });
    expect(ownership.ok).toBe(true);
    expect(ownership.violationCode).toBeNull();
  });

  it('AGY test lane rejects modifications to product code (fail-closed)', () => {
    const ownership = validateLaneOwnership({
      engine: 'AGY',
      role: 'test',
      changedPaths: [
        'packages/tool-core/src/registry.ts',
        'scripts/automation/foresift-autopilot.mjs',
      ],
    });
    expect(ownership.ok).toBe(false);
    expect(ownership.violationCode).toBe('AGY_PRODUCT_OWNERSHIP_VIOLATION');
    expect(ownership.violatingPaths).toHaveLength(2);
  });

  it('healthy migration batches and final proof record exactly zero Codex and Claude calls', () => {
    const manifest = {
      schema: BUN_MIGRATION_MANIFEST_SCHEMA,
      files: [],
      batches: [
        { id: 'b1', engine: 'CODEMOD', state: 'VERIFIED', codexCalls: 0, claudeCalls: 0 },
        { id: 'b2', engine: 'AGY', state: 'VERIFIED', codexCalls: 0, claudeCalls: 0 },
      ],
    };
    for (const batch of manifest.batches) {
      expect(batch.codexCalls).toBe(0);
      expect(batch.claudeCalls).toBe(0);
    }
  });
});

// ── Contract 6: Affected-test selection from import graph ──
describe('Contract 6: Deterministic affected-test graph selection', () => {
  it('empty changed paths list escalates to FULL fail-closed', () => {
    const result = selectAffectedTests({
      root: REPO,
      changedPaths: [],
      allPaths: repositorySourcePaths(REPO),
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('FULL');
    expect(result.reason).toBe('ZERO_CHANGED_PATHS');
  });

  it('selects directly affected test files for known script dependencies', () => {
    const allPaths = repositorySourcePaths(REPO);
    const result = selectAffectedTests({
      root: REPO,
      changedPaths: ['scripts/automation/package-checkpoint.mjs'],
      allPaths,
    });
    expect(result.ok).toBe(true);
    expect(result.tests.length).toBeGreaterThan(0);
    expect(result.tests).toContain('tests/automation/v2-throughput.spec.ts');
  });

  it('deleted file with unknown package escalates to FULL fail-closed', () => {
    const result = selectAffectedTests({
      root: REPO,
      changedPaths: ['nonexistent/deleted/file.ts'],
      allPaths: repositorySourcePaths(REPO),
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('FULL');
    expect(result.reason).toMatch(/^DELETED_UNKNOWN:/);
  });

  it('unreferenced source file with zero matching tests fails closed (cannot false-green)', () => {
    const dir = mkdtempSync(join(scratch, 'unref-'));
    const unref = 'orphan.ts';
    writeFileSync(join(dir, unref), 'export const x = 1;\n');
    const result = selectAffectedTests({
      root: dir,
      changedPaths: [unref],
      allPaths: [unref],
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('FULL');
    expect(result.reason).toMatch(/^ZERO_MATCH_FAIL_CLOSED:/);
  });
});

// ── Contract 7: Bun test coordinator resource bounding ──
describe('Contract 7: Bun test coordinator concurrency and workload isolation', () => {
  const sampleManifest = {
    schema: BUN_MIGRATION_MANIFEST_SCHEMA,
    files: [
      { path: 'tests/unit1.spec.ts', workload: 'PURE', state: 'VERIFIED' },
      { path: 'tests/unit2.spec.ts', workload: 'PURE', state: 'VERIFIED' },
      { path: 'tests/proc.spec.ts', workload: 'PROCESS', state: 'VERIFIED' },
      { path: 'tests/db.spec.ts', workload: 'DATABASE_PGLITE', state: 'VERIFIED' },
      { path: 'tests/gate.spec.ts', workload: 'META_GATE', state: 'VERIFIED' },
    ],
  };

  it('builds plan with correct worker and concurrency bounds per workload category', () => {
    const plan = buildBunTestPlan(sampleManifest, DEFAULT_POLICY);
    expect(plan.length).toBe(4);

    const pure = plan.find((g) => g.workload === 'PURE');
    expect(pure?.fileWorkers).toBe(DEFAULT_POLICY.bunPureFileWorkers);
    expect(pure?.testConcurrency).toBe(DEFAULT_POLICY.bunPureTestConcurrency);
    expect(pure?.files).toEqual(['tests/unit1.spec.ts', 'tests/unit2.spec.ts']);

    const proc = plan.find((g) => g.workload === 'PROCESS');
    expect(proc?.fileWorkers).toBe(1);
    expect(proc?.testConcurrency).toBe(2);

    const db = plan.find((g) => g.workload === 'DATABASE_PGLITE');
    expect(db?.fileWorkers).toBe(DEFAULT_POLICY.bunHeavyFileWorkers);
    expect(db?.testConcurrency).toBe(DEFAULT_POLICY.bunHeavyTestConcurrency);
    expect(db?.files).toEqual(['tests/db.spec.ts']);

    const meta = plan.find((g) => g.workload === 'META_GATE');
    expect(meta?.fileWorkers).toBe(1);
    expect(meta?.testConcurrency).toBe(1);
    expect(meta?.files).toEqual(['tests/gate.spec.ts']);
  });

  it('generates standard Bun test CLI arguments with no-orphans and isolation', () => {
    const group = {
      id: 'pure-1',
      workload: 'PURE',
      files: ['tests/sample.spec.ts'],
      fileWorkers: 2,
      testConcurrency: 8,
    };
    const args = bunTestArgs(group, DEFAULT_POLICY);
    expect(args).toEqual([
      'test',
      '--no-orphans',
      '--isolate',
      '--parallel=2',
      '--max-concurrency=8',
      `--timeout=${DEFAULT_POLICY.testTimeoutMs}`,
      'tests/sample.spec.ts',
    ]);
  });

  it('refuses unmigrated requested paths fail-closed', () => {
    expect(() =>
      buildBunTestPlan(sampleManifest, DEFAULT_POLICY, ['tests/unmigrated.spec.ts']),
    ).toThrow(/BUN_TEST_UNMIGRATED_REQUEST/);
  });
});

// ── Contract 8: Execution profile routing and foundation concurrency ──
describe('Contract 8: CODEX_AGY execution profile routing and G0 concurrency', () => {
  it('G0 milestone enforces foundation concurrency = 1', () => {
    const roadmap = {
      policy: {
        foundationMilestones: ['G0'],
        maxParallelCodingPackagesFoundation: 1,
        maxParallelCodingPackages: 2,
        serialWhenRisk: ['CRITICAL'],
      },
    };
    const milestone = {
      milestoneId: 'G0',
      packages: [
        { id: 'g0-a', risk: 'HIGH', status: 'PENDING', writeScopes: ['packages/a/**'] },
        { id: 'g0-b', risk: 'HIGH', status: 'PENDING', writeScopes: ['packages/b/**'] },
      ],
    };
    const candidate = milestone.packages[1];
    const running = [milestone.packages[0]];
    const verdict = canStartPackage(
      roadmap as never,
      milestone as never,
      candidate as never,
      running as never,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/foundation/);
  });

  it('policy pins Bun version and test runtime settings', () => {
    expect(DEFAULT_POLICY.bunVersion).toBe('1.4.0');
    expect(DEFAULT_POLICY.productRuntime).toBe('node-24');
    expect(DEFAULT_POLICY.testTimeoutMs).toBe(30000);
  });
});

// ── Contract 9: Bun cutover verification and Vitest reference scan ──
describe('Contract 9: Cutover unverified refusal and Vitest reference detection', () => {
  it('refuses cutover when unverified test entries exist', () => {
    const fx = gitFixture('unverified-cutover-fx');
    const testFile = 'tests/unit.spec.ts';
    fx.writeFile(testFile, "import { it } from 'vitest';\nit('a', () => {});\n");
    const manifestFile = join(fx.root, 'unverified-manifest.json');
    writeFileSync(
      manifestFile,
      JSON.stringify({
        schema: BUN_MIGRATION_MANIFEST_SCHEMA,
        totalTestFiles: 1,
        files: [{ path: testFile, state: 'CODEMOD_READY' }],
      }),
    );
    expect(() => assertMigrationReady(fx.root, manifestFile)).toThrow(/BUN_CUTOVER_UNVERIFIED/);
  });

  it('activeVitestRuntimeReferences detects lingering vitest scripts or imports', () => {
    const fx = gitFixture('vitest-scan-fx');
    fx.writeFile('tests/sample.spec.ts', "import { it } from 'vitest';\nit('t', () => {});\n");
    fx.writeFile(
      'package.json',
      JSON.stringify({
        name: 'scan-test',
        scripts: { test: 'vitest run' },
        devDependencies: { vitest: '4.1.11' },
      }),
    );
    const refs = activeVitestRuntimeReferences(fx.root);
    expect(refs.some((r) => r.includes('package.json:dependency'))).toBe(true);
    expect(refs.some((r) => r.includes('package.json:scripts.test'))).toBe(true);
    expect(refs.some((r) => r.includes('tests/sample.spec.ts:test-runtime'))).toBe(true);
  });
});

// ── Contract 10: Node 24 runtime compatibility gate ──
describe('Contract 10: Node 24 runtime compatibility gate', () => {
  it('executes node-runtime-compat.mjs and validates all runtime surface checks', () => {
    const res = spawnSync('node', ['scripts/automation/node-runtime-compat.mjs'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.schema).toBe('foresift/node-runtime-compat@1');
    expect(parsed.passed).toBe(true);
    expect(parsed.checks.length).toBeGreaterThanOrEqual(7);
    const checkNames = parsed.checks.map((c: { name: string }) => c.name);
    expect(checkNames).toContain('node-major-24');
    expect(checkNames).toContain('buffer-roundtrip');
    expect(checkNames).toContain('crypto-sha256');
    expect(checkNames).toContain('crypto-random');
    expect(checkNames).toContain('node-stream');
    expect(checkNames).toContain('node-fs');
    expect(checkNames).toContain('node-esm-child-process');
    for (const check of parsed.checks) {
      expect(check.passed).toBe(true);
    }
  });
});
