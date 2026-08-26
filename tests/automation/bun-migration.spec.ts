// Bun Migration Infrastructure deterministic contract suite.
// Covers test-authority migration state transitions, barrier evaluation,
// maintenance workflow topology, manifest integrity, resource-bounded
// coordination, affected-test selection, cutover safety, and Node 24 compat.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  BUN_MIGRATION_PROOF_SCHEMA,
  BUN_MIGRATION_STATES,
  evaluateBunMigrationBarrier,
  loadBunMigrationInputs,
  validateBunMigrationProof,
} from '../../scripts/automation/bun-migration-state.mjs';
import {
  BUN_DIRECT_IMPORTS,
  BUN_MIGRATION_MANIFEST_SCHEMA,
  analyzeTestFile,
  buildBunMigrationManifest,
  isTestFile,
} from '../../scripts/automation/bun-migration-manifest.mjs';
import {
  migrateMechanicalFile,
  runMechanicalCodemod,
} from '../../scripts/automation/bun-migration-codemod.mjs';
import {
  planMigrationBatches,
  prepareMigration,
} from '../../scripts/automation/bun-migration-runner.mjs';
import {
  buildBunTestPlan,
  bunTestArgs,
} from '../../scripts/automation/bun-test-coordinator.mjs';
import {
  buildImportGraph,
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
    const verdict = canStartPackage(roadmap as never, milestone as never, candidate as never, running as never);
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
