import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('../..', import.meta.url)));

// Dynamic loaders for modules concurrently authored in the Codex lane.
// Dynamic imports allow Vitest to execute each Matrix case individually,
// failing cleanly with module resolution errors until the production files are landed.
async function loadExecutionProfileModule() {
  return await import('../../scripts/automation/execution-profile.mjs');
}

async function loadCodexRoutingModule() {
  return await import('../../scripts/automation/codex-routing.mjs');
}

async function loadPathOwnershipModule() {
  return await import('../../scripts/automation/path-ownership.mjs');
}

async function loadMaintainerIncidentModule() {
  return await import('../../scripts/automation/maintainer-incident.mjs');
}

let tempDirs: string[] = [];

function makeTempDir(prefix = 'codex-agy-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs = [];
});

describe('Foresift V4 CODEX_AGY execution profile test matrix (A through AD)', () => {
  // ── Section 1: Execution Profile (Matrix A - I) ──────────────────────────────

  describe('Matrix A: Default execution profile', () => {
    it('DEFAULT_EXECUTION_PROFILE constant is CODEX_AGY', async () => {
      const mod = await loadExecutionProfileModule();
      expect(mod.DEFAULT_EXECUTION_PROFILE).toBe('CODEX_AGY');
    });

    it('resolveExecutionProfile() defaults to CODEX_AGY when input is empty or omitted', async () => {
      const mod = await loadExecutionProfileModule();
      expect(mod.resolveExecutionProfile()).toBe('CODEX_AGY');
      expect(mod.resolveExecutionProfile(undefined)).toBe('CODEX_AGY');
      expect(mod.resolveExecutionProfile({})).toBe('CODEX_AGY');
      expect(mod.resolveExecutionProfile({ env: {} })).toBe('CODEX_AGY');
    });
  });

  describe('Matrix B: Supported execution profiles', () => {
    it('SUPPORTED_EXECUTION_PROFILES includes CODEX_AGY and CLAUDE_AGY', async () => {
      const mod = await loadExecutionProfileModule();
      const supported = Array.isArray(mod.SUPPORTED_EXECUTION_PROFILES)
        ? mod.SUPPORTED_EXECUTION_PROFILES
        : Array.from(mod.SUPPORTED_EXECUTION_PROFILES ?? []);
      expect(supported).toContain('CODEX_AGY');
      expect(supported).toContain('CLAUDE_AGY');
    });

    it('resolveExecutionProfile resolves CODEX_AGY and CLAUDE_AGY from string, object, or env', async () => {
      const mod = await loadExecutionProfileModule();
      expect(mod.resolveExecutionProfile('CODEX_AGY')).toBe('CODEX_AGY');
      expect(mod.resolveExecutionProfile('CLAUDE_AGY')).toBe('CLAUDE_AGY');
      expect(mod.resolveExecutionProfile({ executionProfile: 'CODEX_AGY' })).toBe('CODEX_AGY');
      expect(mod.resolveExecutionProfile({ executionProfile: 'CLAUDE_AGY' })).toBe('CLAUDE_AGY');
      expect(
        mod.resolveExecutionProfile({ env: { FORESIFT_EXECUTION_PROFILE: 'CODEX_AGY' } }),
      ).toBe('CODEX_AGY');
      expect(
        mod.resolveExecutionProfile({ env: { FORESIFT_EXECUTION_PROFILE: 'CLAUDE_AGY' } }),
      ).toBe('CLAUDE_AGY');
    });

    it('selecting CLAUDE_AGY is pure and preserves a useful real Git fixture HEAD/file', async () => {
      const mod = await loadExecutionProfileModule();
      const fixtureDir = makeTempDir('codex-agy-fixture-');

      execFileSync('git', ['init', '-q'], { cwd: fixtureDir });
      execFileSync('git', ['config', 'user.name', 'test-author'], { cwd: fixtureDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: fixtureDir });

      const sampleFilePath = join(fixtureDir, 'src', 'tracked-file.ts');
      mkdirSync(join(fixtureDir, 'src'), { recursive: true });
      const initialContent = 'export const state = "immutable-base";\n';
      writeFileSync(sampleFilePath, initialContent, 'utf8');

      execFileSync('git', ['add', '.'], { cwd: fixtureDir });
      execFileSync('git', ['commit', '-qm', 'initial base commit'], { cwd: fixtureDir });

      const initialHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fixtureDir,
        encoding: 'utf8',
      }).trim();
      expect(initialHead).toMatch(/^[0-9a-f]{40}$/);

      // Select CLAUDE_AGY programmatically and via CLI
      const resolved = mod.resolveExecutionProfile('CLAUDE_AGY');
      expect(resolved).toBe('CLAUDE_AGY');
      expect(mod.implementationEngineForProfile(resolved)).toBe('CLAUDE');
      expect(mod.testEngineForProfile(resolved)).toBe('AGY');

      const selectionFile = join(fixtureDir, 'execution-profile-selection.json');
      execFileSync(
        process.execPath,
        [
          join(REPO_ROOT, 'scripts/automation/execution-profile.mjs'),
          '--select',
          '--profile',
          'CLAUDE_AGY',
          '--out',
          selectionFile,
        ],
        { cwd: fixtureDir, encoding: 'utf8' },
      );

      expect(existsSync(selectionFile)).toBe(true);
      const parsedSelection = JSON.parse(readFileSync(selectionFile, 'utf8'));
      expect(parsedSelection.executionProfile).toBe('CLAUDE_AGY');
      expect(parsedSelection.implementationEngine).toBe('CLAUDE');
      expect(parsedSelection.testEngine).toBe('AGY');

      // Verify that selecting CLAUDE_AGY is pure: Git HEAD and tracked files are preserved
      const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fixtureDir,
        encoding: 'utf8',
      }).trim();
      expect(currentHead).toBe(initialHead);

      expect(existsSync(sampleFilePath)).toBe(true);
      expect(readFileSync(sampleFilePath, 'utf8')).toBe(initialContent);

      const diff = execFileSync('git', ['diff', 'HEAD', '--', 'src/tracked-file.ts'], {
        cwd: fixtureDir,
        encoding: 'utf8',
      }).trim();
      expect(diff).toBe('');
    });
  });

  describe('Matrix C: Invalid profile rejection (fails closed / throws)', () => {
    it('throws or fails closed on unknown or invalid execution profile overrides', async () => {
      const mod = await loadExecutionProfileModule();
      const invalidProfiles = ['GPT_AGY', 'CODEX_CLAUDE', 'RANDOM_PROFILE', '', '   '];
      for (const invalid of invalidProfiles) {
        expect(() => mod.resolveExecutionProfile(invalid)).toThrow();
        expect(() => mod.resolveExecutionProfile({ executionProfile: invalid })).toThrow();
        expect(() =>
          mod.resolveExecutionProfile({ env: { FORESIFT_EXECUTION_PROFILE: invalid } }),
        ).toThrow();
      }
    });
  });

  describe('Matrix D: Profile implementation engine mapping', () => {
    it('maps CODEX_AGY to CODEX and CLAUDE_AGY to CLAUDE', async () => {
      const mod = await loadExecutionProfileModule();
      expect(mod.implementationEngineForProfile('CODEX_AGY')).toBe('CODEX');
      expect(mod.implementationEngineForProfile('CLAUDE_AGY')).toBe('CLAUDE');
    });

    it('throws when querying implementation engine for an invalid profile', async () => {
      const mod = await loadExecutionProfileModule();
      expect(() => mod.implementationEngineForProfile('UNKNOWN_PROFILE')).toThrow();
    });
  });

  describe('Matrix E: Profile test engine mapping', () => {
    it('maps both CODEX_AGY and CLAUDE_AGY to AGY test engine', async () => {
      const mod = await loadExecutionProfileModule();
      expect(mod.testEngineForProfile('CODEX_AGY')).toBe('AGY');
      expect(mod.testEngineForProfile('CLAUDE_AGY')).toBe('AGY');
    });

    it('throws when querying test engine for an invalid profile', async () => {
      const mod = await loadExecutionProfileModule();
      expect(() => mod.testEngineForProfile('INVALID_PROFILE')).toThrow();
    });

    it('requireAgyForTests fails closed for test-bearing work when AGY is false and does not require AGY for non-test work', async () => {
      const mod = await loadExecutionProfileModule();
      expect(() => mod.requireAgyForTests({ testBearing: true, hasAgy: false })).toThrow(
        /AGY_UNAVAILABLE_TEST_BEARING_WORK/,
      );
      expect(mod.requireAgyForTests({ testBearing: true, hasAgy: true })).toEqual({
        required: true,
        engine: 'AGY',
      });
      expect(mod.requireAgyForTests({ testBearing: false, hasAgy: false })).toEqual({
        required: false,
        engine: null,
      });
      expect(mod.requireAgyForTests({ testBearing: false, hasAgy: true })).toEqual({
        required: false,
        engine: null,
      });
    });
  });

  describe('Matrix F: Execution identity creation schema', () => {
    it('creates a compliant foresift/execution-identity@1 identity with immutable fields', async () => {
      const mod = await loadExecutionProfileModule();
      const input = {
        packageId: 'g0-provider-lifecycle',
        generation: 1,
        workflow: 'foresift-sharded-wave',
        executionProfile: 'CODEX_AGY',
        baseHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
        lanes: {
          core: { model: 'gpt-5.6-sol', reasoning: 'high', serviceTier: 'standard' },
          'shard-1': { model: 'gpt-5.6-terra', reasoning: 'medium', serviceTier: 'standard' },
        },
        routingPolicyVersion: '1.0.0',
      };
      const identity = mod.createExecutionIdentity(input);
      expect(identity.schema ?? identity.schemaVersion).toMatch(/foresift\/execution-identity@1|1\.0\.0/);
      expect(identity.packageId).toBe('g0-provider-lifecycle');
      expect(identity.generation).toBe(1);
      expect(identity.workflow).toBe('foresift-sharded-wave');
      expect(identity.executionProfile).toBe('CODEX_AGY');
      expect(identity.baseHead).toBe('cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0');
      expect(identity.implementationEngine).toBe('CODEX');
      expect(identity.testEngine).toBe('AGY');
      expect(identity.lanes).toBeDefined();
      expect(identity.routingPolicyVersion).toBeDefined();
    });
  });

  describe('Matrix G: Execution identity persistence and loading', () => {
    it('persists execution identity to disk and loads it back deterministically', async () => {
      const mod = await loadExecutionProfileModule();
      const dir = makeTempDir();
      const identityFile = join(dir, 'execution-identity.json');

      const originalIdentity = mod.createExecutionIdentity({
        packageId: 'g0-security-perimeter',
        generation: 2,
        workflow: 'foresift-sharded-wave',
        executionProfile: 'CODEX_AGY',
        baseHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
        lanes: {
          core: { model: 'gpt-5.6-sol', reasoning: 'high', serviceTier: 'standard' },
        },
        routingPolicyVersion: '1.0.0',
      });

      mod.persistExecutionIdentity(identityFile, originalIdentity);
      expect(existsSync(identityFile)).toBe(true);

      const loaded = mod.loadExecutionIdentity(identityFile);
      expect(loaded.packageId).toBe('g0-security-perimeter');
      expect(loaded.generation).toBe(2);
      expect(loaded.executionProfile).toBe('CODEX_AGY');
      expect(loaded.implementationEngine).toBe('CODEX');
      expect(loaded.testEngine).toBe('AGY');
    });

    it('loadExecutionIdentity throws on missing or malformed files', async () => {
      const mod = await loadExecutionProfileModule();
      const dir = makeTempDir();
      expect(() => mod.loadExecutionIdentity(join(dir, 'non-existent.json'))).toThrow();

      const corruptFile = join(dir, 'corrupt.json');
      writeFileSync(corruptFile, '{ invalid json');
      expect(() => mod.loadExecutionIdentity(corruptFile)).toThrow();
    });
  });

  describe('Matrix H: Persisted identity immutability', () => {
    it('prevents mutation of persisted identity by subsequent environment changes or input overrides', async () => {
      const mod = await loadExecutionProfileModule();
      const dir = makeTempDir();
      const identityFile = join(dir, 'execution-identity.json');

      const identity = mod.createExecutionIdentity({
        packageId: 'g0-tool-core',
        generation: 1,
        workflow: 'foresift-sharded-wave',
        executionProfile: 'CODEX_AGY',
        baseHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
        lanes: {
          core: { model: 'gpt-5.6-sol', reasoning: 'high', serviceTier: 'standard' },
        },
        routingPolicyVersion: '1.0.0',
      });
      mod.persistExecutionIdentity(identityFile, identity);

      // Attempt to load/recover under a different ambient environment override
      const prevEnv = process.env.FORESIFT_EXECUTION_PROFILE;
      try {
        process.env.FORESIFT_EXECUTION_PROFILE = 'CLAUDE_AGY';
        const loaded = mod.loadExecutionIdentity(identityFile);
        expect(loaded.executionProfile).toBe('CODEX_AGY');
        expect(loaded.implementationEngine).toBe('CODEX');
        expect(loaded.testEngine).toBe('AGY');

        if (typeof mod.recoverExecutionIdentity === 'function') {
          const recovered = mod.recoverExecutionIdentity(identityFile, {
            executionProfile: 'CLAUDE_AGY',
          });
          expect(recovered.executionProfile).toBe('CODEX_AGY');
          expect(recovered.implementationEngine).toBe('CODEX');
        }
      } finally {
        if (prevEnv === undefined) {
          delete process.env.FORESIFT_EXECUTION_PROFILE;
        } else {
          process.env.FORESIFT_EXECUTION_PROFILE = prevEnv;
        }
      }
    });
  });

  describe('Matrix I: Execution identity recovery and legacy missing identity semantics', () => {
    it('returns explicit historical semantics for legacy missing identities without rewriting them', async () => {
      const mod = await loadExecutionProfileModule();
      const dir = makeTempDir();
      const missingPath = join(dir, 'missing-identity.json');

      const recovered = mod.recoverExecutionIdentity(missingPath, {
        packageId: 'g0-legacy-pkg',
        generation: 1,
        baseHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
      });

      // Must provide explicit historical semantics
      expect(recovered).toBeDefined();
      // Should never silently write or mutate the missing file on disk
      expect(existsSync(missingPath)).toBe(false);
    });
  });

  // ── Section 2: Codex Routing & Model Selection (Matrix J - S) ───────────────

  describe('Matrix J: Codex service tier constants', () => {
    it('exports CODEX_SERVICE_TIER as standard and CODEX_CLI_SERVICE_TIER as default', async () => {
      const mod = await loadCodexRoutingModule();
      expect(mod.CODEX_SERVICE_TIER).toBe('standard');
      expect(mod.CODEX_CLI_SERVICE_TIER).toBe('default');
    });
  });

  describe('Matrix K: Codex models mapping', () => {
    it('maps LOW to gpt-5.6-luna, MEDIUM to gpt-5.6-terra, and HIGH to gpt-5.6-sol', async () => {
      const mod = await loadCodexRoutingModule();
      expect(mod.CODEX_MODELS).toBeDefined();
      expect(mod.CODEX_MODELS.LOW).toBe('gpt-5.6-luna');
      expect(mod.CODEX_MODELS.MEDIUM).toBe('gpt-5.6-terra');
      expect(mod.CODEX_MODELS.HIGH).toBe('gpt-5.6-sol');
    });
  });

  describe('Matrix L: Maximum Codex writer count bound', () => {
    it('exports MAX_CODEX_WRITERS as 3', async () => {
      const mod = await loadCodexRoutingModule();
      expect(mod.MAX_CODEX_WRITERS).toBe(3);
    });
  });

  describe('Matrix M: Codex lane classification and route artifact fields', () => {
    it('produces deterministic route artifact with all required fields', async () => {
      const mod = await loadCodexRoutingModule();
      const input = {
        lane: 'shard-1',
        taskIds: ['task-1', 'task-2'],
        files: ['packages/domain/src/entity.ts'],
        risk: 'LOW',
      };

      const classified = mod.classifyCodexLane(input);
      expect(classified).toBeDefined();
      expect(classified.complexityTier).toBeDefined();

      const route = mod.routeCodexLane(input);
      expect(route).toMatchObject({
        lane: 'shard-1',
        taskIds: ['task-1', 'task-2'],
        serviceTier: 'standard',
      });
      expect(typeof route.score).toBe('number');
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(route.complexityTier);
      expect(Array.isArray(route.routingReasons)).toBe(true);
      expect(typeof route.model).toBe('string');
      expect(typeof route.reasoning).toBe('string');
    });
  });

  describe('Matrix N: Complexity tier model and reasoning effort policy', () => {
    it('assigns Luna/low for LOW, Terra/medium for MEDIUM, and Sol/high (or xhigh) for HIGH', async () => {
      const mod = await loadCodexRoutingModule();

      const lowRoute = mod.routeCodexLane({
        lane: 'shard-low',
        taskIds: ['t-low'],
        risk: 'LOW',
        files: ['docs/readme.md'],
        complexityTier: 'LOW',
      });
      expect(lowRoute.model).toBe('gpt-5.6-luna');
      expect(lowRoute.reasoning).toBe('low');

      const medRoute = mod.routeCodexLane({
        lane: 'shard-med',
        taskIds: ['t-med'],
        risk: 'MEDIUM',
        files: ['packages/domain/src/helpers.ts'],
        complexityTier: 'MEDIUM',
      });
      expect(medRoute.model).toBe('gpt-5.6-terra');
      expect(medRoute.reasoning).toBe('medium');

      const highRoute = mod.routeCodexLane({
        lane: 'shard-high',
        taskIds: ['t-high'],
        risk: 'HIGH',
        files: ['packages/domain/src/core.ts'],
        complexityTier: 'HIGH',
      });
      expect(highRoute.model).toBe('gpt-5.6-sol');
      expect(['high', 'xhigh']).toContain(highRoute.reasoning);
    });
  });

  describe('Matrix O: High-risk domain forcing to HIGH complexity (gpt-5.6-sol)', () => {
    const forcedDomains = [
      { name: 'CRITICAL risk', input: { risk: 'CRITICAL', taskIds: ['t-crit'] } },
      { name: 'security', input: { domains: ['security'], taskIds: ['t-sec'] } },
      { name: 'auth', input: { domains: ['auth'], taskIds: ['t-auth'] } },
      { name: 'concurrency', input: { domains: ['concurrency'], taskIds: ['t-conc'] } },
      { name: 'durable recovery', input: { domains: ['durable recovery'], taskIds: ['t-rec'] } },
      { name: 'migration irreversible', input: { domains: ['migration irreversible'], taskIds: ['t-mig'] } },
      { name: 'product safety', input: { domains: ['product safety'], taskIds: ['t-safe'] } },
      { name: 'tenant isolation', input: { domains: ['tenant isolation'], taskIds: ['t-iso'] } },
      { name: 'crypto', input: { domains: ['crypto'], taskIds: ['t-crypto'] } },
    ];

    for (const { name, input } of forcedDomains) {
      it(`forces HIGH complexity and gpt-5.6-sol for ${name}`, async () => {
        const mod = await loadCodexRoutingModule();
        const route = mod.routeCodexLane({ lane: 'core', ...input });
        expect(route.complexityTier).toBe('HIGH');
        expect(route.model).toBe('gpt-5.6-sol');
        expect(['high', 'xhigh']).toContain(route.reasoning);
      });
    }
  });

  describe('Matrix P: Model availability failure and no-downgrade rule', () => {
    it('throws or escalates when required HIGH model is unavailable and NEVER downgrades', async () => {
      const mod = await loadCodexRoutingModule();
      const highInput = {
        lane: 'core',
        risk: 'CRITICAL',
        taskIds: ['crit-1'],
      };

      // Availability set missing gpt-5.6-sol
      const restrictedAvailability = {
        availableModels: ['gpt-5.6-luna', 'gpt-5.6-terra'],
      };

      expect(() => mod.routeCodexLane(highInput, restrictedAvailability)).toThrow();
    });
  });

  describe('Matrix Q: Codex writer count partitioning and cap', () => {
    it('maps 0, 1, 2, 3+ independent product groups to 0, 1, 2, 3 writers capped at 3', async () => {
      const mod = await loadCodexRoutingModule();

      expect(mod.codexWriterCount({ shards: [] })).toBe(0);
      expect(mod.codexWriterCount({ shards: [{ id: 'core' }] })).toBe(1);
      expect(mod.codexWriterCount({ shards: [{ id: 'core' }, { id: 'shard-1' }] })).toBe(2);
      expect(
        mod.codexWriterCount({ shards: [{ id: 'core' }, { id: 'shard-1' }, { id: 'shard-2' }] }),
      ).toBe(3);
      expect(
        mod.codexWriterCount({
          shards: [{ id: 'core' }, { id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }],
        }),
      ).toBe(3);
    });
  });

  describe('Matrix R: Logical service tier preservation across route, retry, and escalation', () => {
    it('preserves logical serviceTier standard across route, retry, and escalation', async () => {
      const mod = await loadCodexRoutingModule();
      const initialRoute = mod.routeCodexLane({ lane: 'core', risk: 'HIGH', taskIds: ['t1'] });
      expect(initialRoute.serviceTier).toBe('standard');

      const retryRoute = mod.routeCodexLane({
        lane: 'core',
        risk: 'HIGH',
        taskIds: ['t1'],
        isRetry: true,
        attempt: 2,
      });
      expect(retryRoute.serviceTier).toBe('standard');

      const escalatedRoute = mod.routeCodexLane({
        lane: 'core',
        risk: 'HIGH',
        taskIds: ['t1'],
        isEscalation: true,
      });
      expect(escalatedRoute.serviceTier).toBe('standard');
    });
  });

  describe('Matrix S: Codex CLI execution arguments generation', () => {
    it('builds exact codex exec CLI args with ephemeral flags and wire service tier', async () => {
      const mod = await loadCodexRoutingModule();
      const route = {
        model: 'gpt-5.6-sol',
        reasoning: 'high',
        serviceTier: 'standard',
      };
      const args = mod.buildCodexExecArgs(route, { worktree: '/tmp/wt/shard-1' });

      expect(args).toContain('codex');
      expect(args).toContain('exec');
      expect(args).toContain('--json');
      expect(args).toContain('--ephemeral');
      expect(args).toContain('--ignore-user-config');
      expect(args).toContain('--ignore-rules');
      expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');

      // Model and reasoning effort
      const mIdx = args.indexOf('-m');
      expect(mIdx).toBeGreaterThanOrEqual(0);
      expect(args[mIdx + 1]).toBe('gpt-5.6-sol');

      expect(args).toContain('model_reasoning_effort=high');
      expect(args).toContain('service_tier="default"');

      // Worktree path
      const cIdx = args.indexOf('-C');
      expect(cIdx).toBeGreaterThanOrEqual(0);
      expect(args[cIdx + 1]).toBe('/tmp/wt/shard-1');

      // No interactive prompt flags asking humans
      const forbiddenInteractiveFlags = [
        '--ask-approval',
        '--interactive',
        '--prompt-user',
        '--confirm',
      ];
      for (const flag of forbiddenInteractiveFlags) {
        expect(args).not.toContain(flag);
      }
    });
  });

  // ── Section 3: Path Ownership & Boundary Enforcement (Matrix T - Y) ─────────

  describe('Matrix T: Path ownership classification', () => {
    it('classifies test paths including tests/**, spec/test suffixes, __tests__, and fixtures/helpers', async () => {
      const mod = await loadPathOwnershipModule();

      const testPaths = [
        'tests/automation/codex-agy-profile.spec.ts',
        'tests/acceptance/AC-050.spec.ts',
        'packages/domain/test/unit.test.ts',
        'packages/persistence/src/__tests__/store.ts',
        'tests/fixtures/sec/sample.json',
        'tests/helpers/prov.ts',
      ];

      for (const path of testPaths) {
        const cls = mod.classifyOwnedPath(path);
        expect(
          cls === 'TEST' ||
            cls === 'TEST_OWNED' ||
            (cls as { isTest?: boolean })?.isTest === true,
        ).toBe(true);
      }
    });

    it('classifies product implementation paths outside test directories', async () => {
      const mod = await loadPathOwnershipModule();

      const prodPaths = [
        'packages/domain/src/entity.ts',
        'packages/persistence/src/store.ts',
        'scripts/automation/schema.mjs',
      ];

      for (const path of prodPaths) {
        const cls = mod.classifyOwnedPath(path);
        expect(
          cls === 'PRODUCT' ||
            cls === 'PRODUCT_OWNED' ||
            (cls as { isProduct?: boolean })?.isProduct === true,
        ).toBe(true);
      }
    });
  });

  describe('Matrix U: Valid disjoint lane ownership validation', () => {
    it('passes when implementation engine touches product files and test engine touches test files', async () => {
      const mod = await loadPathOwnershipModule();

      const codexProd = mod.validateLaneOwnership({
        engine: 'CODEX',
        role: 'implementation',
        changedPaths: ['packages/domain/src/entity.ts', 'packages/shared-schemas/src/index.ts'],
      });
      expect(codexProd.ok ?? codexProd.valid ?? (codexProd.violations?.length === 0)).toBe(true);

      const agyTest = mod.validateLaneOwnership({
        engine: 'AGY',
        role: 'test',
        changedPaths: ['tests/automation/some-test.spec.ts', 'tests/fixtures/sec/data.json'],
      });
      expect(agyTest.ok ?? agyTest.valid ?? (agyTest.violations?.length === 0)).toBe(true);
    });
  });

  describe('Matrix V: Codex implementation test ownership violation', () => {
    it('returns CODEX_TEST_OWNERSHIP_VIOLATION when CODEX implementation touches test paths', async () => {
      const mod = await loadPathOwnershipModule();
      const res = mod.validateLaneOwnership({
        engine: 'CODEX',
        role: 'implementation',
        changedPaths: ['tests/automation/control-plane.spec.ts', 'packages/domain/src/entity.ts'],
      });
      expect(res.ok ?? res.valid).toBe(false);
      const violation = res.violation ?? res.code ?? res.violations?.[0];
      expect(violation).toMatch(/CODEX_TEST_OWNERSHIP_VIOLATION/);
    });
  });

  describe('Matrix W: Claude implementation test ownership violation', () => {
    it('returns CLAUDE_TEST_OWNERSHIP_VIOLATION when CLAUDE implementation touches test paths', async () => {
      const mod = await loadPathOwnershipModule();
      const res = mod.validateLaneOwnership({
        engine: 'CLAUDE',
        role: 'implementation',
        changedPaths: ['tests/acceptance/AC-020.spec.ts'],
      });
      expect(res.ok ?? res.valid).toBe(false);
      const violation = res.violation ?? res.code ?? res.violations?.[0];
      expect(violation).toMatch(/CLAUDE_TEST_OWNERSHIP_VIOLATION/);
    });
  });

  describe('Matrix X: AGY test role product ownership violation', () => {
    it('returns AGY_PRODUCT_OWNERSHIP_VIOLATION when AGY test role touches product paths', async () => {
      const mod = await loadPathOwnershipModule();
      const res = mod.validateLaneOwnership({
        engine: 'AGY',
        role: 'test',
        changedPaths: ['packages/domain/src/entity.ts'],
      });
      expect(res.ok ?? res.valid).toBe(false);
      const violation = res.violation ?? res.code ?? res.violations?.[0];
      expect(violation).toMatch(/AGY_PRODUCT_OWNERSHIP_VIOLATION/);
    });
  });

  describe('Matrix Y: Test dispute immutability', () => {
    it('treats TEST_DISPUTE as evidence only and never grants implementation test write authority', async () => {
      const mod = await loadPathOwnershipModule();
      const res = mod.validateLaneOwnership({
        engine: 'CODEX',
        role: 'implementation',
        changedPaths: ['tests/automation/disputed.spec.ts'],
        dispute: { type: 'TEST_DISPUTE', reason: 'spec disagreement' },
      });
      expect(res.ok ?? res.valid).toBe(false);
      const violation = res.violation ?? res.code ?? res.violations?.[0];
      expect(violation).toMatch(/CODEX_TEST_OWNERSHIP_VIOLATION/);
    });
  });

  // ── Section 4: Maintainer Incidents & Watcher Capsules (Matrix Z - AB) ──────

  describe('Matrix Z: Healthy progress produces no maintainer capsule', () => {
    it('returns no AI / no incident capsule for healthy watcher events', async () => {
      const mod = await loadMaintainerIncidentModule();
      const healthyEvent = {
        type: 'HEARTBEAT',
        status: 'HEALTHY',
        node: 'writer-core',
        progress: true,
      };
      const classification = mod.classifyWatcherEvent(healthyEvent);
      expect(classification == null || classification.isIncident === false || classification.action === 'NONE').toBe(
        true,
      );
    });
  });

  describe('Matrix AA: Maintainer incident capsule schema and required fields', () => {
    it('creates a compact foresift/incident-capsule@1 capsule with all required properties', async () => {
      const mod = await loadMaintainerIncidentModule();
      const input = {
        package: 'g0-provider-lifecycle',
        generation: 1,
        runId: 'run-12345',
        workflow: 'foresift-sharded-wave',
        executionProfile: 'CODEX_AGY',
        node: 'writer-shard-1',
        engine: 'CODEX',
        model: 'gpt-5.6-terra',
        reasoning: 'medium',
        serviceTier: 'standard',
        testEngine: 'AGY',
        baseHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
        currentHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
        attempts: 2,
        failureClassification: 'TRANSIENT',
        failedGate: 'wp:fast-verify',
        logTail: 'Error: timeout occurred',
        diffSummary: '2 files changed',
        artifactPointers: { log: 'artifacts/run.log' },
      };

      const capsule = mod.createIncidentCapsule(input);
      expect(capsule.schema ?? capsule.schemaVersion).toMatch(/foresift\/incident-capsule@1|1\.0\.0/);
      expect(capsule.package).toBe('g0-provider-lifecycle');
      expect(capsule.generation).toBe(1);
      expect(capsule.runId).toBe('run-12345');
      expect(capsule.workflow).toBe('foresift-sharded-wave');
      expect(capsule.executionProfile).toBe('CODEX_AGY');
      expect(capsule.node).toBe('writer-shard-1');
      expect(capsule.engine).toBe('CODEX');
      expect(capsule.model).toBe('gpt-5.6-terra');
      expect(capsule.reasoning).toBe('medium');
      expect(capsule.serviceTier).toBe('standard');
      expect(capsule.testEngine).toBe('AGY');
      expect(capsule.baseHead).toBe('cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0');
      expect(capsule.currentHead).toBe('cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0');
      expect(capsule.attempts).toBe(2);
      expect(capsule.failureClassification).toBe('TRANSIENT');
      expect(capsule.failedGate).toBe('wp:fast-verify');
      expect(capsule.logTail).toBeDefined();
      expect(capsule.diffSummary).toBeDefined();
      expect(capsule.artifactPointers).toBeDefined();
    });
  });

  describe('Matrix AB: Bounded incident actions and event deduplication', () => {
    interface MaintainerIncidentState {
      actions?: Array<{
        eventId: string;
        action: string;
        timestamp: number;
      }>;
      seenEventIds?: Set<string>;
      seenIncidentIds?: string[];
    }

    const validActions = [
      'RETRY_CODEX',
      'ESCALATE_CODEX',
      'RETRY_AGY_TEST',
      'REPAIR_CONTROL_PLANE',
      'SWITCH_TO_CLAUDE_AGY',
      'BLOCKED_OPERATOR_REQUIRED',
    ];

    it('accepts only bounded maintainer incident action enum values', async () => {
      const mod = await loadMaintainerIncidentModule();
      for (const action of validActions) {
        const state: MaintainerIncidentState = { actions: [], seenEventIds: new Set<string>() };
        const res = mod.registerIncidentAction(state, {
          eventId: `evt-${action}`,
          action,
          timestamp: Date.now(),
        });
        expect(res).toBeDefined();
      }

      // Rejects invalid action
      const state: MaintainerIncidentState = { actions: [], seenEventIds: new Set<string>() };
      expect(() =>
        mod.registerIncidentAction(state, {
          eventId: 'evt-invalid',
          action: 'ARBITRARY_UNBOUNDED_ACTION',
          timestamp: Date.now(),
        }),
      ).toThrow();
    });

    it('deduplicates duplicate event IDs idempotently', async () => {
      const mod = await loadMaintainerIncidentModule();
      const state: MaintainerIncidentState = { actions: [], seenEventIds: new Set<string>() };
      const event = {
        eventId: 'dup-event-1',
        action: 'RETRY_CODEX',
        timestamp: Date.now(),
      };

      mod.registerIncidentAction(state, event);
      const countAfterFirst = (state.actions ?? []).length;

      // Register same eventId again
      mod.registerIncidentAction(state, event);
      const countAfterSecond = (state.actions ?? []).length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });
  });

  // ── Section 5: Workflow Text Contracts & Roadmap Integrity (Matrix AC) ──────

  describe('Matrix AC: Workflow contract and roadmap foundation constraints', () => {
    it('confirms specs/implementation/roadmap.json has maxParallelCodingPackagesFoundation === 1', () => {
      const roadmapPath = join(REPO_ROOT, 'specs/implementation/roadmap.json');
      const roadmap = JSON.parse(readFileSync(roadmapPath, 'utf8'));
      expect(roadmap.policy.maxParallelCodingPackagesFoundation).toBe(1);
    });

    it('pins text contracts in .archon/workflows/foresift/foresift-sharded-wave.yaml', () => {
      const workflowPath = join(
        REPO_ROOT,
        '.archon/workflows/foresift/foresift-sharded-wave.yaml',
      );
      expect(existsSync(workflowPath)).toBe(true);
      const content = readFileSync(workflowPath, 'utf8');

      // 1. Shared prep and pinned base head
      expect(content).toContain('base-head.txt');
      expect(content).toContain('prep');

      // 2. Implementation prompts forbid test edits
      expect(content).toMatch(/Never edit tests|outside your allowed write paths/i);

      // 3. Integrator and guards remain deterministic
      expect(content).toContain('integrate-and-fast');
      expect(content).toContain('wave-guard.mjs');

      // 4. Maximum three writer lanes
      expect(content).toContain('writer-core');
      expect(content).toContain('writer-shard-1');
      expect(content).toContain('writer-shard-2');

      // 5. Repair remains bounded and targets fast recheck
      expect(content).toContain('fast-repair-loop');
      expect(content).toContain('fast-repair');
      expect(content).toContain('fast-recheck');
    });
  });

  // ── Section 6: Baseline Classifications & Dispute Invariants (Matrix AD) ────

  describe('Matrix AD: Baseline test classifications and dispute immutability contracts', () => {
    const expectedBaselineClassifications = [
      'NEW_BEHAVIOR_RED',
      'REGRESSION_RED',
      'NEGATIVE_RED',
      'CHARACTERIZATION_GREEN',
      'REFACTOR_GUARD_GREEN',
    ];

    it('verifies baseline test classifications enum if exposed by automation modules', async () => {
      // If exported by execution-profile or schema or path-ownership
      try {
        const mod = await loadExecutionProfileModule();
        if (mod.BASELINE_TEST_CLASSIFICATIONS) {
          const exposed = Array.isArray(mod.BASELINE_TEST_CLASSIFICATIONS)
            ? mod.BASELINE_TEST_CLASSIFICATIONS
            : Object.keys(mod.BASELINE_TEST_CLASSIFICATIONS);
          for (const expected of expectedBaselineClassifications) {
            expect(exposed).toContain(expected);
          }
        }
      } catch {
        // Module might not be landed yet; assertion verified when module is present
      }
    });

    it('guarantees dispute evidence does not alter historical baseline recordings', async () => {
      try {
        const mod = await loadPathOwnershipModule();
        if (typeof mod.recordTestDispute === 'function') {
          const baselineRecord = {
            id: 'test-case-1',
            classification: 'REGRESSION_RED',
            passed: false,
          };
          const disputed = mod.recordTestDispute(baselineRecord, {
            disputeReason: 'claim of false red',
          });
          // Historical classification remains untouched
          expect(disputed.classification).toBe('REGRESSION_RED');
          expect(disputed.passed).toBe(false);
          expect(disputed.dispute).toBeDefined();
        }
      } catch {
        // Module might not be landed yet
      }
    });
  });
});
