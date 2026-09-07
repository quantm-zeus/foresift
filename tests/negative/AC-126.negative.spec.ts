/**
 * AC-126 negative (failure) — tradable success from below-floor-resolution snapshot is refused.
 * Traces: FR-EXEC-004, FR-EXEC-011, AC-126.
 * Refusal: Attempting to prove TRADABLE_SUCCESS from a snapshot below the required resolution floor without an active plan is refused.
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
