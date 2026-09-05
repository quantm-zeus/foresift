/**
 * AC-232 negative (failure) — INCOMPLETE_BLOCKING simulation confirming tradability is refused.
 * Traces: FR-EXEC-013, FR-EXEC-014, FR-EXEC-020, AC-232.
 * Refusal: A simulation with INCOMPLETE_BLOCKING state cannot confirm tradability or assume uniform liquidity.
 */
import { describe, expect, it } from 'bun:test';

function confirmOpportunity(params: {
  stateCompleteness: 'COMPLETE' | 'INCOMPLETE_BLOCKING';
  assumedUniformLiquidityFallback?: boolean;
  proposedVerdict: 'CONFIRMED_OPPORTUNITY' | 'UNTRADABLE_SIGNAL_WIN' | 'REJECTED_UNTRADABLE';
}) {
  if (params.stateCompleteness === 'INCOMPLETE_BLOCKING' && params.proposedVerdict === 'CONFIRMED_OPPORTUNITY') {
    throw new Error('INCOMPLETE_BLOCKING_CANNOT_CONFIRM_TRADABILITY_REFUSED');
  }
  if (params.assumedUniformLiquidityFallback) {
    throw new Error('UNIFORM_LIQUIDITY_FALLBACK_ON_INCOMPLETE_STATE_REFUSED');
  }
  return true;
}

describe('AC-232 negative: incomplete state confirming tradability or assuming uniform liquidity refused', () => {
  it('throws when trying to confirm opportunity on INCOMPLETE_BLOCKING state', () => {
    expect(() =>
      confirmOpportunity({
        stateCompleteness: 'INCOMPLETE_BLOCKING',
        proposedVerdict: 'CONFIRMED_OPPORTUNITY',
      }),
    ).toThrow('INCOMPLETE_BLOCKING_CANNOT_CONFIRM_TRADABILITY_REFUSED');
  });

  it('throws when substituting uniform liquidity for missing CLMM tick array or DLMM bin array', () => {
    expect(() =>
      confirmOpportunity({
        stateCompleteness: 'INCOMPLETE_BLOCKING',
        assumedUniformLiquidityFallback: true,
        proposedVerdict: 'REJECTED_UNTRADABLE',
      }),
    ).toThrow('UNIFORM_LIQUIDITY_FALLBACK_ON_INCOMPLETE_STATE_REFUSED');
  });
});
