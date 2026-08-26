// C4 §17 regression coverage: later-milestone critical-path scheduling.
// Required V2 coverage:
//   42. G0 (foundation) stays max-parallel 1;
//   43. CRITICAL packages stay serialized;
//   44. dependencies remain mandatory before scheduling;
//   45. overlapping writeScopes cannot co-run;
//   46. critical-path priority picks the right ELIGIBLE package wherever
//       concurrency permits.
// Every eligibility verdict below comes from the production
// schema.mjs canStartPackage via the documented adapter — the scheduler only
// adds deterministic ORDER, never policy.
import { afterAll, describe, expect, it } from 'bun:test';
import { canStartPackage } from '../../scripts/automation/schema.mjs';
import {
  criticalPathScore,
  longestDownstreamPath,
  selectNextPackage,
} from '../../scripts/automation/milestone-scheduler.mjs';
import { disposeGitFixtureBase } from '../helpers/git-fixture.js';

afterAll(() => disposeGitFixtureBase());

const POLICY = {
  foundationMilestones: ['G0'],
  maxParallelCodingPackagesFoundation: 1,
  maxParallelCodingPackages: 2,
  serialWhenRisk: ['CRITICAL'],
};

interface SynthPkg {
  id: string;
  risk?: string;
  parallelizable?: boolean;
  status?: string;
  dependencies?: string[];
  writeScopes?: string[];
}

const pkg = (id: string, over: Partial<SynthPkg> = {}): SynthPkg => ({
  id,
  risk: 'HIGH',
  parallelizable: true,
  status: 'PENDING',
  dependencies: [],
  writeScopes: [`packages/${id}/**`],
  ...over,
});
const msOf = (milestoneId: string, packages: SynthPkg[]) => ({ milestoneId, packages });

// Synthetic roadmaps carry only `policy` because that is all the production
// canStartPackage consults; the cast keeps the test focused on behavior.
const roadmap = { policy: POLICY } as unknown as Parameters<typeof canStartPackage>[0];
type CanStartArgs = Parameters<typeof canStartPackage>;
const adapterFor =
  (ms: unknown) =>
  (candidate: unknown, running: unknown[]): { ok: boolean; reason: string } =>
    canStartPackage(
      roadmap,
      ms as CanStartArgs[1],
      candidate as CanStartArgs[2],
      running as CanStartArgs[3],
    );

describe('foundation concurrency is untouched (test 42)', () => {
  it('G0 allows exactly one coding package even when two are eligible', () => {
    const a = pkg('g0-a');
    const b = pkg('g0-b');
    const ms = msOf('G0', [a, b]);
    // Nothing running: first selection succeeds…
    const empty = selectNextPackage(adapterFor(ms), ms, []);
    expect(empty.selected?.id).toBe('g0-a');
    // …but with g0-a running, g0-b must be refused by foundation policy.
    const one = selectNextPackage(adapterFor(ms), ms, [a]);
    expect(one.selected).toBeNull();
    const refused = one.ranked.find((r) => r.id === 'g0-b');
    expect(refused?.startable).toBe(false);
    expect(refused?.reason).toMatch(/foundation/);
    // And the refusal is the production policy's own verdict, not the
    // scheduler's reimplementation.
    expect(
      canStartPackage(roadmap, ms as CanStartArgs[1], b as CanStartArgs[2], [a] as CanStartArgs[3])
        .reason,
    ).toBe(refused?.reason);
  });

  it('standard milestones still permit their policy maximum of 2', () => {
    const ms = msOf('GX', [pkg('s-a'), pkg('s-b'), pkg('s-c')]);
    const a = ms.packages[0];
    const first = selectNextPackage(adapterFor(ms), ms, []);
    expect(first.selected?.id).toBe('s-a');
    const second = selectNextPackage(adapterFor(ms), ms, [a]);
    expect(second.selected?.id).toBe('s-b');
    const third = selectNextPackage(adapterFor(ms), ms, [a, ms.packages[1]]);
    expect(third.selected).toBeNull();
  });
});

describe('CRITICAL serialization is preserved (test 43)', () => {
  it('refuses a CRITICAL candidate while anything runs, and refuses co-runs against it', () => {
    const crit = pkg('c-fix', { risk: 'CRITICAL' });
    const other = pkg('o-1');
    const ms = msOf('GX', [crit, other]);
    // CRITICAL alone: starts fine.
    expect(selectNextPackage(adapterFor(ms), ms, []).selected?.id).toBe('c-fix');
    // CRITICAL while another package runs: refused outright.
    const whileRunning = selectNextPackage(adapterFor(ms), ms, [other]);
    expect(whileRunning.ranked.find((r) => r.id === 'c-fix')?.startable).toBe(false);
    // Non-critical candidate cannot co-run with a running CRITICAL either.
    const msCritRunning = msOf('GX', [crit, other]);
    const against = selectNextPackage(adapterFor(msCritRunning), msCritRunning, [crit]);
    expect(against.ranked.find((r) => r.id === 'o-1')?.startable).toBe(false);
  });
});

