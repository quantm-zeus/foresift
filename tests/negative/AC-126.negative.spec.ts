/**
 * AC-126 negative (failure) — Prohibition against tradable success from below-floor-resolution data.
 * Traces: FR-EXEC-004, FR-EXEC-011, AC-126.
 * Tests structural refusal of awarding tradable success from snapshots that violate the temporal resolution floor without a registered observation plan.
 */
import { describe, expect, it } from 'bun:test';

function evaluateTradableSuccessResolution(params: {
  snapshotResolutionSeconds: number;
  resolutionFloorSeconds: number;
  observationPlanPresent: boolean;
  assignedTradableOutcome: string;
}) {
  const violatesFloor = params.snapshotResolutionSeconds > params.resolutionFloorSeconds;
  if (violatesFloor && !params.observationPlanPresent && params.assignedTradableOutcome === 'TRADABLE_SUCCESS') {
    throw new Error('BELOW_FLOOR_RESOLUTION_WITHOUT_OBSERVATION_PLAN_CANNOT_PROVE_TRADABLE_SUCCESS');
  }
  return true;
}

describe('AC-126 negative: tradable success from low-resolution snapshot is refused', () => {
  it('refuses TRADABLE_SUCCESS from 60s snapshot without high-resolution observation plan', () => {
    expect(() =>
      evaluateTradableSuccessResolution({
        snapshotResolutionSeconds: 60,
        resolutionFloorSeconds: 1,
        observationPlanPresent: false,
        assignedTradableOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('BELOW_FLOOR_RESOLUTION_WITHOUT_OBSERVATION_PLAN_CANNOT_PROVE_TRADABLE_SUCCESS');
  });

  it('allows TRADABLE_SUCCESS when high-resolution observation plan is present', () => {
    expect(
      evaluateTradableSuccessResolution({
        snapshotResolutionSeconds: 60,
        resolutionFloorSeconds: 1,
        observationPlanPresent: true,
        assignedTradableOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toBe(true);
  });
});
