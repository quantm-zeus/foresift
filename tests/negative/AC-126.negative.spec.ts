/**
 * AC-126 negative (failure) — tradable success from below-floor-resolution snapshot is refused.
 * Traces: FR-EXEC-004, FR-EXEC-011, FR-MAT-001, FR-EVAL-001, AC-126.
 * Refusal: Attempting to prove TRADABLE_SUCCESS from a snapshot below the required resolution floor without an active plan is refused.
 *
 * Facet convention:
 * 1. Base execution refusal: tradable success from below-floor snapshot throws.
 * 2. Evaluation replay refusal (FR-MAT-001, FR-EVAL-001): evaluation replay refuses coarse candles as promotion evidence.
 */
import { describe, expect, it } from 'bun:test';

function assertResolutionFloorForTradability(params: {
  snapshotIntervalSeconds: number;
  resolutionFloorSeconds: number;
  hasObservationPlan: boolean;
  proposedOutcome: string;
}) {
  const isBelowFloor = params.snapshotIntervalSeconds > params.resolutionFloorSeconds;
  if (isBelowFloor && !params.hasObservationPlan && params.proposedOutcome === 'TRADABLE_SUCCESS') {
    throw new Error('TRADABLE_SUCCESS_BELOW_RESOLUTION_FLOOR_REFUSED');
  }
  return true;
}

function validateEvaluationReplayResolution(item: { isCoarse: boolean; isTradableSuccessClaim: boolean }) {
  if (item.isCoarse && item.isTradableSuccessClaim) {
    throw new Error('COARSE_EVALUATION_CANNOT_CLAIM_TRADABLE_SUCCESS');
  }
  return true;
}

describe('AC-126 negative: tradable success from below-floor resolution snapshot refused', () => {
  it('throws when proposing TRADABLE_SUCCESS on 15m coarse candle without observation plan', () => {
    expect(() =>
      assertResolutionFloorForTradability({
        snapshotIntervalSeconds: 900,
        resolutionFloorSeconds: 1,
        hasObservationPlan: false,
        proposedOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('TRADABLE_SUCCESS_BELOW_RESOLUTION_FLOOR_REFUSED');
  });

  it('throws when proposing TRADABLE_SUCCESS on 1m candle without sub-interval liquidity observation', () => {
    expect(() =>
      assertResolutionFloorForTradability({
        snapshotIntervalSeconds: 60,
        resolutionFloorSeconds: 1,
        hasObservationPlan: false,
        proposedOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('TRADABLE_SUCCESS_BELOW_RESOLUTION_FLOOR_REFUSED');
  });
});

describe('AC-126 negative — evaluation replay refusal facet (FR-MAT-001, FR-EVAL-001)', () => {
  it('throws when evaluation replay attempts to score coarse candle as tradable win', () => {
    expect(() =>
      validateEvaluationReplayResolution({
        isCoarse: true,
        isTradableSuccessClaim: true,
      }),
    ).toThrow('COARSE_EVALUATION_CANNOT_CLAIM_TRADABLE_SUCCESS');
  });
});
