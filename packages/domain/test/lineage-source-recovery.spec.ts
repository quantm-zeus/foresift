import { describe, expect, it } from 'bun:test';
import {
  ErrorCode,
  ForesiftError,
  LineageStatus,
  DEFAULT_DEPENDENCE_THRESHOLDS,
  assertDependenceInputs,
  aggregateWithoutDoubleCounting,
  degradedHealthState,
  detectLineageCycles,
  fixedClock,
  inputsJustifyReducedIndependence,
  scriptedClock,
  supportsPopulationClaim,
  validateRecoveryTier,
  utcTimestamp,
  type FeatureValue,
  type MigrationLineageEdge,
  type PoolId,
} from '../src/index.ts';

const pool = (n: string): PoolId => `eip155:1/uniswap/v2/${n}` as PoolId;
const at = (s: string) => utcTimestamp(s);

function edge(
  migrationId: string,
  launch: string,
  migrated: string,
  migratedAt?: string,
): MigrationLineageEdge {
  return {
    migrationId: migrationId as MigrationLineageEdge['migrationId'],
    launchPoolId: pool(launch),
    migratedPoolId: pool(migrated),
    status: LineageStatus.CONFIRMED,
    ...(migratedAt !== undefined ? { migratedAt: at(migratedAt) } : {}),
  };
}

describe('migration-lineage double-count-safe aggregation (FR-DATA-001, AC-022 substrate)', () => {
  const e = edge('m1', 'launch', 'successor', '2026-01-01T12:00:00Z');

  it('counts each sample once across the boundary while naive summation double counts', () => {
    // Fixture: the same 1000 units of liquidity exist pre-migration in the
    // launch pool and post-migration in the successor.
    const naiveSum = (
      m: Map<PoolId, { effectiveAt: ReturnType<typeof at> | null; value: bigint }[]>,
    ): bigint => {
      let total = 0n;
      for (const samples of m.values()) for (const s of samples) total += s.value;
      return total;
    };

    // Post-boundary snapshot: both pools still report the position.
    const overlapping = new Map([
      [pool('launch'), [{ effectiveAt: at('2026-01-01T14:00:00Z'), value: 1000n }]],
      [pool('successor'), [{ effectiveAt: at('2026-01-01T14:00:00Z'), value: 1000n }]],
    ]);
    expect(naiveSum(overlapping)).toBe(2000n); // double counts
    expect(aggregateWithoutDoubleCounting(overlapping, [e])).toBe(1000n); // launch side superseded

    // Pre-boundary launch activity still counts fully alongside the successor.
    const mixed = new Map([
      [pool('launch'), [{ effectiveAt: at('2026-01-01T11:00:00Z'), value: 500n }]],
      [pool('successor'), [{ effectiveAt: at('2026-01-01T13:00:00Z'), value: 700n }]],
    ]);
    expect(aggregateWithoutDoubleCounting(mixed, [e])).toBe(1200n);
  });

  it('refuses undated samples on migrated pools and ambiguous edges', () => {
    const undated = new Map([[pool('launch'), [{ effectiveAt: null, value: 5n }]]]);
    try {
      aggregateWithoutDoubleCounting(undated, [e]);
      expect.unreachable();
    } catch (err) {
      expect((err as ForesiftError).code).toBe(ErrorCode.IDENTITY_MIGRATION_EDGE_AMBIGUOUS);
    }
    const ambiguous: MigrationLineageEdge = { ...e, status: LineageStatus.AMBIGUOUS };
    try {
      aggregateWithoutDoubleCounting(new Map(), [ambiguous]);
      expect.unreachable();
    } catch (err) {
      expect((err as ForesiftError).code).toBe(ErrorCode.IDENTITY_MIGRATION_EDGE_AMBIGUOUS);
    }
  });

  it('detects lineage cycles before registration', () => {
    const cycle = [
      edge('a', 'p1', 'p2', '2026-01-01T00:00:00Z'),
      edge('b', 'p2', 'p1', '2026-01-02T00:00:00Z'),
    ];
    try {
      detectLineageCycles(cycle);
      expect.unreachable();
    } catch (err) {
      expect((err as ForesiftError).code).toBe(ErrorCode.IDENTITY_MIGRATION_EDGE_CYCLES);
    }
    detectLineageCycles([edge('c', 'p3', 'p4', '2026-01-01T00:00:00Z')]); // fine
  });
});

