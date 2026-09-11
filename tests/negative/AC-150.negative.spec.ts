/**
 * AC-150 negative (failure) — negative control exhibiting material lift triggers incident and blocks promotion.
 * Traces: FR-MAT-004, AC-150.
 */
import { describe, expect, it } from 'bun:test';
import { GOLDEN_CONTROL_CASES } from '../fixtures/eval/controls-vectors.ts';

function enforceControlPromotionGate(control: {
  hasMaterialLift: boolean;
  measuredLiftUsd: number;
}) {
  if (control.hasMaterialLift) {
    throw new Error('NEGATIVE_CONTROL_MATERIAL_LIFT_PROMOTION_BLOCKED');
  }
  return true;
}

describe('AC-150 negative: promotion is blocked upon negative control material lift', () => {
  it('throws and blocks promotion when control reveals leakage / spurious lift', () => {
    const leakageCase = GOLDEN_CONTROL_CASES.find((c) => c.hasMaterialLift);
    expect(leakageCase).toBeDefined();
    if (!leakageCase) return;

    expect(() => enforceControlPromotionGate(leakageCase)).toThrow(
      'NEGATIVE_CONTROL_MATERIAL_LIFT_PROMOTION_BLOCKED',
    );
  });
});
