import type { UtcTimestamp } from '@foresift/domain';

export interface PromotionPolicyFixture {
  readonly policyVersion: string;
  readonly minLiquidityUsd: number;
  readonly minTradeCount: number;
  readonly minUniqueBuyers: number;
  readonly maxAgeSeconds: number;
  readonly requiredFeatureVersions: readonly string[];
}

export interface PromotionDecisionFixture {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly policyVersion: string;
  readonly featureSnapshotVersion: string;
  readonly inputsHash: string;
  readonly decisionVersion: string;
  readonly decision: 'PROMOTE_TO_VERIFY' | 'MONITOR_CHEAP' | 'REJECT_CHEAP';
  readonly rationale: string;
  readonly decidedAt: UtcTimestamp;
}

export const PROMOTION_POLICY_V1: PromotionPolicyFixture = {
  policyVersion: '1.0.0',
  minLiquidityUsd: 10_000,
  minTradeCount: 20,
  minUniqueBuyers: 10,
  maxAgeSeconds: 3600,
  requiredFeatureVersions: ['feat_liquidity_v1', 'feat_traders_v1'],
};

export const PROMOTION_POLICY_V1_1: PromotionPolicyFixture = {
  policyVersion: '1.1.0',
  minLiquidityUsd: 15_000,
  minTradeCount: 30,
  minUniqueBuyers: 15,
  maxAgeSeconds: 3600,
  requiredFeatureVersions: ['feat_liquidity_v1', 'feat_traders_v1'],
};

export const REPLAYABLE_PROMOTION_DECISION: PromotionDecisionFixture = {
  decisionId: 'dec_promo_001',
  candidateId: 'cand_disc_003',
  policyVersion: '1.0.0',
  featureSnapshotVersion: 'snap_feat_cand_003_v1',
  inputsHash: 'sha256:inputs_hash_frozen_cand_003',
  decisionVersion: '1.0.0',
  decision: 'PROMOTE_TO_VERIFY',
  rationale: 'Liquidity $12,500 >= $10,000, tradeCount 25 >= 20, uniqueBuyers 12 >= 10',
  decidedAt: '2026-08-20T10:02:00.000Z' as UtcTimestamp,
};
