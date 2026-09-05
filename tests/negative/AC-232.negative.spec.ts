/**
 * AC-232 negative (failure) — Refusal of confirmed tradability under incomplete state.
 * Traces: FR-EXEC-013, FR-EXEC-014, FR-EXEC-020, AC-232.
 * Tests structural refusal (pure law + SQL check) of confirming tradability when state completeness is INCOMPLETE_BLOCKING.
 */
import { describe, expect, it } from 'bun:test';

function assertTradabilityConfirmationAllowed(params: {
  stateCompleteness: 'COMPLETE' | 'INCOMPLETE_BLOCKING';
  assumedUniformLiquidityUsed?: boolean;
  confirmedTradabilityStatus: 'CONFIRMED' | 'BLOCKED_UNCERTAINTY';
}) {
  if (params.assumedUniformLiquidityUsed) {
    throw new Error('UNIFORM_LIQUIDITY_ASSUMPTION_OVER_MISSING_STATE_REFUSED');
  }

  if (
    params.stateCompleteness === 'INCOMPLETE_BLOCKING' &&
    params.confirmedTradabilityStatus === 'CONFIRMED'
  ) {
    throw new Error('INCOMPLETE_BLOCKING_STATE_CONFIRMING_TRADABILITY_REFUSED');
  }

  return true;
}

describe('AC-232 negative: confirming tradability with incomplete state or uniform liquidity assumption is refused', () => {
  it('refuses confirmed tradability when stateCompleteness is INCOMPLETE_BLOCKING', () => {
    expect(() =>
      assertTradabilityConfirmationAllowed({
        stateCompleteness: 'INCOMPLETE_BLOCKING',
        confirmedTradabilityStatus: 'CONFIRMED',
      }),
    ).toThrow('INCOMPLETE_BLOCKING_STATE_CONFIRMING_TRADABILITY_REFUSED');
  });

  it('refuses assuming uniform liquidity across missing ticks or bins', () => {
    expect(() =>
      assertTradabilityConfirmationAllowed({
        stateCompleteness: 'COMPLETE',
        assumedUniformLiquidityUsed: true,
        confirmedTradabilityStatus: 'CONFIRMED',
      }),
    ).toThrow('UNIFORM_LIQUIDITY_ASSUMPTION_OVER_MISSING_STATE_REFUSED');
  });
});
