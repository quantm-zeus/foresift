import {
  hasApprovedMarketCapFallback,
  lowConfidenceMarketCapMayHardReject,
  type MarketCapFallbackAvailability,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export type SupplyFallbackOutcome =
  | 'MARKET_CAP_ACCEPTED'
  | 'APPROVED_FALLBACK_USED'
  | 'HARD_REJECTED';

export interface SupplyFallbackDecisionInput extends MarketCapFallbackAvailability {
  readonly decisionId: string;
  readonly assessmentId: string;
  readonly decidedAt: UtcTimestamp;
  readonly policyVersion: string;
}

export interface SupplyFallbackDecision {
  readonly outcome: SupplyFallbackOutcome;
  readonly reason: string;
}

/** Evaluate and persist in one operation: no gate outcome exists only in memory. */
export async function decideMarketCapFallback(
  engine: DatabaseEngine,
  input: SupplyFallbackDecisionInput,
): Promise<SupplyFallbackDecision> {
  const lowConfidence = input.marketCapConfidence < input.minimumConfidence;
  let decision: SupplyFallbackDecision;
  if (!lowConfidence) {
    decision = { outcome: 'MARKET_CAP_ACCEPTED', reason: 'MARKET_CAP_CONFIDENCE_SUFFICIENT' };
  } else if (hasApprovedMarketCapFallback(input)) {
    if (lowConfidenceMarketCapMayHardReject(input))
      throw new Error('domain fallback predicate contradicted approved fallback availability');
    decision = { outcome: 'APPROVED_FALLBACK_USED', reason: 'LOW_CONFIDENCE_MARKET_CAP_FALLBACK_AVAILABLE' };
  } else {
    decision = { outcome: 'HARD_REJECTED', reason: 'LOW_CONFIDENCE_MARKET_CAP_NO_APPROVED_FALLBACK' };
  }
  await engine.query(
    `INSERT INTO supply_fallback_decisions (
       decision_id, assessment_id, market_cap_confidence, minimum_confidence,
       approved_liquidity_fallback, approved_activity_fallback, outcome,
       reason, decided_at, policy_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [input.decisionId, input.assessmentId, input.marketCapConfidence, input.minimumConfidence,
      input.approvedLiquidityFallback, input.approvedActivityFallback, decision.outcome,
      decision.reason, input.decidedAt, input.policyVersion],
  );
  return decision;
}
