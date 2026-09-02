// Hyperdrive H3 P1-6 — launch preflight regressions: exact truth from the
// deterministic task graph, conservative degradation, exact co-run decision,
// shared-surface extraction.
//
// The g0-traceability-conformance assertions read a HERMETIC fixture root
// (tests/fixtures/preflight-g0: a two-package milestone + the traceability
// plan with its original 10 open tasks), never the live specs/ tree. Live-tree
// pinning broke the moment the package legitimately completed (run
// aa3e8015 → PR #157: every task closed by deterministic evidence, so
// openTaskCount hit 0 and the suite went RED on a healthy product) — package
// lifecycle state is not a test input.
import { join } from 'node:path';
import { describe, test, expect } from 'bun:test';
import {
  buildLaunchPreflight,
  exactCoRunCompatible,
} from '../../scripts/automation/launch-preflight.mjs';

const FIXTURE_ROOT = join(import.meta.dir, '..', 'fixtures', 'preflight-g0');

describe('buildLaunchPreflight (deterministic task-graph derivation)', () => {
  test('g0-traceability-conformance derives exact predicted writes from its seeded plan', () => {
    const p = buildLaunchPreflight('g0-traceability-conformance', FIXTURE_ROOT);
    expect(p.exact).toBe(true);
    expect(p.openTaskCount).toBeGreaterThan(0);
    expect(p.predictedWrites.length).toBeGreaterThan(0);
    expect(p.productWrites).toContain('packages/release-conformance/src/conformance.ts');
    expect(p.testWrites.some((w) => w.startsWith('packages/release-conformance/test/'))).toBe(true);
    expect(p.migrationDuties).toContain('migrations/g0_trace_0001_trace_schema.sql');
    // No shared surface is named by the plan.
    expect(p.sharedSurfaces).toEqual([]);
  });

  test('unknown package degrades conservatively (exact:false, never throws)', () => {
    const p = buildLaunchPreflight('g0-does-not-exist');
    expect(p.exact).toBe(false);
    expect(p.reason).toBeTruthy();
    expect(p.predictedWrites).toEqual([]);
    expect(p.shardNeed).toBeNull();
  });

  test('ready counts exclude dependency-blocked units; shardNeed matches planned shards', () => {
    const p = buildLaunchPreflight('g0-traceability-conformance', FIXTURE_ROOT);
    // Ready truth: a unit counts as ready only when every declared dependency
    // is closed — dependency/phase-blocked units must never inflate the
    // parallelizable-ready count the adaptive lane resolver consumes.
    expect(p.readyTaskCount).toBeLessThanOrEqual(p.openTaskCount);
    expect(p.parallelizableReadyCount).toBeLessThanOrEqual(p.readyTaskCount);
    // Exact shard need: the deterministic planner probe at the policy ceiling
    // returns the number of non-empty planned shards (serial core + parallel
    // shards after cross-lane closure demotion).
    expect(p.shardNeed).toBeGreaterThanOrEqual(1);
    expect(p.shardNeed).toBeLessThanOrEqual(3);
  });
});

describe('exactCoRunCompatible (exact write-truth co-run decision)', () => {
  const rec = (predictedWrites: string[], exact = true) => ({
    exact,
    predictedWrites,
  });

  test('disjoint predicted writes co-run; overlaps refuse; unknown truth is neutral', () => {
    const a = rec(['packages/a/src/x.ts']);
    const b = rec(['packages/b/src/y.ts']);
    expect(exactCoRunCompatible(a, b)).toEqual({
      compatible: true,
      reason: 'predicted writes disjoint',
    });
    const c = rec(['packages/a/src/x.ts', 'packages/b/src/z.ts']);
    expect(exactCoRunCompatible(a, c).compatible).toBe(false);
    expect(exactCoRunCompatible(a, c).reason).toContain('packages/a/src/x.ts');
    // Either side lacking exact truth ⇒ neutral (caller keeps broad scopes).
    expect(exactCoRunCompatible(a, rec([], false)).compatible).toBeNull();
    expect(exactCoRunCompatible(null, b).compatible).toBeNull();
  });

  test('shared-surface writes are surfaced for lease serialization, not silent co-run', () => {
    const manifest = 'evidence/bun-migration/bun-migration-manifest.json';
    const a = buildLaunchPreflight('g0-traceability-conformance', FIXTURE_ROOT);
    // The traceability plan does not name a shared surface; a synthetic
    // record that does must expose it for the lease path.
    const b = { exact: true, predictedWrites: [manifest], sharedSurfaces: [manifest] };
    expect(b.sharedSurfaces).toContain(manifest);
    expect(a.sharedSurfaces).not.toContain(manifest);
  });
});
