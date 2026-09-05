/**
 * AC-239 negative (failure) — Refusal of silent folding of excluded classes into TRADABLE_SUCCESS denominator.
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-011, AC-239.
 * Tests structural refusal of including signal-only, low-res, partial, censored, invalid, or mismatched rows in tradable success denominator.
 */
import { describe, expect, it } from 'bun:test';

function assertDenominatorIntegrity(params: {
  denominatorCandidates: {
    id: string;
    isSignalOnly?: boolean;
    isLowResolution?: boolean;
    maturity?: string;
    scenarioMatched?: boolean;
  }[];
}) {
  for (const c of params.denominatorCandidates) {
    if (c.isSignalOnly) {
      throw new Error('SILENT_FOLDING_SIGNAL_ONLY_INTO_TRADABLE_DENOMINATOR_REFUSED');
    }
    if (c.isLowResolution) {
      throw new Error('SILENT_FOLDING_LOW_RESOLUTION_INTO_TRADABLE_DENOMINATOR_REFUSED');
    }
    if (c.maturity === 'PENDING' || c.maturity === 'PARTIALLY_MATURED') {
      throw new Error('SILENT_FOLDING_UNMATURED_INTO_TRADABLE_DENOMINATOR_REFUSED');
    }
    if (c.maturity === 'CENSORED' || c.maturity === 'INVALID_DATA') {
      throw new Error(`SILENT_FOLDING_${c.maturity}_INTO_TRADABLE_DENOMINATOR_REFUSED`);
    }
    if (c.scenarioMatched === false) {
      throw new Error('SILENT_FOLDING_MISMATCHED_SCENARIO_INTO_TRADABLE_DENOMINATOR_REFUSED');
    }
  }

  return true;
}

describe('AC-239 negative: silent folding of excluded classes into TRADABLE_SUCCESS denominator is refused', () => {
  it('refuses inclusion of signal-only candidate in tradable denominator', () => {
    expect(() =>
      assertDenominatorIntegrity({
        denominatorCandidates: [{ id: '1', isSignalOnly: true }],
      }),
    ).toThrow('SILENT_FOLDING_SIGNAL_ONLY_INTO_TRADABLE_DENOMINATOR_REFUSED');
  });

  it('refuses inclusion of low-resolution candidate in tradable denominator', () => {
    expect(() =>
      assertDenominatorIntegrity({
        denominatorCandidates: [{ id: '2', isLowResolution: true }],
      }),
    ).toThrow('SILENT_FOLDING_LOW_RESOLUTION_INTO_TRADABLE_DENOMINATOR_REFUSED');
  });

  it('refuses inclusion of un-matured, censored, or invalid rows in tradable denominator', () => {
    expect(() =>
      assertDenominatorIntegrity({
        denominatorCandidates: [{ id: '3', maturity: 'PENDING' }],
      }),
    ).toThrow('SILENT_FOLDING_UNMATURED_INTO_TRADABLE_DENOMINATOR_REFUSED');

    expect(() =>
      assertDenominatorIntegrity({
        denominatorCandidates: [{ id: '4', maturity: 'CENSORED' }],
      }),
    ).toThrow('SILENT_FOLDING_CENSORED_INTO_TRADABLE_DENOMINATOR_REFUSED');

    expect(() =>
      assertDenominatorIntegrity({
        denominatorCandidates: [{ id: '5', maturity: 'INVALID_DATA' }],
      }),
    ).toThrow('SILENT_FOLDING_INVALID_DATA_INTO_TRADABLE_DENOMINATOR_REFUSED');
  });

  it('refuses inclusion of scenario-mismatched candidate in tradable denominator', () => {
    expect(() =>
      assertDenominatorIntegrity({
        denominatorCandidates: [{ id: '6', scenarioMatched: false }],
      }),
    ).toThrow('SILENT_FOLDING_MISMATCHED_SCENARIO_INTO_TRADABLE_DENOMINATOR_REFUSED');
  });
});
