import { describe, expect, it } from 'vitest';
import {
  SHARDED_WAVE_ROLLOUT,
  shardedWaveAdmits,
} from '../../scripts/automation/sharded-wave-rollout.mjs';
import {
  workPackageWorkflowFor,
  usesOptimizedWorkflow,
} from '../../scripts/automation/package-generations.mjs';

const off = { mode: 'OFF', canaryPackages: [] } as const;
const canary = { mode: 'CANARY', canaryPackages: ['pkg-a'] } as const;

describe('sharded-wave rollout routing (V4)', () => {
  it('ACTIVE state is PRODUCTION — the §18 acceptance-matrix flip landed', () => {
    // The flip commit is authorized by .optimizer-evidence/v4-acceptance-
    // matrix.md (A1/A2/B1/B2/A3 canaries + R1–R7 runtime findings). Any
    // change BACK must be its own reviewed commit editing this pin.
    expect(SHARDED_WAVE_ROLLOUT.mode).toBe('PRODUCTION');
    expect(Object.isFrozen(SHARDED_WAVE_ROLLOUT)).toBe(true);
    expect(shardedWaveAdmits('pkg-a')).toBe(true);
  });

  it('OFF/CANARY admit exactly their sets; unknown modes fail closed', () => {
    expect(shardedWaveAdmits('pkg-a', off)).toBe(false);
    expect(shardedWaveAdmits('pkg-a', canary)).toBe(true);
    expect(shardedWaveAdmits('pkg-b', canary)).toBe(false);
    expect(shardedWaveAdmits('pkg-a', { mode: 'SOMETHING_ELSE' } as never)).toBe(false);
    expect(shardedWaveAdmits(null as never, off)).toBe(false);
    expect(shardedWaveAdmits(undefined as never, off)).toBe(false);
  });

  it('never reroutes the retired generation-0 forensic lane, even under PRODUCTION', () => {
    // V3 precedence (pinned by v3-generations.spec.ts): gen>=1 outranks the
    // profile table; the LEGACY protection is the generation-0 row itself —
    // exactly how g0-contracts-data-truth actually lives.
    const g0 = { id: 'g0-contracts-data-truth' };
    expect(usesOptimizedWorkflow(g0)).toBe(false);
    expect(workPackageWorkflowFor(g0)).toBe('foresift-work-package');
  });

  it('routes OPTIMIZED packages through rollout state (active ⇒ sharded wave)', () => {
    const pkg = { id: 'pkg-future', generation: 1 };
    expect(usesOptimizedWorkflow(pkg)).toBe(true);
    // ACTIVE PRODUCTION state: every OPTIMIZED-profile package takes the wave.
    expect(workPackageWorkflowFor(pkg)).toBe('foresift-sharded-wave');
    // CANARY admits only listed ids; OFF admits nothing (historical DAG).
    expect(workPackageWorkflowFor({ id: 'pkg-a', generation: 1 }, canary)).toBe(
      'foresift-sharded-wave',
    );
    expect(workPackageWorkflowFor({ id: 'pkg-b', generation: 1 }, canary)).toBe(
      'foresift-work-package-optimized',
    );
    expect(workPackageWorkflowFor(pkg, off)).toBe('foresift-work-package-optimized');
  });

  it('generation-0 legacy-profile rows keep historical routing under any state', () => {
    // gen-0 non-g0 package is OPTIMIZED by profile table: routes with state.
    const pkg = { id: 'pkg-gen0' };
    expect(workPackageWorkflowFor(pkg)).toBe('foresift-sharded-wave'); // active
    expect(workPackageWorkflowFor(pkg, off)).toBe('foresift-work-package-optimized');
  });
});
