import { describe, expect, it } from 'vitest';
import {
  canStartPackage,
  classifyFailure,
  loadRoadmap,
  packageEligible,
  validateMilestoneState,
  validateRoadmap,
} from '../../scripts/automation/schema.mjs';
import type { MilestoneState, Roadmap, WorkPackage } from '../../scripts/automation/schema.mjs';

const ROADMAP = loadRoadmap();

const pkg = (over: Partial<WorkPackage> = {}): WorkPackage => ({
  id: 'g0-x',
  objective: 'an outcome-oriented objective sentence',
  requirementIds: ['FR-CORE-001'],
  dependencies: [],
  risk: 'HIGH',
  parallelizable: true,
  writeScopes: ['packages/x/**'],
  verificationCommands: ['pnpm test'],
  status: 'PENDING',
  ...over,
});

const milestone = (packages: WorkPackage[]): MilestoneState => ({
  schemaVersion: '1.0.0',
  milestoneId: 'G0',
  status: 'ACTIVE',
  packages,
});

describe('roadmap validation', () => {
  it('accepts the shipped roadmap derived from the PRD manifest', () => {
    expect(validateRoadmap(ROADMAP)).toEqual([]);
    expect(ROADMAP.milestones.map((m) => m.id)).toEqual([
      'G0',
      'G1',
      'G2',
      'G3',
      'G4',
      'G5',
      'G6',
      'G7',
    ]);
  });

  it('rejects unknown dependency references and bad statuses', () => {
    const errs = validateRoadmap({
      schemaVersion: '1.0.0',
      policy: {},
      currentMilestoneId: null,
      milestones: [
        { id: 'A', name: 'a', dependsOn: ['ZZZ'], status: 'WEIRD' },
        { id: 'A', name: 'dup', dependsOn: [], status: 'PLANNED' },
      ],
    } as unknown as Roadmap);
    expect(errs.join('\n')).toMatch(/unknown ZZZ/);
    expect(errs.join('\n')).toMatch(/invalid status WEIRD/);
    expect(errs.join('\n')).toMatch(/duplicate milestone id A/);
  });
});

describe('milestone state validation', () => {
  it('accepts a well-formed two-package plan', () => {
    const ms = milestone([
      pkg({ id: 'a', parallelizable: false, risk: 'CRITICAL' }),
      pkg({ id: 'b', dependencies: ['a'], requirementIds: ['FR-DATA-001'] }),
    ]);
    expect(validateMilestoneState(ms)).toEqual([]);
  });

  it('rejects duplicate ids and invalid fields', () => {
    const errs = validateMilestoneState(
      milestone([
        pkg({ id: 'a', risk: 'EXTREME' }),
        pkg({ id: 'a' }),
        pkg({ id: 'b', requirementIds: ['FR-DATA-001'] }),
      ]),
    );
    const joined = errs.join('\n');
    expect(joined).toMatch(/duplicate package id a/);
    expect(joined).toMatch(/invalid risk EXTREME/);
  });

  it('rejects circular dependencies via deterministic topo sort', () => {
    const errs = validateMilestoneState(
      milestone([
        pkg({ id: 'a', dependencies: ['b'] }),
        pkg({ id: 'b', requirementIds: ['FR-DATA-001'], dependencies: ['a'] }),
      ]),
    );
    expect(errs.join('\n')).toMatch(/circular dependency involving: a, b/);
  });

  it('enforces the 2-8 package bound and CRITICAL serializability', () => {
    const one = validateMilestoneState(milestone([pkg()]));
    expect(one.join(' ')).toMatch(/2-8 work packages/);

    // Shape-level only: CRITICAL⇒serial is enforced by milestone-validate.mjs.
    const criticalParallel = validateMilestoneState(
      milestone([
        pkg({ id: 'a', risk: 'CRITICAL', parallelizable: true }),
        pkg({ id: 'b', requirementIds: ['FR-DATA-001'] }),
      ]),
    );
    expect(criticalParallel).toEqual([]);
  });
});

