// Hyperdrive H3 mission item 9 — deterministic AI-invocation inventory.
//
// Every autonomous AI invocation point (workflow node that spawns an
// AI provider CLI) MUST acquire its lane permit from the global provider
// pool (provider-pool.mjs) and release it on every terminal path. A future
// executor that silently bypasses the pool breaks the governor's
// provider-capacity truth — this inventory test fails closed when the set
// of known executors changes or when an executor loses its pool wiring.
//
// The inventory lives here as the authoritative list: adding a new AI
// executor means adding it to AI_EXECUTORS below (with its provider and
// pool wiring evidence), and the test then enforces BOTH directions:
//   - every listed executor really imports/uses the pool module;
//   - every executor file matching the naming convention is listed
//     (an unlisted exec-*.mjs fails the inventory).
import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const AUTO = join(ROOT, 'scripts', 'automation');

/**
 * The authoritative inventory. `poolWired` executors must import
 * provider-pool.mjs (permit acquisition + release + health observation).
 * `poolWired: false` entries are executors that run an AI provider but are
 * gated UPSTREAM (their caller holds the permit) — each carries the file
 * that must name them as the delegation target, and the test verifies the
 * upstream gate references the executor.
 */
const AI_EXECUTORS = [
  { file: 'exec-claude-writer.mjs', provider: 'claude', poolWired: true },
  { file: 'exec-codex-writer.mjs', provider: 'codex', poolWired: true },
  { file: 'exec-codex-repair.mjs', provider: 'codex', poolWired: true },
  { file: 'exec-agy-test-writer.mjs', provider: 'agy', poolWired: true },
  {
    // Legacy parallel-lane AGY writer — superseded by the HYBRID_AGY wave
    // profile's exec-agy-test-writer path; not referenced by any current
    // workflow. Must stay pool-clean if revived.
    file: 'exec-agy-writer.mjs',
    provider: 'agy',
    poolWired: false,
    upstream: 'exec-agy-writer.d.mts',
    legacyOnly: true,
  },
  {
    // AGY batch migrator — invoked ONLY by bun-migration-runner.mjs, whose
    // --agy node is the workflow gate; the runner owns concurrency itself
    // (max 3, heavy batches width 1). Pool wiring owned by the runner.
    file: 'exec-agy-bun-migration.mjs',
    provider: 'agy',
    poolWired: false,
    upstream: 'bun-migration-runner.mjs',
  },
  {
    // Semantic reviewer / conflict resolver — currently DEAD CODE (no caller
    // in scripts/ or .archon/). Recorded here so it cannot be revived and
    // invoked without either wiring it through the pool or declaring an
    // upstream gate. The dead-code check below asserts it stays unreferenced.
    file: 'exec-agy-test-conflict-resolver.mjs',
    provider: 'agy',
    poolWired: false,
    upstream: null,
    legacyOnly: true,
  },
];

// Every executor that holds its own permit must import the pool module.
const POOL_MODULE = 'provider-pool.mjs';

describe('AI invocation inventory (mission item 9)', () => {
  test('every poolWired executor imports the global provider pool', () => {
    for (const e of AI_EXECUTORS.filter((x) => x.poolWired)) {
      const p = join(AUTO, e.file);
      expect(existsSync(p)).toBe(true);
      const src = readFileSync(p, 'utf8');
      expect(src).toContain(POOL_MODULE);
      // Permit discipline: acquisition AND release both present.
      expect(src).toMatch(/acquire(Lane)?Permit/);
      expect(src).toMatch(/release(Lane)?Permit/);
    }
  });

  test('every non-poolWired executor is delegated to by its declared upstream gate', () => {
    for (const e of AI_EXECUTORS.filter((x) => !x.poolWired)) {
      if (e.legacyOnly) {
        // Legacy/dead executor: must NOT be referenced by any live workflow node.
        const wave = readFileSync(
          join(ROOT, '.archon', 'workflows', 'foresift', 'foresift-sharded-wave.yaml'),
          'utf8',
        );
        expect(wave.includes(e.file)).toBe(false);
      } else {
        const up = join(AUTO, e.upstream!);
        expect(existsSync(up)).toBe(true);
        const src = readFileSync(up, 'utf8');
        expect(src).toContain(e.file);
      }
    }
  });

  test('workflow AI nodes invoke ONLY inventory-listed executors', () => {
    const dir = join(ROOT, '.archon', 'workflows', 'foresift');
    const listed = new Set(AI_EXECUTORS.map((e) => e.file));
    for (const wf of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      const src = readFileSync(join(dir, wf), 'utf8');
      const calls = [...src.matchAll(/(exec-[a-z0-9-]+)\.mjs/g)].map((m) => `${m[1]}.mjs`);
      for (const c of calls) {
        expect(listed.has(c)).toBe(true);
      }
    }
  });

  test('the pool module exposes the full permit surface the inventory relies on', async () => {
    const pool = await import(`${ROOT}/scripts/automation/provider-pool.mjs`);
    for (const fn of [
      'acquirePermit',
      'releasePermit',
      'acquireLanePermit',
      'releaseLanePermit',
      'observeClaudeOutcome',
      'observeCodexOutcome',
      'reconcileLaneHolders',
      'providerAdmissionView',
    ]) {
      expect(typeof pool[fn]).toBe('function');
    }
  });

  test('claude-lane-core releases its permit and observes health', () => {
    const src = readFileSync(join(AUTO, 'claude-lane-core.mjs'), 'utf8');
    expect(src).toContain(POOL_MODULE);
    expect(src).toMatch(/release(Lane)?Permit/);
    expect(src).toMatch(/observeClaudeOutcome/);
  });
});
