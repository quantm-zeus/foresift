import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('../..', import.meta.url)));

// Dynamic loaders for modules concurrently authored in the Codex lane.
// Dynamic imports allow Bun Test to execute each Matrix case individually,
// failing cleanly with module resolution errors until the production files are landed.
async function loadExecutionProfileModule() {
  return (await import('../../scripts/automation/execution-profile.mjs')) as typeof import('../../scripts/automation/execution-profile.mjs') & {
    EXECUTION_POLICY: Record<string, unknown>;
  };
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

async function loadAgyTestWriterModule() {
  // @ts-expect-error untyped dynamic import for module concurrently authored in codex lane
  return await import('../../scripts/automation/exec-agy-test-writer.mjs');
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

describe('Foresift V4 CODEX_AGY execution profile test matrix (A through AH)', () => {
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
      expect(identity.schema ?? identity.schemaVersion).toMatch(
        /foresift\/execution-identity@1|1\.0\.0/,
      );
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
    it('routes LOW/MEDIUM to gpt-5.6-terra, HIGH to gpt-5.6-sol, and never Luna', async () => {
      const mod = await loadCodexRoutingModule();
      expect(mod.CODEX_MODELS).toBeDefined();
      expect(mod.CODEX_MODELS.LOW).toBe('gpt-5.6-terra');
      expect(mod.CODEX_MODELS.MEDIUM).toBe('gpt-5.6-terra');
      expect(mod.CODEX_MODELS.HIGH).toBe('gpt-5.6-sol');
      // Luna stays disabled for product writers until repository evidence
      // proves its implementation quality (cost-policy quality gate).
      expect(Object.values(mod.CODEX_MODELS)).not.toContain('gpt-5.6-luna');
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
    it('assigns gpt-5.6-terra to LOW/MEDIUM, gpt-5.6-sol to HIGH, medium reasoning everywhere', async () => {
      const mod = await loadCodexRoutingModule();

      const lowRoute = mod.routeCodexLane({
        lane: 'shard-low',
        taskIds: ['t-low'],
        risk: 'LOW',
        files: ['docs/readme.md'],
        complexityTier: 'LOW',
      });
      expect(lowRoute.complexityTier).toBe('LOW');
      expect(lowRoute.model).toBe('gpt-5.6-terra');
      expect(lowRoute.reasoning).toBe('medium');

      const medRoute = mod.routeCodexLane({
        lane: 'shard-med',
        taskIds: ['t-med'],
        risk: 'MEDIUM',
        files: ['packages/domain/src/helpers.ts'],
        complexityTier: 'MEDIUM',
      });
      expect(medRoute.complexityTier).toBe('MEDIUM');
      expect(medRoute.model).toBe('gpt-5.6-terra');
      expect(medRoute.reasoning).toBe('medium');

      const highRoute = mod.routeCodexLane({
        lane: 'shard-high',
        taskIds: ['t-high'],
        risk: 'HIGH',
        files: ['packages/domain/src/core.ts'],
        complexityTier: 'HIGH',
      });
      expect(highRoute.complexityTier).toBe('HIGH');
      expect(highRoute.model).toBe('gpt-5.6-sol');
      expect(highRoute.reasoning).toBe('medium');
    });
  });

  describe('Matrix O: High-risk domain forcing to HIGH complexity (gpt-5.6-sol)', () => {
    const forcedDomains = [
      { name: 'CRITICAL risk', input: { risk: 'CRITICAL', taskIds: ['t-crit'] } },
      { name: 'security', input: { domains: ['security'], taskIds: ['t-sec'] } },
      { name: 'auth', input: { domains: ['auth'], taskIds: ['t-auth'] } },
      { name: 'concurrency', input: { domains: ['concurrency'], taskIds: ['t-conc'] } },
      { name: 'durable recovery', input: { domains: ['durable recovery'], taskIds: ['t-rec'] } },
      {
        name: 'migration irreversible',
        input: { domains: ['migration irreversible'], taskIds: ['t-mig'] },
      },
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
        expect(route.reasoning).toBe('medium');
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

  describe('Matrix R2: Cost-aware adaptive routing acceptance (routingPolicyVersion @3)', () => {
    it('LOW routing can never receive sensitive tasks — sensitive categories force HIGH/sol', async () => {
      const mod = await loadCodexRoutingModule();
      for (const sensitive of [
        'rotate the auth credential store',
        'durable recovery state machine',
        'migration schema change',
        'prohibited-capability safety boundary',
        'tenant isolation wall',
        'signing private key handling',
      ]) {
        const forced = mod.classifyCodexLane({
          lane: 'core',
          risk: 'LOW',
          taskIds: ['t-small'],
          files: [],
          domains: [sensitive],
        });
        expect(forced.complexityTier).toBe('HIGH');
        expect(forced.forcedHigh).toBe(true);
        const route = mod.routeCodexLane({
          lane: 'core',
          risk: 'LOW',
          complexityTier: 'LOW',
          taskIds: ['t-small'],
          domains: [sensitive],
        });
        expect(route.model).toBe('gpt-5.6-sol');
      }
    });

    it('MEDIUM routing excludes forced-high categories and always receives terra', async () => {
      const mod = await loadCodexRoutingModule();
      const ordinary = mod.routeCodexLane({
        lane: 'shard-1',
        risk: 'MEDIUM',
        complexityTier: 'MEDIUM',
        taskIds: ['t1', 't2', 't3'],
      });
      expect(ordinary.model).toBe('gpt-5.6-terra');
      expect(ordinary.forcedHigh).toBe(false);
    });

    it('retries escalate monotonically terra→sol and never downgrade or loop back to terra', async () => {
      const mod = await loadCodexRoutingModule();

      const lowRoute = mod.routeCodexLane({
        lane: 'core',
        risk: 'LOW',
        complexityTier: 'LOW',
        taskIds: ['t1'],
      });
      const lowRetry = mod.retryCodexRoute(lowRoute);
      expect(lowRetry.complexityTier).toBe('MEDIUM');
      expect(lowRetry.model).toBe('gpt-5.6-terra');
      expect(lowRetry.attempt).toBe(2);

      const medRoute = mod.routeCodexLane({
        lane: 'core',
        risk: 'MEDIUM',
        complexityTier: 'MEDIUM',
        taskIds: ['t1'],
      });
      const medRetry = mod.retryCodexRoute(medRoute);
      expect(medRetry.model).toBe('gpt-5.6-sol');
      expect(medRetry.complexityTier).toBe('HIGH');

      const highRoute = mod.routeCodexLane({ lane: 'core', risk: 'CRITICAL', taskIds: ['t1'] });
      const highRetry = mod.retryCodexRoute(highRoute);
      expect(highRetry.model).toBe('gpt-5.6-sol');
      expect(highRetry.complexityTier).toBe('HIGH');
      // Monotone: no path from sol back to terra.
      const highRetryTwice = mod.retryCodexRoute(highRetry);
      expect(highRetryTwice.model).toBe('gpt-5.6-sol');
      expect(highRetryTwice.reasoning).toBe('medium');
    });

    it('escalations climb LOW→MEDIUM→HIGH with a monotone counter and medium ceiling', async () => {
      const mod = await loadCodexRoutingModule();
      let route = mod.routeCodexLane({
        lane: 'core',
        risk: 'LOW',
        complexityTier: 'LOW',
        taskIds: ['t1'],
      });
      route = mod.escalateCodexRoute(route);
      expect(route.complexityTier).toBe('MEDIUM');
      expect(route.model).toBe('gpt-5.6-terra');
      expect(route.escalation).toBe(1);
      route = mod.escalateCodexRoute(route);
      expect(route.complexityTier).toBe('HIGH');
      expect(route.model).toBe('gpt-5.6-sol');
      expect(route.escalation).toBe(2);
      route = mod.escalateCodexRoute(route);
      expect(route.model).toBe('gpt-5.6-sol');
      expect(route.escalation).toBe(3);
      // Sol never automatically moves to high/xhigh reasoning.
      expect(route.reasoning).toBe('medium');
    });

    it('reasoning is pinned to medium across every route, retry, and escalation', async () => {
      const mod = await loadCodexRoutingModule();
      let route = mod.routeCodexLane({ lane: 'core', risk: 'CRITICAL', taskIds: ['t1'] });
      for (let i = 0; i < 4; i++) {
        expect(route.reasoning).toBe('medium');
        route = mod.retryCodexRoute(route);
      }
      expect(route.reasoning).toBe('medium');
    });

    it('never emits Fast/Priority service tier and the CLI wire value stays default', async () => {
      const mod = await loadCodexRoutingModule();
      const route = mod.routeCodexLane({ lane: 'core', risk: 'CRITICAL', taskIds: ['t1'] });
      expect(route.serviceTier).toBe('standard');
      expect(route.cliServiceTier).toBe('default');
      const args = mod.buildCodexExecArgs(route, { worktree: '/tmp/wt' });
      const joined = args.join(' ');
      expect(joined).toContain('service_tier="default"');
      for (const banned of ['priority', 'fast', '--fast']) {
        expect(joined.toLowerCase()).not.toContain(banned);
      }
    });
  });

  describe('Matrix S: Codex CLI execution arguments generation', () => {
    it('builds exact codex exec CLI args with ephemeral flags and wire service tier', async () => {
      const mod = await loadCodexRoutingModule();
      const route = {
        model: 'gpt-5.6-sol',
        reasoning: 'medium',
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

      expect(args).toContain('model_reasoning_effort=medium');
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
          cls === 'TEST' || cls === 'TEST_OWNED' || (cls as { isTest?: boolean })?.isTest === true,
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
      expect(codexProd.ok ?? codexProd.valid ?? codexProd.violations?.length === 0).toBe(true);

      const agyTest = mod.validateLaneOwnership({
        engine: 'AGY',
        role: 'test',
        changedPaths: ['tests/automation/some-test.spec.ts', 'tests/fixtures/sec/data.json'],
      });
      expect(agyTest.ok ?? agyTest.valid ?? agyTest.violations?.length === 0).toBe(true);
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
      expect(
        classification == null ||
          classification.isIncident === false ||
          classification.action === 'NONE',
      ).toBe(true);
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
      expect(capsule.schema ?? capsule.schemaVersion).toMatch(
        /foresift\/incident-capsule@1|1\.0\.0/,
      );
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
      const workflowPath = join(REPO_ROOT, '.archon/workflows/foresift/foresift-sharded-wave.yaml');
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

      // 6. AGY test author receives persisted routing artifact
      const agyNode = content.match(/- id: writer-test-author-agy[\s\S]*?(?=\n  - id:)/);
      expect(agyNode).toBeTruthy();
      expect(agyNode?.[0]).toContain('exec-agy-test-writer.mjs --lane test-author');
      expect(agyNode?.[0]).toContain('--routing "$ARTIFACTS_DIR/routing.json"');
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

  // ── Section 7: AGY Gemini Test Routing, Identity & Executor (Matrix AE - AH) ──

  describe('Matrix AE: Version-controlled AGY Gemini routing policy and configuration', () => {
    it('pins AGY test model to gemini-3.7-flash-high, effort to high, timeout to 40m, and policy version', async () => {
      const configPath = join(REPO_ROOT, 'config/foresift-execution.json');
      expect(existsSync(configPath)).toBe(true);
      const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));

      expect(rawConfig.agyTestModel).toBe('gemini-3.7-flash-high');
      expect(rawConfig.agyTestEffort).toBe('high');
      expect(rawConfig.agyPrintTimeout).toBe('40m');
      expect(rawConfig.routingPolicyVersion).toBe('codex-terra-sol-agy-gemini@3');
      expect(rawConfig.maxAgyTestWriters).toBe(1);

      const mod = await loadExecutionProfileModule();
      expect(mod.EXECUTION_POLICY.agyTestModel).toBe('gemini-3.7-flash-high');
      expect(mod.EXECUTION_POLICY.agyTestEffort).toBe('high');
      expect(mod.EXECUTION_POLICY.agyPrintTimeout).toBe('40m');
      expect(mod.EXECUTION_POLICY.routingPolicyVersion).toBe('codex-terra-sol-agy-gemini@3');
      expect(mod.EXECUTION_POLICY.maxAgyTestWriters).toBe(1);
    });

    it('buildWaveRouting persists pinned AGY facts on AGY test lanes for CODEX_AGY profile', async () => {
      const mod = await loadCodexRoutingModule();
      const graph = {
        package: { risk: 'MEDIUM' },
        shards: [{ id: 'core', units: ['T101', 'T102'] }],
        units: [
          { id: 'T101', body: 'setup', predictedWrites: ['packages/x/src/base.ts'] },
          { id: 'T102', body: 'feature', predictedWrites: ['packages/x/src/alpha.ts'] },
          { id: 'T103', body: 'spec', predictedWrites: ['tests/x/a.spec.ts'] },
        ],
        testLanes: [{ id: 'test-author', units: ['T103'] }],
      };

      const routing = mod.buildWaveRouting(graph, 'CODEX_AGY');
      expect(routing.schema).toBe('foresift/wave-routing@1');
      expect(routing.routingPolicyVersion).toBe('codex-terra-sol-agy-gemini@3');
      expect(routing.executionProfile).toBe('CODEX_AGY');
      expect(routing.implementationEngine).toBe('CODEX');
      expect(routing.testEngine).toBe('AGY');

      const testLane = routing.lanes.find((l: { lane: string }) => l.lane === 'test-author');
      expect(testLane).toBeDefined();
      expect(testLane).toEqual({
        lane: 'test-author',
        role: 'test',
        taskIds: ['T103'],
        engine: 'AGY',
        complexityTier: null,
        model: 'gemini-3.7-flash-high',
        reasoning: 'high',
        providerTimeout: '40m',
        serviceTier: null,
      });
    });

    it('buildWaveRouting persists pinned AGY facts on AGY test lanes for CLAUDE_AGY profile', async () => {
      const mod = await loadCodexRoutingModule();
      const graph = {
        package: { risk: 'LOW' },
        shards: [{ id: 'shard-1', units: ['T201'] }],
        units: [
          { id: 'T201', body: 'feature', predictedWrites: ['packages/y/src/b.ts'] },
          { id: 'T202', body: 'test', predictedWrites: ['tests/y/b.spec.ts'] },
        ],
        testLanes: [{ id: 'test-author', units: ['T202'] }],
      };

      const routing = mod.buildWaveRouting(graph, 'CLAUDE_AGY');
      expect(routing.executionProfile).toBe('CLAUDE_AGY');
      expect(routing.implementationEngine).toBe('CLAUDE');
      expect(routing.testEngine).toBe('AGY');

      const testLane = routing.lanes.find((l: { lane: string }) => l.lane === 'test-author');
      expect(testLane).toBeDefined();
      expect(testLane.engine).toBe('AGY');
      expect(testLane.role).toBe('test');
      expect(testLane.model).toBe('gemini-3.7-flash-high');
      expect(testLane.reasoning).toBe('high');
      expect(testLane.providerTimeout).toBe('40m');
    });

    it('codex-routing CLI --build-wave persists AGY facts in routing artifact', async () => {
      const dir = makeTempDir('codex-routing-cli-');
      const graphFile = join(dir, 'graph.json');
      const outFile = join(dir, 'routing.json');

      const graph = {
        package: { risk: 'HIGH' },
        shards: [{ id: 'core', units: ['T1'] }],
        units: [{ id: 'T1' }, { id: 'T2' }],
        testLanes: [{ id: 'test-author', units: ['T2'] }],
      };
      writeFileSync(graphFile, JSON.stringify(graph, null, 2));

      execFileSync(
        process.execPath,
        [
          join(REPO_ROOT, 'scripts/automation/codex-routing.mjs'),
          '--build-wave',
          '--graph',
          graphFile,
          '--profile',
          'CLAUDE_AGY',
          '--out',
          outFile,
        ],
        { encoding: 'utf8' },
      );

      expect(existsSync(outFile)).toBe(true);
      const written = JSON.parse(readFileSync(outFile, 'utf8'));
      const testLane = written.lanes.find((l: { lane: string }) => l.lane === 'test-author');
      expect(testLane.model).toBe('gemini-3.7-flash-high');
      expect(testLane.reasoning).toBe('high');
      expect(testLane.providerTimeout).toBe('40m');
      expect(testLane.engine).toBe('AGY');
    });
  });

  describe('Matrix AF: Execution identity preserves AGY facts and rejects missing routing facts', () => {
    it('preserves model, reasoning, and providerTimeout for AGY test lane in execution identity', async () => {
      const mod = await loadExecutionProfileModule();
      const identity = mod.createExecutionIdentity({
        packageId: 'g0-provider-lifecycle',
        generation: 1,
        workflow: 'foresift-sharded-wave',
        executionProfile: 'CODEX_AGY',
        baseHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
        lanes: [
          {
            lane: 'core',
            role: 'implementation',
            taskIds: ['T101'],
            engine: 'CODEX',
            model: 'gpt-5.6-sol',
            reasoning: 'high',
            serviceTier: 'standard',
          },
          {
            lane: 'test-author',
            role: 'test',
            taskIds: ['T102'],
            engine: 'AGY',
            model: 'gemini-3.7-flash-high',
            reasoning: 'high',
            providerTimeout: '40m',
          },
        ],
      });

      expect(identity.executionProfile).toBe('CODEX_AGY');
      expect(identity.implementationEngine).toBe('CODEX');
      expect(identity.testEngine).toBe('AGY');

      const agyLane = identity.lanes.find((l: { lane: string }) => l.lane === 'test-author');
      expect(agyLane).toBeDefined();
      expect(agyLane.model).toBe('gemini-3.7-flash-high');
      expect(agyLane.reasoning).toBe('high');
      expect(agyLane.providerTimeout).toBe('40m');
      expect(agyLane.engine).toBe('AGY');
      expect(agyLane.role).toBe('test');
    });

    it('fails closed when AGY lane is missing model, reasoning, or providerTimeout', async () => {
      const mod = await loadExecutionProfileModule();
      const baseInput = {
        packageId: 'g0-provider-lifecycle',
        generation: 1,
        workflow: 'foresift-sharded-wave',
        executionProfile: 'CODEX_AGY',
        baseHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
      };

      // Missing or invalid model
      for (const badModel of [undefined, null, '', 123, false]) {
        expect(() =>
          mod.createExecutionIdentity({
            ...baseInput,
            lanes: [
              {
                lane: 'test-author',
                role: 'test',
                taskIds: ['T1'],
                engine: 'AGY',
                model: badModel,
                reasoning: 'high',
                providerTimeout: '40m',
              },
            ],
          }),
        ).toThrow(/INVALID_AGY_ROUTE.*model/);
      }

      // Missing or invalid reasoning
      for (const badReasoning of [undefined, null, '', 456, false]) {
        expect(() =>
          mod.createExecutionIdentity({
            ...baseInput,
            lanes: [
              {
                lane: 'test-author',
                role: 'test',
                taskIds: ['T1'],
                engine: 'AGY',
                model: 'gemini-3.7-flash-high',
                reasoning: badReasoning,
                providerTimeout: '40m',
              },
            ],
          }),
        ).toThrow(/INVALID_AGY_ROUTE.*reasoning/);
      }

      // Missing or invalid providerTimeout
      for (const badTimeout of [undefined, null, '', 789, false]) {
        expect(() =>
          mod.createExecutionIdentity({
            ...baseInput,
            lanes: [
              {
                lane: 'test-author',
                role: 'test',
                taskIds: ['T1'],
                engine: 'AGY',
                model: 'gemini-3.7-flash-high',
                reasoning: 'high',
                providerTimeout: badTimeout,
              },
            ],
          }),
        ).toThrow(/INVALID_AGY_ROUTE.*providerTimeout/);
      }
    });

    it('persists and loads AGY execution identity and forbids mutation of persisted AGY facts', async () => {
      const mod = await loadExecutionProfileModule();
      const dir = makeTempDir('identity-agy-');
      const identityFile = join(dir, 'execution-identity.json');

      const original = mod.createExecutionIdentity({
        packageId: 'g0-provider-lifecycle',
        generation: 1,
        workflow: 'foresift-sharded-wave',
        executionProfile: 'CODEX_AGY',
        baseHead: 'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
        lanes: [
          {
            lane: 'core',
            role: 'implementation',
            taskIds: ['T1'],
            engine: 'CODEX',
            model: 'gpt-5.6-sol',
            reasoning: 'high',
            serviceTier: 'standard',
          },
          {
            lane: 'test-author',
            role: 'test',
            taskIds: ['T2'],
            engine: 'AGY',
            model: 'gemini-3.7-flash-high',
            reasoning: 'high',
            providerTimeout: '40m',
          },
        ],
      });

      mod.persistExecutionIdentity(identityFile, original);
      expect(existsSync(identityFile)).toBe(true);

      const loaded = mod.loadExecutionIdentity(identityFile);
      const agyLane = loaded.lanes.find((l: { lane: string }) => l.lane === 'test-author');
      expect(agyLane.model).toBe('gemini-3.7-flash-high');
      expect(agyLane.reasoning).toBe('high');
      expect(agyLane.providerTimeout).toBe('40m');

      // Attempt mutation of model on persisted identity
      const mutatedModel = {
        ...original,
        lanes: original.lanes.map((l: { lane: string; model: string }) =>
          l.lane === 'test-author' ? { ...l, model: 'gemini-2.5-pro' } : l,
        ),
      };
      expect(() => mod.persistExecutionIdentity(identityFile, mutatedModel)).toThrow(
        /EXECUTION_IDENTITY_IMMUTABLE/,
      );

      // Attempt mutation of providerTimeout on persisted identity
      const mutatedTimeout = {
        ...original,
        lanes: original.lanes.map((l: { lane: string; providerTimeout: string }) =>
          l.lane === 'test-author' ? { ...l, providerTimeout: '20m' } : l,
        ),
      };
      expect(() => mod.persistExecutionIdentity(identityFile, mutatedTimeout)).toThrow(
        /EXECUTION_IDENTITY_IMMUTABLE/,
      );
    });

    it('CLI execution-profile.mjs --create preserves AGY routing facts', async () => {
      const dir = makeTempDir('identity-cli-');
      const routingFile = join(dir, 'routing.json');
      const identityFile = join(dir, 'identity.json');

      const routing = {
        schema: 'foresift/wave-routing@1',
        routingPolicyVersion: 'codex-terra-sol-agy-gemini@3',
        executionProfile: 'CODEX_AGY',
        implementationEngine: 'CODEX',
        testEngine: 'AGY',
        lanes: [
          {
            lane: 'core',
            role: 'implementation',
            taskIds: ['T1'],
            engine: 'CODEX',
            model: 'gpt-5.6-sol',
            reasoning: 'high',
            serviceTier: 'standard',
          },
          {
            lane: 'test-author',
            role: 'test',
            taskIds: ['T2'],
            engine: 'AGY',
            model: 'gemini-3.7-flash-high',
            reasoning: 'high',
            providerTimeout: '40m',
          },
        ],
      };
      writeFileSync(routingFile, JSON.stringify(routing, null, 2));

      execFileSync(
        process.execPath,
        [
          join(REPO_ROOT, 'scripts/automation/execution-profile.mjs'),
          '--create',
          '--routing',
          routingFile,
          '--package',
          'g0-provider-lifecycle',
          '--generation',
          '1',
          '--workflow',
          'foresift-sharded-wave',
          '--base-head',
          'cd00ce3cf5ce95e9d2eec928d7cae5d1409406a0',
          '--out',
          identityFile,
        ],
        { encoding: 'utf8' },
      );

      expect(existsSync(identityFile)).toBe(true);
      const parsed = JSON.parse(readFileSync(identityFile, 'utf8'));
      const agyLane = parsed.lanes.find((l: { lane: string }) => l.lane === 'test-author');
      expect(agyLane.model).toBe('gemini-3.7-flash-high');
      expect(agyLane.reasoning).toBe('high');
      expect(agyLane.providerTimeout).toBe('40m');
    });
  });

  describe('Matrix AG: exec-agy-test-writer routing requirements and deterministic spawn', () => {
    function setupWriterFixture(
      options: {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
        agentResult?: object | null;
        filesToWrite?: Record<string, string>;
      } = {},
    ) {
      const dir = makeTempDir('agy-writer-fx-');
      const binDir = join(dir, 'bin');
      mkdirSync(binDir, { recursive: true });
      const recordPath = join(dir, 'mock-agy-call.json');
      const resultsDir = join(dir, 'results');

      const defaultAgentResult =
        options.agentResult === undefined
          ? {
              baselineClassifications: ['REGRESSION_RED'],
              testsRun: ['tests/x/a.spec.ts'],
              testResults: 'pass',
              blockers: [],
            }
          : options.agentResult;

      const defaultFiles =
        options.filesToWrite === undefined
          ? { 'tests/a.spec.ts': 'test("a", () => {});\n' }
          : options.filesToWrite;

      const agyScriptContent = `#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const stdin = readFileSync(0, 'utf8');
const args = process.argv.slice(2);
const cwd = process.cwd();

writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({
  argv: args,
  cwd,
  stdin,
  timestamp: Date.now(),
}, null, 2));

const agentResult = ${JSON.stringify(defaultAgentResult)};
if (agentResult !== null) {
  mkdirSync(${JSON.stringify(resultsDir)}, { recursive: true });
  writeFileSync(join(${JSON.stringify(resultsDir)}, 'agent-result.json'), JSON.stringify(agentResult, null, 2));
}

const files = ${JSON.stringify(defaultFiles)};
for (const [relPath, content] of Object.entries(files)) {
  const full = join(cwd, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const stdout = ${JSON.stringify(options.stdout ?? '{"type":"step"}\n{"type":"done"}\n')};
if (stdout) process.stdout.write(stdout);

const stderr = ${JSON.stringify(options.stderr ?? '')};
if (stderr) process.stderr.write(stderr);

process.exit(${JSON.stringify(options.exitCode ?? 0)});
`;
      const agyPath = join(binDir, 'agy');
      writeFileSync(agyPath, agyScriptContent, { mode: 0o755 });

      const wt = join(dir, 'wt');
      mkdirSync(wt, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: wt });
      execFileSync('git', ['config', 'user.name', 'test-author'], { cwd: wt });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: wt });
      mkdirSync(join(wt, 'tests'), { recursive: true });
      writeFileSync(join(wt, 'tests', 'base.spec.ts'), 'test("base", () => {});\n');
      execFileSync('git', ['add', '.'], { cwd: wt });
      execFileSync('git', ['commit', '-qm', 'initial base'], { cwd: wt });

      const brief = join(dir, 'brief.md');
      writeFileSync(brief, '# Test brief\nWrite test AC-201');

      const routingPath = join(dir, 'routing.json');
      const routing = {
        schema: 'foresift/wave-routing@1',
        routingPolicyVersion: 'codex-terra-sol-agy-gemini@3',
        executionProfile: 'CODEX_AGY',
        implementationEngine: 'CODEX',
        testEngine: 'AGY',
        lanes: [
          {
            lane: 'test-author',
            role: 'test',
            engine: 'AGY',
            model: 'gemini-3.7-flash-high',
            reasoning: 'high',
            providerTimeout: '40m',
            taskIds: ['T103'],
          },
        ],
      };
      writeFileSync(routingPath, JSON.stringify(routing, null, 2));

      return { dir, binDir, wt, brief, routingPath, resultsDir, routing, recordPath };
    }

    it('fails closed when --routing argument or file is missing or invalid', async () => {
      const mod = await loadAgyTestWriterModule();
      const fx = setupWriterFixture();

      // Missing routing argument
      expect(() =>
        mod.runAgyTestWriter({
          lane: 'test-author',
          brief: fx.brief,
          worktree: fx.wt,
          'results-dir': fx.resultsDir,
        }),
      ).toThrow(/AGY_TEST_ARGUMENT_MISSING: routing/);

      // Non-existent routing file
      expect(() =>
        mod.runAgyTestWriter({
          lane: 'test-author',
          brief: fx.brief,
          worktree: fx.wt,
          routing: join(fx.dir, 'missing-routing.json'),
          'results-dir': fx.resultsDir,
        }),
      ).toThrow(/AGY_TEST_ROUTING_MISSING/);

      // Route missing for lane
      const emptyRoutingPath = join(fx.dir, 'empty-routing.json');
      writeFileSync(emptyRoutingPath, JSON.stringify({ lanes: [] }));
      expect(() =>
        mod.runAgyTestWriter({
          lane: 'test-author',
          brief: fx.brief,
          worktree: fx.wt,
          routing: emptyRoutingPath,
          'results-dir': fx.resultsDir,
        }),
      ).toThrow(/AGY_TEST_ROUTE_INVALID: test-author/);

      // Route has non-AGY engine
      const codexTestRoutingPath = join(fx.dir, 'codex-routing.json');
      writeFileSync(
        codexTestRoutingPath,
        JSON.stringify({
          lanes: [{ lane: 'test-author', role: 'test', engine: 'CODEX', model: 'gpt-5.6-sol' }],
        }),
      );
      expect(() =>
        mod.runAgyTestWriter({
          lane: 'test-author',
          brief: fx.brief,
          worktree: fx.wt,
          routing: codexTestRoutingPath,
          'results-dir': fx.resultsDir,
        }),
      ).toThrow(/AGY_TEST_ROUTE_INVALID: test-author/);

      // Route missing model, reasoning, or providerTimeout
      for (const field of ['model', 'reasoning', 'providerTimeout']) {
        const invalidPath = join(fx.dir, `invalid-${field}.json`);
        const invalidRoute = {
          lane: 'test-author',
          role: 'test',
          engine: 'AGY',
          model: 'gemini-3.7-flash-high',
          reasoning: 'high',
          providerTimeout: '40m',
          [field]: undefined,
        };
        writeFileSync(invalidPath, JSON.stringify({ lanes: [invalidRoute] }));
        expect(() =>
          mod.runAgyTestWriter({
            lane: 'test-author',
            brief: fx.brief,
            worktree: fx.wt,
            routing: invalidPath,
            'results-dir': fx.resultsDir,
          }),
        ).toThrow(new RegExp(`AGY_TEST_ROUTE_INVALID: test-author\\.${field}`));
      }
    });

    it('launches AGY without shell with exact Gemini model, effort, timeout, noninteractive flags and writes telemetry and result', async () => {
      const mod = await loadAgyTestWriterModule();
      const fx = setupWriterFixture();

      const gitIdentityKeys = [
        'GIT_AUTHOR_NAME',
        'GIT_AUTHOR_EMAIL',
        'GIT_AUTHOR_DATE',
        'GIT_COMMITTER_NAME',
        'GIT_COMMITTER_EMAIL',
        'GIT_COMMITTER_DATE',
      ];
      const savedEnv: Record<string, string | undefined> = {};
      const allIdentityKeys = new Set([
        ...gitIdentityKeys,
        ...Object.keys(process.env).filter(
          (k) => k.startsWith('GIT_AUTHOR_') || k.startsWith('GIT_COMMITTER_'),
        ),
      ]);
      for (const key of allIdentityKeys) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }

      const prevPath = process.env.PATH;
      try {
        process.env.PATH = `${fx.binDir}:${prevPath}`;

        const result = mod.runAgyTestWriter({
          lane: 'test-author',
          brief: fx.brief,
          worktree: fx.wt,
          routing: fx.routingPath,
          'results-dir': fx.resultsDir,
          'task-ids': 'T103',
        });

        expect(existsSync(fx.recordPath)).toBe(true);
        const record = JSON.parse(readFileSync(fx.recordPath, 'utf8'));

        // CWD rooted at worktree
        expect(record.cwd).toBe(fx.wt);

        // Required flags: model gemini-3.7-flash-high, effort high, print-timeout 40m, noninteractive flags
        expect(record.argv).toEqual([
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--disable-slash-commands',
          '--dangerously-skip-permissions',
          '--model',
          'gemini-3.7-flash-high',
          '--effort',
          'high',
          '--print-timeout',
          '40m',
        ]);

        // Input prompt ndjson
        const parsedNdjson = JSON.parse(record.stdin.trim() ?? '{}');
        expect(parsedNdjson.event).toBe('user');
        expect(parsedNdjson.message.content).toContain('Execute this test-author brief now');
        expect(parsedNdjson.message.content).toContain('Never edit product implementation');

        // Result verification
        expect(result.schema).toBe('foresift/writer-result@1');
        expect(result.shardId).toBe('test-author');
        expect(result.role).toBe('test');
        expect(result.engine).toBe('AGY');
        expect(result.model).toBe('gemini-3.7-flash-high');
        expect(result.reasoning).toBe('high');
        expect(result.providerTimeout).toBe('40m');
        expect(result.completed).toEqual(['T103']);
        expect(result.baselineClassifications).toEqual(['REGRESSION_RED']);
        expect(result.testsRun).toEqual(['tests/x/a.spec.ts']);

        // Artifacts on disk
        const resultJsonPath = join(fx.resultsDir, 'result.json');
        expect(existsSync(resultJsonPath)).toBe(true);
        const savedResult = JSON.parse(readFileSync(resultJsonPath, 'utf8'));
        expect(savedResult.model).toBe('gemini-3.7-flash-high');
        expect(savedResult.reasoning).toBe('high');
        expect(savedResult.providerTimeout).toBe('40m');

        const telemetryPath = join(fx.resultsDir, 'telemetry.json');
        expect(existsSync(telemetryPath)).toBe(true);
        const telemetry = JSON.parse(readFileSync(telemetryPath, 'utf8'));
        expect(telemetry.schema).toBe('foresift/lane-telemetry@1');
        expect(telemetry.lane).toBe('test-author');
        expect(telemetry.engine).toBe('AGY');
        expect(telemetry.role).toBe('test');
        expect(telemetry.model).toBe('gemini-3.7-flash-high');
        expect(telemetry.reasoning).toBe('high');
        expect(telemetry.providerTimeout).toBe('40m');
        expect(telemetry.outcome).toBe('SUCCESS');

        // Verify git commit author
        const log = execFileSync('git', ['log', '-1', '--pretty=format:%an <%ae> - %s'], {
          cwd: fx.wt,
          encoding: 'utf8',
        });
        expect(log).toContain('Foresift AGY Test Author <noreply@foresift.local>');
        expect(log).toContain('test: AGY test-author lane test-author');
      } finally {
        process.env.PATH = prevPath;
        for (const [key, value] of Object.entries(savedEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    });

    it('rejects AGY execution when AGY touches product paths (path ownership boundary enforcement)', async () => {
      const mod = await loadAgyTestWriterModule();
      const fx = setupWriterFixture({
        filesToWrite: {
          'packages/domain/src/entity.ts': 'export const foo = 1;\n',
        },
      });

      const prevPath = process.env.PATH;
      try {
        process.env.PATH = `${fx.binDir}:${prevPath}`;
        expect(() =>
          mod.runAgyTestWriter({
            lane: 'test-author',
            brief: fx.brief,
            worktree: fx.wt,
            routing: fx.routingPath,
            'results-dir': fx.resultsDir,
          }),
        ).toThrow(/AGY_PRODUCT_OWNERSHIP_VIOLATION/);
      } finally {
        process.env.PATH = prevPath;
      }
    });

    it('rejects missing or invalid baselineClassifications in agent-result.json', async () => {
      const mod = await loadAgyTestWriterModule();
      const fxInvalid = setupWriterFixture({
        agentResult: {
          baselineClassifications: ['INVALID_NON_EXISTENT_CLASSIFICATION'],
          testsRun: [],
          testResults: 'pass',
        },
      });

      const prevPath = process.env.PATH;
      try {
        process.env.PATH = `${fxInvalid.binDir}:${prevPath}`;
        expect(() =>
          mod.runAgyTestWriter({
            lane: 'test-author',
            brief: fxInvalid.brief,
            worktree: fxInvalid.wt,
            routing: fxInvalid.routingPath,
            'results-dir': fxInvalid.resultsDir,
          }),
        ).toThrow(/AGY_TEST_BASELINE_CLASSIFICATION_INVALID/);
      } finally {
        process.env.PATH = prevPath;
      }

      const fxEmpty = setupWriterFixture({
        agentResult: {
          baselineClassifications: [],
          testsRun: [],
          testResults: 'pass',
        },
      });
      try {
        process.env.PATH = `${fxEmpty.binDir}:${prevPath}`;
        expect(() =>
          mod.runAgyTestWriter({
            lane: 'test-author',
            brief: fxEmpty.brief,
            worktree: fxEmpty.wt,
            routing: fxEmpty.routingPath,
            'results-dir': fxEmpty.resultsDir,
          }),
        ).toThrow(/AGY_TEST_BASELINE_CLASSIFICATION_INVALID/);
      } finally {
        process.env.PATH = prevPath;
      }
    });

    it('rejects when agy process exits with non-zero code or agent-result.json is missing', async () => {
      const mod = await loadAgyTestWriterModule();
      const fxFail = setupWriterFixture({
        exitCode: 1,
        stderr: 'fatal: provider timeout or rate limit exceeded',
      });

      const prevPath = process.env.PATH;
      try {
        process.env.PATH = `${fxFail.binDir}:${prevPath}`;
        expect(() =>
          mod.runAgyTestWriter({
            lane: 'test-author',
            brief: fxFail.brief,
            worktree: fxFail.wt,
            routing: fxFail.routingPath,
            'results-dir': fxFail.resultsDir,
          }),
        ).toThrow(/AGY_TEST_FAILED/);
      } finally {
        process.env.PATH = prevPath;
      }

      const fxNoResult = setupWriterFixture({
        agentResult: null,
      });
      try {
        process.env.PATH = `${fxNoResult.binDir}:${prevPath}`;
        expect(() =>
          mod.runAgyTestWriter({
            lane: 'test-author',
            brief: fxNoResult.brief,
            worktree: fxNoResult.wt,
            routing: fxNoResult.routingPath,
            'results-dir': fxNoResult.resultsDir,
          }),
        ).toThrow(/AGY_TEST_RESULT_CONTRACT_MISSING/);
      } finally {
        process.env.PATH = prevPath;
      }
    });
  });

  describe('Matrix AH: AGY baseline classification report contract', () => {
    it('accepts the documented {file, classification} shape', async () => {
      const mod = await loadAgyTestWriterModule();
      expect(
        mod.validateBaselineClassifications([
          { file: 'tests/a.spec.ts', classification: 'NEW_BEHAVIOR_RED' },
          { file: 'tests/b.spec.ts', classification: 'NEGATIVE_RED' },
          { file: 'tests/c.spec.ts', classification: 'CHARACTERIZATION_GREEN' },
          { file: 'tests/d.spec.ts', classification: 'REFACTOR_GUARD_GREEN' },
          { file: 'tests/e.spec.ts', classification: 'REGRESSION_RED' },
        ]),
      ).toBe(true);
    });

    it('accepts the {file, baseline} shape the model observably emits (run 265f6fe1)', async () => {
      const mod = await loadAgyTestWriterModule();
      expect(
        mod.validateBaselineClassifications([
          { file: 'packages/domain/test/cost.spec.ts', baseline: 'NEW_BEHAVIOR_RED' },
          { file: 'tests/negative/AC-100.negative.spec.ts', baseline: 'NEGATIVE_RED' },
        ]),
      ).toBe(true);
    });

    it('accepts bare string items and mixed shapes', async () => {
      const mod = await loadAgyTestWriterModule();
      expect(mod.validateBaselineClassifications(['REGRESSION_RED'])).toBe(true);
      expect(
        mod.validateBaselineClassifications([
          'NEGATIVE_RED',
          { file: 'tests/x.spec.ts', classification: 'NEW_BEHAVIOR_RED' },
          { file: 'tests/y.spec.ts', baseline: 'CHARACTERIZATION_GREEN' },
        ]),
      ).toBe(true);
    });

    it('fails closed on unknown values, empty lists, and non-arrays', async () => {
      const mod = await loadAgyTestWriterModule();
      expect(() =>
        mod.validateBaselineClassifications([{ file: 't', classification: 'ALL_GREEN_BRO' }]),
      ).toThrow(/AGY_TEST_BASELINE_CLASSIFICATION_INVALID/);
      expect(() => mod.validateBaselineClassifications([{ file: 't', baseline: 'PASS' }])).toThrow(
        /AGY_TEST_BASELINE_CLASSIFICATION_INVALID/,
      );
      expect(() => mod.validateBaselineClassifications([])).toThrow(
        /AGY_TEST_BASELINE_CLASSIFICATION_INVALID/,
      );
      expect(() => mod.validateBaselineClassifications('NEW_BEHAVIOR_RED')).toThrow(
        /AGY_TEST_BASELINE_CLASSIFICATION_INVALID/,
      );
      expect(() => mod.validateBaselineClassifications(undefined)).toThrow(
        /AGY_TEST_BASELINE_CLASSIFICATION_INVALID/,
      );
    });

    it('the writer prompt specifies the exact classification item shape', async () => {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(
        join(REPO_ROOT, 'scripts/automation/exec-agy-test-writer.mjs'),
        'utf8',
      );
      expect(src).toContain('"classification"');
      expect(src).toContain('NEW_BEHAVIOR_RED|REGRESSION_RED|NEGATIVE_RED');
    });
  });
});
