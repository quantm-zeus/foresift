/**
 * Confidence intervals and correlated uncertainty suite (T031, FR-MAT-005, AC-151).
 * Tests naive vs clustered interval divergence and ESS promotion gating.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_INTERVAL_CASES } from '../../../tests/fixtures/eval/intervals-vectors.ts';

describe('Confidence Intervals and Correlated Uncertainty (FR-MAT-005, AC-151)', () => {
  it('detects significant divergence between naive and clustered confidence intervals on correlated groups', () => {
    const correlatedCase = GOLDEN_INTERVAL_CASES.find((c) => c.caseId === 'int_correlated_deployer_clusters');
    expect(correlatedCase).toBeDefined();
    if (!correlatedCase) return;

    expect(correlatedCase.clusteredMetrics.ciWidth).toBeGreaterThan(correlatedCase.naiveMetrics.ciWidth * 2);
    expect(correlatedCase.divergenceFactor).toBeGreaterThan(3.0);
    expect(correlatedCase.passesEssPromotionGate).toBe(false);
    expect(correlatedCase.promotionRefusalReason).toBe('INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE_FOR_PROMOTION_CLAIM');
  });

  it('approves promotion gate when effective sample size meets threshold on independent tokens', () => {
    const independentCase = GOLDEN_INTERVAL_CASES.find((c) => c.caseId === 'int_high_ess_independent_clusters');
    expect(independentCase).toBeDefined();
    if (!independentCase) return;

    expect(independentCase.clusteredMetrics.effectiveSampleSize).toBeGreaterThanOrEqual(independentCase.minRequiredEssForPromotion);
    expect(independentCase.passesEssPromotionGate).toBe(true);
  });
});
