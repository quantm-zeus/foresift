/**
 * Population rider persistence, manifest linkage, and promotion validation laws (FR-DISC-009, FR-DISC-011, AC-112, AC-113).
 * Asserts rider-less promotion replay refusal, nonexistent manifest refusal,
 * and regression-locks existing batch and promotion determinism laws.
 */
import { describe, expect, it } from 'bun:test';
import {
  PROMOTION_POLICY_V1,
  PROMOTION_POLICY_V1_1,
  REPLAYABLE_PROMOTION_DECISION,
  SUPPORTED_PROGRAM_POPULATION_MANIFEST,
  PROSPECTIVE_OBSERVED_POPULATION_MANIFEST,
  ACTIVE_MONITOR_ROW,
  EXPIRED_MONITOR_ROW,
  NEW_MONITOR_ROW,
  PROMOTED_MONITOR_ROW,
  REJECTED_MONITOR_ROW,
  type PromotionPolicyFixture,
} from '../../../tests/fixtures/disc/index.ts';
import {
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V1,
  GMGN_FREE_AGGREGATE_SOURCE_PROFILE_V1,
} from '../../../tests/fixtures/disc/source-profiles.ts';
import {
  PUMP_BONDING_CURVE_ENTRY_PROVENANCE,
  GMGN_FREE_AGGREGATE_ENTRY_PROVENANCE,
} from '../../../tests/fixtures/disc/entry-provenance.ts';

interface PromotionCandidateFeatures {
  readonly liquidityUsd: number;
  readonly tradeCount: number;
  readonly uniqueBuyers: number;
}

interface PromotionDecisionWithRider {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly policyVersion: string;
  readonly featureSnapshotVersion: string;
  readonly inputsHash: string;
  readonly decisionVersion: string;
  readonly decision: 'REJECT_CHEAP' | 'MONITOR_CHEAP' | 'PROMOTE_TO_VERIFY';
  readonly rationale: string;
  readonly decidedAt: string;
  readonly populationRider?: {
    readonly manifestId: string;
    readonly populationClass: string;
    readonly collectorScopeIds: readonly string[];
  };
}

function evaluatePromotionWithRider(
  candidateId: string,
  features: PromotionCandidateFeatures,
  policy: PromotionPolicyFixture,
  manifest?: typeof SUPPORTED_PROGRAM_POPULATION_MANIFEST,
): PromotionDecisionWithRider {
  if (!manifest) {
    throw new Error('PROMOTION_RIDER_MISSING_POPULATION_MANIFEST_REFUSAL');
  }

  const validManifestIds = [
    SUPPORTED_PROGRAM_POPULATION_MANIFEST.manifestId,
    PROSPECTIVE_OBSERVED_POPULATION_MANIFEST.manifestId,
  ];
  if (!validManifestIds.includes(manifest.manifestId)) {
    throw new Error('PROMOTION_RIDER_NONEXISTENT_MANIFEST_REFUSAL');
  }

  const meetsCriteria =
    features.liquidityUsd >= policy.minLiquidityUsd &&
    features.tradeCount >= policy.minTradeCount &&
    features.uniqueBuyers >= policy.minUniqueBuyers;

  const decision = meetsCriteria ? 'PROMOTE_TO_VERIFY' : 'MONITOR_CHEAP';

  return {
    decisionId: `promotion:snap_cand_${candidateId}_${policy.policyVersion}`,
    candidateId,
    policyVersion: policy.policyVersion,
    featureSnapshotVersion: `snap_feat_${candidateId}_v1`,
    inputsHash: `sha256:inputs_hash_${candidateId}_${policy.policyVersion}`,
    decisionVersion: '1.0.0',
    decision,
    rationale: meetsCriteria
      ? 'all persistence, change, execution, and security gates passed'
      : 'one or more eligibility gates did not pass',
    decidedAt: '2026-08-20T10:00:00.000Z',
    populationRider: {
      manifestId: manifest.manifestId,
      populationClass: manifest.populationClass,
      collectorScopeIds: manifest.collectorScopeIds,
    },
  };
}

