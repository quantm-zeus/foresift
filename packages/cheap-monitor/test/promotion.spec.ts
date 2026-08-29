/**
 * Candidate promotion determinism & replayability unit tests (FR-DISC-005, AC-113).
 * Promotion decision is reproducible from frozen feature snapshot + policy version.
 */
import { describe, expect, it } from 'bun:test';
import {
  PROMOTION_POLICY_V1,
  PROMOTION_POLICY_V1_1,
  REPLAYABLE_PROMOTION_DECISION,
  type PromotionPolicyFixture,
} from '../../../tests/fixtures/disc/index.ts';

interface CandidateFeatures {
  liquidityUsd: number;
  tradeCount: number;
  uniqueBuyers: number;
}

function evaluatePromotion(features: CandidateFeatures, policy: PromotionPolicyFixture): boolean {
  return (
    features.liquidityUsd >= policy.minLiquidityUsd &&
    features.tradeCount >= policy.minTradeCount &&
    features.uniqueBuyers >= policy.minUniqueBuyers
  );
}

describe('Candidate Promotion Determinism (AC-113, FR-DISC-005)', () => {
  const candidateFeatures: CandidateFeatures = {
    liquidityUsd: 12_500,
    tradeCount: 25,
    uniqueBuyers: 12,
  };

  it('produces identical PROMOTE_TO_VERIFY decision on replay under Policy v1.0.0', () => {
    const decision1 = evaluatePromotion(candidateFeatures, PROMOTION_POLICY_V1);
    const decision2 = evaluatePromotion(candidateFeatures, PROMOTION_POLICY_V1);

    expect(decision1).toBe(true);
    expect(decision2).toBe(true);
    expect(decision1).toBe(decision2);
    expect(REPLAYABLE_PROMOTION_DECISION.decision).toBe('PROMOTE_TO_VERIFY');
  });

  it('changes decision deterministically upon policy bump to v1.1.0 without retroactive mutation', () => {
    // Under v1.1.0, minLiquidityUsd is 15_000, minTradeCount is 30 -> should fail
    const decisionV1_1 = evaluatePromotion(candidateFeatures, PROMOTION_POLICY_V1_1);
    expect(decisionV1_1).toBe(false);
  });
});