describe('package eligibility', () => {
  const ms = milestone([
    pkg({ id: 'base', status: 'PROVEN' }),
    pkg({ id: 'waiting', status: 'PENDING', dependencies: ['base'] }),
    pkg({ id: 'blocked', status: 'PENDING', dependencies: ['unproven'] }),
    pkg({ id: 'unproven', status: 'RUNNING' }),
  ]);

  it('permits PENDING with all deps PROVEN', () => {
    expect(
      packageEligible(ms, pkg({ id: 'waiting', status: 'PENDING', dependencies: ['base'] }))
        .eligible,
    ).toBe(true);
  });
  it('fails closed on unproven dependencies or wrong status', () => {
    expect(
      packageEligible(ms, pkg({ id: 'blocked', status: 'PENDING', dependencies: ['unproven'] }))
        .reason,
    ).toMatch(/not PROVEN/);
    expect(
      packageEligible(ms, pkg({ id: 'done', status: 'PROVEN', dependencies: [] })).reason,
    ).toMatch(/not PENDING/);
    expect(packageEligible(ms, null).eligible).toBe(false);
  });
});

describe('concurrency policy', () => {
  const ms = milestone([
    pkg({ id: 'crit', risk: 'CRITICAL', parallelizable: false }),
    pkg({ id: 'p1', writeScopes: ['packages/a/**'] }),
    pkg({ id: 'p2', writeScopes: ['packages/b/**'] }),
    pkg({ id: 'p3', writeScopes: ['packages/a/**'] }),
    pkg({ id: 'p4', dependencies: ['p1'] }),
  ]);
  const find = (id: string): WorkPackage => ms.packages.find((p) => p.id === id)!;
  const postFoundation: Roadmap = {
    ...ROADMAP,
    policy: { ...ROADMAP.policy, foundationMilestones: [] },
  };

  it('foundation milestones cap concurrency at 1', () => {
    const v = canStartPackage(ROADMAP, ms, find('p1'), [find('p2')]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/limit 1 .*foundation/);
  });

  it('CRITICAL packages always run serially', () => {
    const v = canStartPackage(postFoundation, ms, find('crit'), [find('p1')]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/CRITICAL packages always run serially/);
    // And nothing may co-run with an already-running CRITICAL package.
    const v2 = canStartPackage(postFoundation, ms, find('p2'), [find('crit')]);
    expect(v2.reason).toMatch(/cannot co-run with CRITICAL/);
  });

  it('post-foundation allows 2 disjoint parallelizable non-critical packages', () => {
    expect(canStartPackage(postFoundation, ms, find('p1'), []).ok).toBe(true);
    expect(canStartPackage(postFoundation, ms, find('p2'), [find('p1')]).ok).toBe(true);
  });

  it('blocks overlapping scopes, dependency relations, and a third co-runner', () => {
    expect(canStartPackage(postFoundation, ms, find('p3'), [find('p1')]).reason).toMatch(/overlap/);
    expect(canStartPackage(postFoundation, ms, find('p4'), [find('p1')]).reason).toMatch(
      /dependency relationship/,
    );
    expect(
      canStartPackage(postFoundation, ms, find('p2'), [find('p1'), find('p3')]).reason,
    ).toMatch(/limit 2/);
    expect(
      canStartPackage(postFoundation, ms, find('p2'), [{ ...find('p1'), parallelizable: false }])
        .reason,
    ).toMatch(/parallelizable/);
  });
});

describe('failure classification', () => {
  it('buckets transient, fatal, and unknown failures per recovery policy', () => {
    expect(classifyFailure('ETIMEDOUT after 30s')).toBe('TRANSIENT');
    expect(classifyFailure('rate limit hit, retry after 429')).toBe('TRANSIENT');
    expect(classifyFailure('authentication failed: 401')).toBe('FATAL');
    expect(classifyFailure('credit balance exhausted')).toBe('FATAL');
    expect(classifyFailure('exit code 7 while running tests')).toBe('UNKNOWN');
  });
});
