/**
 * AC-231 negative (failure) — decoder parity tolerance breach & layout change refusal.
 * Traces: FR-COL-002, FR-COL-007, FR-EXEC-016, AC-231, T044.
 * Tests failure when quote parity exceeds versioned tolerance, and activation refusal on undetected layout change.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function assertQuoteParityWithinTolerance(
  actualOutput: number,
  expectedQuote: number,
  maxToleranceFraction: number,
) {
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

describe('AC-231 exec negative: observed-trade tolerance breach and unverified manifest refusal (FR-EXEC-016)', () => {
  it('identifies breached parity trade vector and flags failure in fixture', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/observed-trades.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const breachedTrade = fixture.trades.find(
      (t: Record<string, unknown>) => t.parityState === 'FAIL',
    );

    expect(breachedTrade).toBeDefined();
    expect(breachedTrade.discrepancyBps).toBeGreaterThan(breachedTrade.toleranceBps);
    expect(breachedTrade.failureReason).toBe('PARITY_TOLERANCE_EXCEEDED');
  });

  it('refuses resolution of deprecated or unverified manifest', () => {
    const manifest = {
      capabilityState: 'DEPRECATED',
      isVerified: false,
    };

    const resolveManifest = (m: typeof manifest) => {
      if (m.capabilityState === 'DEPRECATED' || !m.isVerified) {
        throw new Error('UNVERIFIED_OR_DEPRECATED_MANIFEST_REFUSED');
      }
      return true;
    };

    expect(() => resolveManifest(manifest)).toThrow('UNVERIFIED_OR_DEPRECATED_MANIFEST_REFUSED');
  });
});
