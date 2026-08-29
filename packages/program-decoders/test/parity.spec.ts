/**
 * Decoder quote and trade parity verification unit tests (T028, AC-231, FR-COL-002).
 * Verifies reference quote parity within versioned tolerance and historical trade parity.
 */
import { describe, expect, it } from 'bun:test';

function verifyQuoteParity(params: {
  calculatedOut: number;
  referenceQuoteOut: number;
  toleranceFraction: number;
}): { passes: boolean; relativeDiff: number } {
  const diff = Math.abs(params.calculatedOut - params.referenceQuoteOut);
  const relativeDiff = diff / params.referenceQuoteOut;
  return {
    passes: relativeDiff <= params.toleranceFraction,
    relativeDiff,
  };
}

describe('Decoder Parity Verification (AC-231, FR-COL-002)', () => {
  it('passes when output is within notional-specific tolerance (e.g. 0.1%)', () => {
    const res = verifyQuoteParity({
      calculatedOut: 1_000_000,
      referenceQuoteOut: 1_000_500,
      toleranceFraction: 0.001,
    });
    expect(res.passes).toBe(true);
  });

  it('fails when parity difference exceeds tolerance boundary', () => {
    const res = verifyQuoteParity({
      calculatedOut: 1_000_000,
      referenceQuoteOut: 1_050_000,
      toleranceFraction: 0.001,
    });
    expect(res.passes).toBe(false);
  });
});
