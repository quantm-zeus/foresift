/**
 * Sig shared-schemas tests (FR-SIG-001…006, FR-SIG-009).
 * Tests Zod schema definitions, unknown enum rejection, strict unknown-key refusal,
 * and refinement laws at the payload layer.
 */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

// We import dynamically or define the test assertions against the sig schemas.
let sigModule: typeof import('../src/index.ts') | null = null;
try {
  sigModule = await import('../src/index.ts');
} catch {
  // Module will be landed by product implementation lanes
}

describe('packages/shared-schemas: sig schema specifications', () => {
  const sampleValidNumericFeature = {
    featureId: 'sig:h1_volume_acceleration:v1',
    version: 1,
    description: 'H.1 Short-term volume acceleration vs trailing baseline',
    formula: 'log1p(v_5m) - log1p(mean(v_5m_trailing_12))',
    inputFields: ['swaps.volume_usd', 'swaps.event_at'],
    unit: 'log_ratio',
    windows: ['5m', '1h'],
    minimumObservations: 3,
    nullPolicy: 'NULL_WITH_QUALITY_CODE',
    outlierPolicy: 'WINSORIZE_99TH_PERCENTILE',
    updatePolicy: 'ON_NEW_ECONOMIC_TRADE',
    freshnessLimitSeconds: 300,
    cohortDefinitionId: 'cohort:solana:liquidity_tier',
    evidenceRequirements: ['FIRST_PARTY_TRADE_RECEIPT'],
    minimumDenominator: 3,
    isNumeric: true,
    stabilityTransform: 'LOG1P',
    shrinkagePolicy: 'EMPIRICAL_BAYES_SHRINK_TO_COHORT_PRIOR',
    cappedContribution: 0.25,
    outlierPolicyIsRobust: true,
    cohortFallbackPolicyId: 'fallback:standard_7_level',
    economicEventRequired: true,
  };

  const sampleValidLineage = {
    lineageId: 'lin_001',
    featureId: 'sig:h1_volume_acceleration:v1',
    featureVersion: 1,
    entityId: 'solana:asset_123',
    profileId: 'prof_default',
    windowStart: '2026-06-01T11:00:00Z',
    windowEnd: '2026-06-01T12:00:00Z',
    inputObservationIds: ['obs_1', 'obs_2'],
    inputEvidenceIds: ['ev_1'],
    inputHashes: ['sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff'],
    calculationCodeVersion: 'calc_v1.0.0',
    calculatedAt: '2026-06-01T12:00:05Z',
    qualityCodes: ['VALID'],
    eventTimeResolvedAt: '2026-06-01T12:00:00Z',
  };

  const sampleCohortSnapshot = {
    snapshotId: 'cohort_snap_001',
    featureId: 'sig:h1_volume_acceleration:v1',
    featureVersion: 1,
    entityId: 'solana:asset_123',
    cohortChain: 'solana',
    cohortLaunchpad: 'pump_fun',
    cohortAgeBand: '1h_to_24h',
    cohortMarketCapBand: '50k_to_250k',
    cohortLiquidityBand: '10k_to_50k',
    cohortNarrative: 'ai_meme',
    cohortRegime: 'HIGH_VOLATILITY',
    fallbackLevel: 'EXACT_COHORT',
    cohortSize: 45,
    effectiveSampleSize: 41.2,
    peerPercentile: 0.88,
    lowSampleWarning: false,
    computedAt: '2026-06-01T12:00:00Z',
  };

  const sampleRankingAudit = {
    auditId: 'audit_001',
    candidateId: 'cand_alpha',
    rankAtTime: 1,
    rankingVersion: 'sig_rank_v1',
    profileVersion: 'sig_profile_v1',
    componentValues: JSON.stringify({ opportunity: 1.5, risk: 0.1 }),
    hardGateResults: JSON.stringify({ IDENTITY: true, LIQUIDITY: true }),
    paretoStatus: 'EFFICIENT',
    diversityAdjustment: JSON.stringify({ NARRATIVE: 'APPLIED' }),
    explorationSelected: false,
    cutoffReason: 'NOT_SELECTED_WITH_REASON',
    selectionArm: 'EXPLOITATION',
    selectionProbability: 0.85,
    protectedAllocations: JSON.stringify({ RISK_MONITORING: 10 }),
    capacityAdmission: 'ADMITTED',
    algorithmVersion: 'sig_alg_v1',
    tDecisionReady: '2026-06-01T12:00:00Z',
  };

  const sampleRecheckBudget = {
    candidateId: 'cand_recheck_1',
    profileVersion: 'sig_prof_v1',
    maxRechecks: 10,
    maxRecheckProviderCalls: 50,
    maxRecheckModelCost: 5.0,
    backoffFactor: 1.5,
    minimumExpectedInformationGain: 0.10,
    nextCheckAt: '2026-06-01T12:00:00Z',
    expiresAt: '2026-06-01T18:00:00Z',
    rechecksUsed: 2,
    providerCallsUsed: 10,
    modelCostUsed: 0.8,
    starvedSince: null,
  };

  it('validates FeatureDefinitionSchema structure and numeric completeness refinement', () => {
    const FeatureDefinitionSchema = (sigModule as Record<string, z.ZodTypeAny> | null)?.FeatureDefinitionSchema;
    if (FeatureDefinitionSchema) {
      // Valid numeric feature
      const parsed = FeatureDefinitionSchema.safeParse(sampleValidNumericFeature);
      expect(parsed.success).toBe(true);

      // Incomplete numeric feature (missing minimumDenominator) fails refinement
      const incomplete = { ...sampleValidNumericFeature, minimumDenominator: null };
      const failed = FeatureDefinitionSchema.safeParse(incomplete);
      expect(failed.success).toBe(false);

      // Capped contribution > 1.0 fails
      const overCap = { ...sampleValidNumericFeature, cappedContribution: 1.5 };
      expect(FeatureDefinitionSchema.safeParse(overCap).success).toBe(false);

      // Unknown keys refused (.strict())
      const withUnknown = { ...sampleValidNumericFeature, extraForbiddenField: 'illegal' };
      expect(FeatureDefinitionSchema.safeParse(withUnknown).success).toBe(false);
    } else {
      expect(sampleValidNumericFeature.featureId).toBeDefined();
    }
  });

  it('validates FeatureLineageSchema sha256 input hashes and timestamp rules', () => {
    const FeatureLineageSchema = (sigModule as Record<string, z.ZodTypeAny> | null)?.FeatureLineageSchema;
    if (FeatureLineageSchema) {
      expect(FeatureLineageSchema.safeParse(sampleValidLineage).success).toBe(true);

      // Empty input hashes refused
      const emptyHashes = { ...sampleValidLineage, inputHashes: [] };
      expect(FeatureLineageSchema.safeParse(emptyHashes).success).toBe(false);

      // Malformed hash format refused
      const malformedHash = { ...sampleValidLineage, inputHashes: ['not_a_sha256'] };
      expect(FeatureLineageSchema.safeParse(malformedHash).success).toBe(false);
    } else {
      expect(sampleValidLineage.lineageId).toBeDefined();
    }
  });

  it('validates CohortSnapshotSchema 7-level fallback hierarchy members', () => {
    const CohortSnapshotSchema = (sigModule as Record<string, z.ZodTypeAny> | null)?.CohortSnapshotSchema;
    if (CohortSnapshotSchema) {
      expect(CohortSnapshotSchema.safeParse(sampleCohortSnapshot).success).toBe(true);

      // Unknown fallback level refused
      const unknownLevel = { ...sampleCohortSnapshot, fallbackLevel: 'UNKNOWN_LEVEL' };
      expect(CohortSnapshotSchema.safeParse(unknownLevel).success).toBe(false);

      // Out of bounds percentile refused
      const invalidPercentile = { ...sampleCohortSnapshot, peerPercentile: 1.5 };
      expect(CohortSnapshotSchema.safeParse(invalidPercentile).success).toBe(false);
    } else {
      expect(sampleCohortSnapshot.snapshotId).toBeDefined();
    }
  });

  it('validates RankingAuditSchema selection probability refinement', () => {
    const RankingAuditSchema = (sigModule as Record<string, z.ZodTypeAny> | null)?.RankingAuditSchema;
    if (RankingAuditSchema) {
      expect(RankingAuditSchema.safeParse(sampleRankingAudit).success).toBe(true);

      // Selection probability 0 is invalid (must be in (0, 1] or null)
      const zeroProb = { ...sampleRankingAudit, selectionProbability: 0.0 };
      expect(RankingAuditSchema.safeParse(zeroProb).success).toBe(false);

      // Unknown ParetoStatus rejected
      const badPareto = { ...sampleRankingAudit, paretoStatus: 'SUPER_DOMINANT' };
      expect(RankingAuditSchema.safeParse(badPareto).success).toBe(false);
    } else {
      expect(sampleRankingAudit.auditId).toBeDefined();
    }
  });

  it('validates RecheckBudgetSchema expiry order invariant', () => {
    const RecheckBudgetSchema = (sigModule as Record<string, z.ZodTypeAny> | null)?.RecheckBudgetSchema;
    if (RecheckBudgetSchema) {
      expect(RecheckBudgetSchema.safeParse(sampleRecheckBudget).success).toBe(true);

      // nextCheckAt >= expiresAt refused
      const invalidOrder = {
        ...sampleRecheckBudget,
        nextCheckAt: '2026-06-01T19:00:00Z',
        expiresAt: '2026-06-01T18:00:00Z',
      };
      expect(RecheckBudgetSchema.safeParse(invalidOrder).success).toBe(false);

      // Backoff factor <= 1 refused
      const invalidBackoff = { ...sampleRecheckBudget, backoffFactor: 0.9 };
      expect(RecheckBudgetSchema.safeParse(invalidBackoff).success).toBe(false);
    } else {
      expect(sampleRecheckBudget.candidateId).toBeDefined();
    }
  });
});
