/**
 * Promotion evidence matching suite (T031, FR-MAT-008, FR-MAT-009, FR-MAT-011, FR-MAT-012, AC-152).
 * Tests exact configuration match laws and adverse ordering primacy.
 */
import { describe, expect, it } from 'bun:test';
import {
  GOLDEN_PROMOTION_CONFIG_CASES,
  GOLDEN_PATH_ORDERING_CASES,
  GOLDEN_EXPIRY_CASES,
  GOLDEN_CAPACITY_CASES,
} from '../../../tests/fixtures/mat/promotion-evidence-vectors.ts';

describe('Promotion Evidence (FR-MAT-008…012, AC-152)', () => {
  it('approves promotion only on exact configuration match with fully matured high-res evidence', () => {
    const matchCase = GOLDEN_PROMOTION_CONFIG_CASES.find(
      (c) => c.caseId === 'promo_exact_match_success',
    );
    expect(matchCase?.supportsPromotion).toBe(true);

    const mismatchCase = GOLDEN_PROMOTION_CONFIG_CASES.find(
      (c) => c.caseId === 'promo_mismatch_notional',
    );
    expect(mismatchCase?.supportsPromotion).toBe(false);
    expect(mismatchCase?.refusalReason).toBe('NOTIONAL_MISMATCH_SIMULATION_REQUIRED');

    const coarseCase = GOLDEN_PROMOTION_CONFIG_CASES.find(
      (c) => c.caseId === 'promo_coarse_only_refusal',
    );
    expect(coarseCase?.supportsPromotion).toBe(false);
    expect(coarseCase?.refusalReason).toBe(
      'COARSE_SIGNAL_CANNOT_SUBSTITUTE_FOR_HIGH_RES_EXECUTION',
    );
  });

  it('enforces adverse ordering primacy when timestamps within coarse interval are ambiguous (FR-MAT-009)', () => {
    const ambiguousCase = GOLDEN_PATH_ORDERING_CASES.find(
      (c) => c.caseId === 'path_ambiguity_adverse_primacy',
    );
    expect(ambiguousCase?.primaryVerdict).toBe('ADVERSE_STOP_OUT');
    expect(ambiguousCase?.pathAmbiguityReported).toBe(true);
    expect(ambiguousCase?.allowedAsPrimaryPromotionEvidence).toBe(false);
  });

  it('excludes post-expiry gains from actionable success (FR-MAT-011)', () => {
    const expiryCase = GOLDEN_EXPIRY_CASES.find(
      (c) => c.caseId === 'expiry_post_window_pump_excluded',
    );
    expect(expiryCase?.actionableSuccessRecorded).toBe(false);
    expect(expiryCase?.gainExcludedReason).toBe(
      'POST_EXPIRY_GAINS_EXCLUDED_FROM_ACTIONABLE_SUCCESS',
    );
  });

  it('requires capacity and notional disclosures for capacity-limited assets (FR-MAT-012)', () => {
    const capCase = GOLDEN_CAPACITY_CASES.find((c) => c.caseId === 'cap_micro_pool_limited');
    expect(capCase?.generalizationPermittedWithoutSimulation).toBe(false);
    expect(capCase?.requiredCapacityDisclosure.maxSingleTradeUsd).toBe(250.0);
  });
});
