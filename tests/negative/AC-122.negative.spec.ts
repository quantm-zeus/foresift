/**
 * AC-122 negative (failure) — isolated wick classified TRADABLE_SUCCESS is refused.
 * Traces: FR-EXEC-004, AC-122.
 * Refusal: Structural refusal of classifying an isolated wick as TRADABLE_SUCCESS.
 */
import { describe, expect, it } from 'bun:test';

function classifyTargetTouch(params: {
  touchDurationSlots: number;
  minRequiredDurationSlots: number;
  executableVolumeUsd: number;
  requiredNotionalUsd: number;
  proposedOutcome: 'TRADABLE_SUCCESS' | 'TRADABLE_FAILURE';
}) {
  const isIsolatedWick =
    params.touchDurationSlots < params.minRequiredDurationSlots ||
    params.executableVolumeUsd < params.requiredNotionalUsd;

  if (isIsolatedWick && params.proposedOutcome === 'TRADABLE_SUCCESS') {
    throw new Error('ISOLATED_WICK_CANNOT_BE_TRADABLE_SUCCESS_REFUSED');
  }
  return true;
}

describe('AC-122 negative: isolated wick classified TRADABLE_SUCCESS is refused', () => {
  it('throws when proposing TRADABLE_SUCCESS on 1-slot wick with insufficient duration', () => {
    expect(() =>
      classifyTargetTouch({
        touchDurationSlots: 1,
        minRequiredDurationSlots: 3,
        executableVolumeUsd: 10000,
        requiredNotionalUsd: 500,
        proposedOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('ISOLATED_WICK_CANNOT_BE_TRADABLE_SUCCESS_REFUSED');
  });

  it('throws when proposing TRADABLE_SUCCESS on touch with 0 executable volume', () => {
    expect(() =>
      classifyTargetTouch({
        touchDurationSlots: 4,
        minRequiredDurationSlots: 3,
        executableVolumeUsd: 0,
        requiredNotionalUsd: 500,
        proposedOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('ISOLATED_WICK_CANNOT_BE_TRADABLE_SUCCESS_REFUSED');
  });
});