describe('source dependence inputs (FR-DATA-006, AC-245 substrate)', () => {
  it('flags strongly correlated pairs despite distinct provider ids', () => {
    const correlated = {
      valueErrorTimingCorrelation: 0.97,
      outageOverlap: 0.9,
      firstSeenLagAgreement: 0.95,
      fingerprintSimilarity: 0.99,
    };
    expect(inputsJustifyReducedIndependence(correlated)).toBe(true);
    const independent = {
      valueErrorTimingCorrelation: 0.1,
      outageOverlap: 0.02,
      firstSeenLagAgreement: 0.3,
      fingerprintSimilarity: 0.05,
    };
    expect(inputsJustifyReducedIndependence(independent)).toBe(false);
    expect(DEFAULT_DEPENDENCE_THRESHOLDS.correlation).toBeGreaterThan(0);
  });

  it('validates ranges fail-closed', () => {
    expect(() =>
      assertDependenceInputs({
        valueErrorTimingCorrelation: 1.5,
        outageOverlap: 0,
        firstSeenLagAgreement: 0,
        fingerprintSimilarity: 0,
      }),
    ).toThrowError(ForesiftError);
    expect(() =>
      assertDependenceInputs({
        valueErrorTimingCorrelation: NaN,
        outageOverlap: 0,
        firstSeenLagAgreement: 0,
        fingerprintSimilarity: 0,
      }),
    ).toThrowError(ForesiftError);
  });
});

describe('feature provenance substrate (FR-DATA-004, AC-244)', () => {
  const baseValue: FeatureValue = {
    definitionId: 'fd_liquidity' as FeatureValue['definitionId'],
    featureVersion: 2,
    computationCodeVersion: 'feat-calc@sha256:deadbeef',
    subjectKey: 'eip155:1:0xabc',
    eventAt: at('2026-01-01T00:00:00Z'),
    qualityCodes: [],
    populationProvenance: { populationKind: 'FULL_UNIVERSE', lineageRefs: ['obs-1'] },
    storeClass: 'ONLINE',
  };

  it('accepts full-universe values with complete provenance', () => {
    expect(supportsPopulationClaim(baseValue)).toBe(true);
  });

  it('refuses selectively-researched populations backing universe claims', () => {
    expect(
      supportsPopulationClaim({
        ...baseValue,
        populationProvenance: { populationKind: 'DEEP_RESEARCH_SELECTED', lineageRefs: ['obs-1'] },
      }),
    ).toBe(false);
  });

  it('refuses missing code-version provenance at the substrate level', () => {
    try {
      supportsPopulationClaim({ ...baseValue, computationCodeVersion: '' });
      expect.unreachable();
    } catch (e) {
      expect((e as ForesiftError).code).toBe(ErrorCode.FEATURE_PROVENANCE_INCOMPLETE);
    }
  });
});

describe('recovery tiers (FR-DR-001)', () => {
  it('enforces the FR-DR-001 (§34.4-bound) ceilings: ≤15 / ≤60 / ≤1440 minutes', () => {
    validateRecoveryTier({
      id: 't-meta' as never,
      dataClass: 'CRITICAL_METADATA',
      rpoTargetMinutes: 15,
      rtoTargetMinutes: 60,
    });
    expect(() =>
      validateRecoveryTier({
        id: 'bad' as never,
        dataClass: 'CRITICAL_METADATA',
        rpoTargetMinutes: 16,
        rtoTargetMinutes: 60,
      }),
    ).toThrowError(ErrorCode.RECOVERY_TIER_CEILING_EXCEEDED);
    expect(() =>
      validateRecoveryTier({
        id: 'bad2' as never,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 61,
        rtoTargetMinutes: 120,
      }),
    ).toThrowError(ForesiftError);
    validateRecoveryTier({
      id: 'raw' as never,
      dataClass: 'REPLAYABLE_RAW_PAYLOADS',
      rpoTargetMinutes: 1440,
      rtoTargetMinutes: 480,
    });
  });

  it('degraded states block opportunity influence but preserve risk monitoring', () => {
    const state = degradedHealthState(
      'observations',
      'INC-1',
      '2026-01-01T00:00:00Z',
      'RPO missed',
    );
    expect(state.kind).toBe('DEGRADED');
    expect(state.confirmedOpportunityInfluenceBlocked).toBe(true);
    expect(state.deterministicRiskMonitoringAllowed).toBe(true);
    expect(state.incidentId).toBe('INC-1');
  });
});

describe('clock port', () => {
  it('fixed and scripted clocks are deterministic', () => {
    const c = fixedClock(at('2026-03-04T05:06:07Z'));
    expect(c.now() as string).toBe('2026-03-04T05:06:07Z');
    expect(c.nowEpochMs()).toBe(Date.parse('2026-03-04T05:06:07Z'));

    const tl = ['2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', '2026-01-01T00:25:00Z'].map(at);
    const s = scriptedClock(tl);
    expect(s.clock.now()).toBe(tl[0]!);
    s.advance();
    expect(s.clock.now()).toBe(tl[1]!);
    s.advance();
    s.advance();
    expect(s.clock.now()).toBe(tl[2]!); // clamps to last entry
  });
});
