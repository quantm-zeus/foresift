import { describe, expect, it } from 'vitest';
import {
  SHARDED_WAVE_ROLLOUT,
  shardedWaveAdmits,
} from '../../scripts/automation/sharded-wave-rollout.mjs';
import {
  workPackageWorkflowFor,
  usesOptimizedWorkflow,
} from '../../scripts/automation/package-generations.mjs';

const canary = { mode: 'CANARY', canaryPackages: ['pkg-a'] } as const;
const production = { mode: 'PRODUCTION', canaryPackages: [] } as const;

describe('sharded-wave rollout routing (V4)', () => {
  it('ships OFF — the default state admits nothing', () => {
    expect(SHARDED_WAVE_ROLLOUT.mode).toBe('OFF');
    for (const id of ['pkg-a', 'g0-contracts-data-truth', 'anything']) {
      expect(shardedWaveAdmits(id)).toBe(false);
    }
  });

  it('OFF/CANARY admit exactly their sets; unknown modes fail closed', () => {
    expect(shardedWaveAdmits('pkg-a', canary)).toBe(true);
    expect(shardedWaveAdmits('pkg-b', canary)).toBe(false);
    expect(shardedWaveAdmits('pkg-a', { mode: 'SOMETHING_ELSE' } as never)).toBe(false);
    expect(shardedWaveAdmits(null as never, production)).toBe(false);
    expect(shardedWaveAdmits(undefined as never, production)).toBe(false);
  });

  it('never reroutes the retired generation-0 forensic lane, even under PRODUCTION', () => {
    // V3 precedence (pinned by v3-generations.spec.ts): gen>=1 outranks the
    // profile table; the LEGACY protection is the generation-0 row itself —
    // exactly how g0-contracts-data-truth actually lives.
    const g0 = { id: 'g0-contracts-data-truth' };
    expect(usesOptimizedWorkflow(g0)).toBe(false);
    expect(workPackageWorkflowFor(g0, production)).toBe('foresift-work-package');
  });

  it('routes OPTIMIZED packages by rollout state (default → optimized DAG)', () => {
    const pkg = { id: 'pkg-future', generation: 1 };
    expect(usesOptimizedWorkflow(pkg)).toBe(true);
    // shipped OFF state: historical routing preserved
    expect(workPackageWorkflowFor(pkg)).toBe('foresift-work-package-optimized');
    // CANARY admits only listed ids
    expect(workPackageWorkflowFor({ id: 'pkg-a', generation: 1 }, canary as never)).toBe(
      'foresift-sharded-wave',
    );
    expect(workPackageWorkflowFor({ id: 'pkg-b', generation: 1 }, canary as never)).toBe(
      'foresift-work-package-optimized',
    );
  });

  it('generation-0 legacy-profile rows keep historical routing under any state', () => {
    // gen-0 non-g0 package is OPTIMIZED by profile table; with a synthetic
    // PRODUCTION state it routes to the wave; the shipped OFF state cannot.
    const pkg = { id: 'pkg-gen0' };
    expect(workPackageWorkflowFor(pkg, production as never)).toBe('foresift-sharded-wave');
    expect(workPackageWorkflowFor(pkg)).toBe('foresift-work-package-optimized');
  });
});
