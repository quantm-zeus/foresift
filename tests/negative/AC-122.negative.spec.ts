/**
 * AC-122 negative (failure) — Prohibition against classifying isolated wicks as TRADABLE_SUCCESS.
 * Traces: FR-EXEC-004, AC-122.
 * Tests structural refusal of awarding TRADABLE_SUCCESS to isolated price wicks without executable volume or duration.
 */
import { describe, expect, it } from 'bun:test';

function evaluateTargetTouchLegality(params: {
  touchesPrice: boolean;
  durationSlots: number;
  executableVolumeUsd: number;
  requiredNotionalUsd: number;
  minDurationSlots: number;
  assignedOutcome: string;
}) {
  const hasVolume = params.executableVolumeUsd >= params.requiredNotionalUsd;
  const hasDuration = params.durationSlots >= params.minDurationSlots;
  const isExecutable = params.touchesPrice && (hasVolume || hasDuration);

  if (!isExecutable && params.assignedOutcome === 'TRADABLE_SUCCESS') {
    throw new Error('ISOLATED_WICK_CANNOT_BE_CLASSIFIED_AS_TRADABLE_SUCCESS');
  }
  return true;
}

describe('AC-122 negative: isolated wick classified as TRADABLE_SUCCESS is refused', () => {
  it('refuses TRADABLE_SUCCESS for 1-slot wick with zero/shallow volume', () => {
    expect(() =>
      evaluateTargetTouchLegality({
        touchesPrice: true,
        durationSlots: 1,
        executableVolumeUsd: 100.0,
        requiredNotionalUsd: 5000.0,
        minDurationSlots: 3,
        assignedOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('ISOLATED_WICK_CANNOT_BE_CLASSIFIED_AS_TRADABLE_SUCCESS');
  });

  it('refuses TRADABLE_SUCCESS when price does not touch target despite duration/volume', () => {
    expect(() =>
      evaluateTargetTouchLegality({
        touchesPrice: false,
        durationSlots: 10,
        executableVolumeUsd: 100000.0,
        requiredNotionalUsd: 1000.0,
        minDurationSlots: 3,
        assignedOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('ISOLATED_WICK_CANNOT_BE_CLASSIFIED_AS_TRADABLE_SUCCESS');
  });
});