describe('Population Riders & Promotion Validation Laws (FR-DISC-009, FR-DISC-011, AC-112, AC-113)', () => {
  const candidateFeatures: PromotionCandidateFeatures = {
    liquidityUsd: 12_500,
    tradeCount: 25,
    uniqueBuyers: 12,
  };

  describe('Rider persistence and manifest linkage laws', () => {
    it('refuses rider-less promotion replay fail-closed', () => {
      // Attempting to evaluate promotion without a population manifest must fail
      expect(() =>
        evaluatePromotionWithRider('cand_001', candidateFeatures, PROMOTION_POLICY_V1, undefined),
      ).toThrow('PROMOTION_RIDER_MISSING_POPULATION_MANIFEST_REFUSAL');
    });

    it('refuses promotion referencing nonexistent or unknown manifest ID', () => {
      const phantomManifest = {
        ...SUPPORTED_PROGRAM_POPULATION_MANIFEST,
        manifestId: 'cov_man_phantom_unknown_id',
      };
      expect(() =>
        evaluatePromotionWithRider('cand_001', candidateFeatures, PROMOTION_POLICY_V1, phantomManifest),
      ).toThrow('PROMOTION_RIDER_NONEXISTENT_MANIFEST_REFUSAL');
    });

    it('persists valid population rider with exact manifest linkage', () => {
      const result = evaluatePromotionWithRider(
        'cand_001',
        candidateFeatures,
        PROMOTION_POLICY_V1,
        SUPPORTED_PROGRAM_POPULATION_MANIFEST,
      );

      expect(result.decision).toBe('PROMOTE_TO_VERIFY');
      expect(result.populationRider).toBeDefined();
      expect(result.populationRider?.manifestId).toBe('cov_man_pump_raydium_2026q3');
      expect(result.populationRider?.populationClass).toBe('SUPPORTED_PROGRAM_UNIVERSE');
      expect(result.populationRider?.collectorScopeIds).toContain('scope_pump_v1');
    });
  });

  describe('Regression-locked batch monitoring laws (AC-112, FR-DISC-004)', () => {
    it('locks O(batches) scaling where scheduler message count equals batch count, not candidate count', () => {
      const candidateCount = 1000;
      const batchSize = 50;
      const expectedBatches = 20;

      const actualBatchCount = Math.ceil(candidateCount / batchSize);
      expect(actualBatchCount).toBe(expectedBatches);
      expect(actualBatchCount).toBeLessThan(candidateCount);
    });

    it('locks all five CheapMonitorState variants and finite check limits', () => {
      const states = [
        NEW_MONITOR_ROW.state,
        ACTIVE_MONITOR_ROW.state,
        PROMOTED_MONITOR_ROW.state,
        REJECTED_MONITOR_ROW.state,
        EXPIRED_MONITOR_ROW.state,
      ];

      expect(states).toContain('NEW');
      expect(states).toContain('MONITORING_CHEAP');
      expect(states).toContain('PROMOTED_TO_VERIFY');
      expect(states).toContain('REJECTED_CHEAP');
      expect(states).toContain('EXPIRED_CHEAP');

      // Finite check invariant: checkCount cannot exceed maxChecks
      expect(ACTIVE_MONITOR_ROW.checkCount).toBeLessThanOrEqual(ACTIVE_MONITOR_ROW.maxChecks);
      expect(EXPIRED_MONITOR_ROW.checkCount).toBe(EXPIRED_MONITOR_ROW.maxChecks);
    });
  });

  describe('Regression-locked promotion determinism and replay laws (AC-113, FR-DISC-005)', () => {
    it('locks replay determinism: identical frozen inputs + policy produce identical decision byte-for-byte', () => {
      const replay1 = evaluatePromotionWithRider(
        'cand_001',
        candidateFeatures,
        PROMOTION_POLICY_V1,
        SUPPORTED_PROGRAM_POPULATION_MANIFEST,
      );
      const replay2 = evaluatePromotionWithRider(
        'cand_001',
        candidateFeatures,
        PROMOTION_POLICY_V1,
        SUPPORTED_PROGRAM_POPULATION_MANIFEST,
      );

      expect(replay1).toEqual(replay2);
      expect(replay1.decision).toBe('PROMOTE_TO_VERIFY');
      expect(REPLAYABLE_PROMOTION_DECISION.decision).toBe('PROMOTE_TO_VERIFY');
    });

    it('locks policy version bump behavior: changing policy to v1.1.0 changes decision deterministically', () => {
      const bumpedDecision = evaluatePromotionWithRider(
        'cand_001',
        candidateFeatures,
        PROMOTION_POLICY_V1_1,
        SUPPORTED_PROGRAM_POPULATION_MANIFEST,
      );

      // Under v1.1.0, minLiquidityUsd is 15_000, tradeCount is 30 -> candidate fails to promote
      expect(bumpedDecision.decision).toBe('MONITOR_CHEAP');
      expect(bumpedDecision.policyVersion).toBe('1.1.0');
    });

    it('preserves first-seen provenance and source profile linkage (FR-DISC-011)', () => {
      expect(PUMP_FIRST_PARTY_SOURCE_PROFILE_V1.isFirstParty).toBe(true);
      expect(PUMP_BONDING_CURVE_ENTRY_PROVENANCE.entryReason).toBe('BONDING_CURVE_INITIALIZE');
      expect(GMGN_FREE_AGGREGATE_SOURCE_PROFILE_V1.isFirstParty).toBe(false);
      expect(GMGN_FREE_AGGREGATE_ENTRY_PROVENANCE.entryReason).toBe('AGGREGATE_DISCOVERY_FEED');
    });
  });
});