describe('dependencies are mandatory (test 44)', () => {
  it('a package whose dependency is not PROVEN is never ranked or selected', () => {
    const dep = pkg('dep-1', { status: 'IMPLEMENTING' });
    const child = pkg('child-1', { dependencies: ['dep-1'] });
    const ready = pkg('ready-1');
    const ms = msOf('GX', [dep, child, ready]);
    const r = selectNextPackage(adapterFor(ms), ms, []);
    expect(r.ranked.map((x) => x.id)).not.toContain('child-1');
    expect(r.selected?.id).toBe('ready-1');
    // Once the dependency proves, the child becomes schedulable.
    const proven = msOf('GX', [
      { ...dep, status: 'PROVEN' },
      child,
      { ...ready, status: 'PROVEN' },
    ]);
    const next = selectNextPackage(adapterFor(proven), proven, []);
    expect(next.selected?.id).toBe('child-1');
  });
});

describe('write-scope overlap blocks co-run (test 45)', () => {
  it('two eligible packages sharing a scope never run concurrently', () => {
    const a = pkg('w-a', { writeScopes: ['packages/shared/**'] });
    const b = pkg('w-b', { writeScopes: ['packages/shared/sub/**'] });
    const lone = pkg('w-lone');
    const ms = msOf('GX', [a, b, lone]);
    const r = selectNextPackage(adapterFor(ms), ms, [a]);
    expect(r.ranked.find((x) => x.id === 'w-b')?.startable).toBe(false);
    expect(r.ranked.find((x) => x.id === 'w-b')?.reason).toMatch(/writeScopes overlap/);
    // Disjoint scope remains startable under the same running set.
    expect(r.ranked.find((x) => x.id === 'w-lone')?.startable).toBe(true);
  });
});

describe('critical-path priority among eligible candidates (test 46)', () => {
  it('prefers the head of the longest downstream chain when concurrency permits', () => {
    const ms = msOf('GX', [
      pkg('root', { status: 'PROVEN' }),
      pkg('chain-a1', { dependencies: ['root'] }),
      pkg('chain-a2', { dependencies: ['chain-a1'] }),
      pkg('chain-a3', { dependencies: ['chain-a2'] }),
      pkg('solo-b'),
    ]);
    expect(longestDownstreamPath(ms, 'chain-a1')).toBe(2);
    expect(longestDownstreamPath(ms, 'solo-b')).toBe(0);
    const r = selectNextPackage(adapterFor(ms), ms, []);
    expect(r.selected?.id).toBe('chain-a1');
    expect(r.ranked.map((x) => x.id)).toEqual(['chain-a1', 'solo-b']);
  });

  it('uses unlocked-downstream count as the second key and id as the final tie-break', () => {
    // Both heads have longest path 1; the wide head frees TWO children where
    // the narrow head frees one ⇒ equal first key, wider unlock wins.
    const wide = msOf('GX', [
      pkg('q-head'),
      pkg('q-1', { dependencies: ['q-head'] }),
      pkg('q-2', { dependencies: ['q-head'] }),
      pkg('p-narrow'),
      pkg('p-1', { dependencies: ['p-narrow'] }),
    ]);
    expect(criticalPathScore(wide, wide.packages[0]!).longestDownstreamPath).toBe(1);
    expect(criticalPathScore(wide, wide.packages[3]!).longestDownstreamPath).toBe(1);
    expect(criticalPathScore(wide, wide.packages[0]!).unlockedDownstreamCount).toBe(2);
    expect(criticalPathScore(wide, wide.packages[3]!).unlockedDownstreamCount).toBe(1);
    const rWide = selectNextPackage(adapterFor(wide), wide, []);
    expect(rWide.selected?.id).toBe('q-head');
    expect(rWide.ranked.map((x) => x.id)).toEqual(['q-head', 'p-narrow']);

    // Perfect score ties resolve by id ascending — total determinism.
    const tied = msOf('GX', [pkg('t-beta'), pkg('t-alpha')]);
    const rTied = selectNextPackage(adapterFor(tied), tied, []);
    expect(rTied.selected?.id).toBe('t-alpha');
    expect(rTied.ranked.map((x) => x.id)).toEqual(['t-alpha', 't-beta']);
  });

  it('never selects a blocked candidate over an eligible lower-ranked one', () => {
    // chain head shares a scope with the RUNNING package ⇒ blocked; the
    // scheduler must fall through to the next startable candidate instead of
    // stalling on priority order.
    const running = pkg('busy', { writeScopes: ['packages/chain/**'] });
    const ms = msOf('GX', [
      pkg('chain-top', { writeScopes: ['packages/chain/**'] }),
      pkg('fallback'),
    ]);
    const r = selectNextPackage(adapterFor(ms), ms, [running]);
    expect(r.ranked[0]?.id).toBe('chain-top');
    expect(r.ranked[0]?.startable).toBe(false);
    expect(r.selected?.id).toBe('fallback');
  });
});
