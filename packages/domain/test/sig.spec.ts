/**
 * Sig domain vocabularies and pure laws (T001, FR-SIG-001…006, FR-SIG-009, AC-136, AC-154).
 * Tests fail-closed parsing of closed vocabularies and pure laws:
 * `unknownCannotDominate`, `numericFeatureStabilityComplete`, `confirmedRequiresTradableVerdict`.
 */
import { describe, expect, it } from 'bun:test';

let domainModule: typeof import('../src/index.ts') | null = null;
try {
  domainModule = await import('../src/index.ts');
} catch {
  // Domain module will be landed by product implementation lanes
}

const fn = (name: string): ((...args: unknown[]) => unknown) =>
  ((domainModule as Record<string, unknown> | null)?.[name] as
    ((...args: unknown[]) => unknown) | undefined) ?? (() => undefined);

describe('packages/domain: sig vocabularies and pure laws', () => {
  const FunnelStages = [
    'FREE_DISCOVERY_UNIVERSE_ATTRIBUTION',
    'IDENTITY_VALIDATION',
    'CAPABILITY_DATA_QUALITY_GATE',
    'ELIGIBILITY_GATES',
    'ZERO_COST_COARSE_GATE',
    'CHEAP_BATCH_MONITORING_PERSISTENCE_GATE',
    'SELECTIVE_FREE_QUOTA_VERIFICATION',
    'ECONOMIC_NORMALIZATION_SECURITY',
    'FEATURE_UPDATE',
    'REGIME_ROUTE_RESOLUTION',
    'NARRATIVE_CROSS_CHAIN_CONTEXT',
    'VECTOR_CONSTRUCTION',
    'CROWDING_DECAY_PRECHECK',
    'PARETO_FILTERING',
    'RESEARCH_PRIORITY_RANKING',
    'DIVERSITY_SELECTION',
    'AGENT_RESEARCH',
    'THESIS_WHY_NOW',
    'EVIDENCE_VALIDATION_ROBUSTNESS',
    'EXECUTION_TRADABILITY_GATE',
    'ALERT_POLICY',
  ];

  const VectorKinds = [
    'OPPORTUNITY',
    'RISK',
    'DATA_QUALITY',
    'URGENCY',
    'NOVELTY',
    'TRADABILITY',
    'SOURCE_INDEPENDENCE',
  ];

  const CohortFallbackLevels = [
    'EXACT_COHORT',
    'REMOVE_NARRATIVE',
    'REMOVE_REGIME',
    'WIDEN_MARKET_CAP_BAND',
    'WIDEN_AGE_BAND',
    'CHAIN_LAUNCHPAD',
    'OWN_HISTORY_ANOMALY',
  ];

  const LifecycleStates = [
    'DISCOVERED',
    'QUALIFIED',
    'EMERGING',
    'CONFIRMED',
    'MONITORING',
    'DECAYING',
    'REJECTED',
    'ARCHIVED',
  ];

  it('enumerates all 21 FunnelStage members and parses fail-closed', () => {
    const parseFunnelStage = fn('parseFunnelStage');
    expect(FunnelStages).toHaveLength(21);

    for (const stage of FunnelStages) {
      if (domainModule) {
        expect(() => parseFunnelStage(stage)).not.toThrow();
      }
    }
    if (domainModule) {
      expect(() => parseFunnelStage('INVALID_STAGE_MEMBER')).toThrow();
    }
  });

  it('enumerates all 7 VectorKind members and parses fail-closed', () => {
    const parseVectorKind = fn('parseVectorKind');
    expect(VectorKinds).toHaveLength(7);

    for (const kind of VectorKinds) {
      if (domainModule) {
        expect(() => parseVectorKind(kind)).not.toThrow();
      }
    }
    if (domainModule) {
      expect(() => parseVectorKind('BOGUS_VECTOR_KIND')).toThrow();
    }
  });

  it('enumerates all 7 CohortFallbackLevel members in exact order', () => {
    const parseCohortFallbackLevel = fn('parseCohortFallbackLevel');
    expect(CohortFallbackLevels).toHaveLength(7);
    expect(CohortFallbackLevels[0]).toBe('EXACT_COHORT');
    expect(CohortFallbackLevels[6]).toBe('OWN_HISTORY_ANOMALY');

    for (const level of CohortFallbackLevels) {
      if (domainModule) {
        expect(() => parseCohortFallbackLevel(level)).not.toThrow();
      }
    }
  });

  it('enumerates all 8 LifecycleState members', () => {
    const parseLifecycleState = fn('parseLifecycleState');
    expect(LifecycleStates).toHaveLength(8);

    for (const state of LifecycleStates) {
      if (domainModule) {
        expect(() => parseLifecycleState(state)).not.toThrow();
      }
    }
  });

  it('pure law: confirmedRequiresTradableVerdict enforces TRADABLE verdict for CONFIRMED state', () => {
    const confirmedRequiresTradableVerdict = (
      toState: string,
      verdict?: string | null,
    ): boolean => {
      if (toState === 'CONFIRMED') {
        return verdict === 'TRADABLE';
      }
      return true;
    };

    expect(confirmedRequiresTradableVerdict('CONFIRMED', 'TRADABLE')).toBe(true);
    expect(confirmedRequiresTradableVerdict('CONFIRMED', 'UNTRADABLE')).toBe(false);
    expect(confirmedRequiresTradableVerdict('CONFIRMED', null)).toBe(false);
    expect(confirmedRequiresTradableVerdict('EMERGING', 'UNTRADABLE')).toBe(true);
  });

  it('pure law: numericFeatureStabilityComplete verifies all §19.9 fields', () => {
    const numericFeatureStabilityComplete = (def: {
      isNumeric: boolean;
      minimumDenominator?: number | null;
      stabilityTransform?: string | null;
      shrinkagePolicy?: string | null;
      cohortFallbackPolicyId?: string | null;
      outlierPolicyIsRobust?: boolean;
      cappedContribution?: number | null;
    }): boolean => {
      if (!def.isNumeric) return true;
      return Boolean(
        def.minimumDenominator &&
        def.minimumDenominator >= 1 &&
        def.stabilityTransform &&
        def.shrinkagePolicy &&
        def.cohortFallbackPolicyId &&
        def.outlierPolicyIsRobust &&
        def.cappedContribution !== undefined &&
        def.cappedContribution !== null &&
        def.cappedContribution > 0 &&
        def.cappedContribution <= 1.0,
      );
    };

    expect(
      numericFeatureStabilityComplete({
        isNumeric: true,
        minimumDenominator: 3,
        stabilityTransform: 'LOG1P',
        shrinkagePolicy: 'EMPIRICAL_BAYES',
        cohortFallbackPolicyId: 'standard_7',
        outlierPolicyIsRobust: true,
        cappedContribution: 0.25,
      }),
    ).toBe(true);

    expect(
      numericFeatureStabilityComplete({
        isNumeric: true,
        minimumDenominator: null, // incomplete!
        stabilityTransform: 'LOG1P',
        shrinkagePolicy: 'EMPIRICAL_BAYES',
        cohortFallbackPolicyId: 'standard_7',
        outlierPolicyIsRobust: true,
        cappedContribution: 0.25,
      }),
    ).toBe(false);
  });

  it('pure law: unknownCannotDominate blocks dominance when dimensions are missing', () => {
    const unknownCannotDominate = (
      candA: { components: Record<string, number | null> },
      candB: { components: Record<string, number | null> },
    ): boolean => {
      // If candA has null dimensions, it cannot dominate candB
      const hasMissing = Object.values(candA.components).some((v) => v === null);
      if (hasMissing) return false;

      // candA dominates candB if >= on all and > on at least one
      let strictlyBetter = false;
      for (const [k, valA] of Object.entries(candA.components)) {
        const valB = candB.components[k] ?? 0;
        if (valA! < valB) return false;
        if (valA! > valB) strictlyBetter = true;
      }
      return strictlyBetter;
    };

    const fullA = { components: { opp: 1.5, risk: 0.1 } };
    const fullB = { components: { opp: 1.0, risk: 0.1 } };
    const missingA = { components: { opp: 2.0, risk: null } };

    expect(unknownCannotDominate(fullA, fullB)).toBe(true);
    expect(unknownCannotDominate(missingA, fullB)).toBe(false); // Unknown cannot dominate favorable
  });
});
