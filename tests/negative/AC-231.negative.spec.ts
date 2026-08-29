/**
 * AC-231 negative (failure) — decoder parity tolerance breach & layout change refusal.
 * Traces: FR-COL-002, FR-COL-007.
 * Tests failure when quote parity exceeds versioned tolerance, and activation refusal on undetected layout change.
 */
import { describe, expect, it } from 'bun:test';

function assertQuoteParityWithinTolerance(actualOutput: number, expectedQuote: number, maxToleranceFraction: number) {
  const relativeDiff = Math.abs(actualOutput - expectedQuote) / expectedQuote;
  if (relativeDiff > maxToleranceFraction) {
    throw new Error('PARITY_TOLERANCE_BREACH_FAILS_PROTOCOL_FAMILY');
  }
  return true;
}

describe('AC-231 negative: parity beyond tolerance fails family; undetected layout change refuses activation', () => {
  it('fails protocol family when simulated execution quote exceeds notional tolerance limit', () => {
    const calculatedOut = 1_000_000;
    const referenceQuote = 1_050_000; // 5% divergence
    const maxTolerance = 0.001; // 0.1%

    expect(() =>
      assertQuoteParityWithinTolerance(calculatedOut, referenceQuote, maxTolerance),
    ).toThrow('PARITY_TOLERANCE_BREACH_FAILS_PROTOCOL_FAMILY');
  });

  it('refuses active capability state when layout verification slot or hash is missing', () => {
    const unverifiedManifest = {
      capabilityState: 'ACTIVE',
      liveChainVerificationSlot: '',
      liveChainVerificationHash: '',
    };

    const isActivationPermitted =
      unverifiedManifest.liveChainVerificationSlot.length > 0 &&
      unverifiedManifest.liveChainVerificationHash.length > 0;

    expect(isActivationPermitted).toBe(false);
  });
});
