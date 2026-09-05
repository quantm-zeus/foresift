/**
 * AC-239 negative (failure) — silent folding of excluded classes into TRADABLE_SUCCESS denominator refused.
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-011, AC-239.
 * Refusal: Silently folding signal-only, low-resolution, partial, censored, or invalid rows into the
 * TRADABLE_SUCCESS evaluation denominator is refused.
 */
import { describe, expect, it } from 'bun:test';

function assertPureTradableDenominator(
  records: {
    id: string;
    isExcludedClass: boolean;
    excludedReason?: string;
    foldedIntoTradableDenominator?: boolean;
  }[],
) {
  for (const r of records) {
    if (r.isExcludedClass && r.foldedIntoTradableDenominator) {
      throw new Error('EXCLUDED_CLASS_SILENTLY_FOLDED_INTO_TRADABLE_DENOMINATOR_REFUSED');
    }
  }
  return true;
}

describe('AC-239 negative: silent folding of excluded classes into denominator refused', () => {
  it('throws when signal-only outcome is folded into tradable denominator', () => {
    expect(() =>
      assertPureTradableDenominator([
        {
          id: '1',
          isExcludedClass: true,
          excludedReason: 'SIGNAL_ONLY',
          foldedIntoTradableDenominator: true,
        },
      ]),
    ).toThrow('EXCLUDED_CLASS_SILENTLY_FOLDED_INTO_TRADABLE_DENOMINATOR_REFUSED');
  });

  it('throws when censored or low-resolution outcome is folded into tradable denominator', () => {
    expect(() =>
      assertPureTradableDenominator([
        {
          id: '2',
          isExcludedClass: true,
          excludedReason: 'LOW_RESOLUTION',
          foldedIntoTradableDenominator: true,
        },
      ]),
    ).toThrow('EXCLUDED_CLASS_SILENTLY_FOLDED_INTO_TRADABLE_DENOMINATOR_REFUSED');
  });
});
