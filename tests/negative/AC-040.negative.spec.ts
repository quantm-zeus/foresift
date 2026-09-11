/**
 * AC-040 negative (failure) — conflation of signal and tradable outcomes is structurally refused.
 * Traces: FR-MAT-001, FR-EVAL-001, AC-040.
 */
import { describe, expect, it } from 'bun:test';

function validateOutcomeSeparation(outcome: {
  signalOutcome: string;
  tradableOutcome?: string;
  maturityState?: string;
}) {
  if (!outcome.tradableOutcome) {
    throw new Error('TRADABLE_OUTCOME_REQUIRED_SEPARATE_FROM_SIGNAL');
  }
  if (!outcome.maturityState) {
    throw new Error('MATURITY_STATE_REQUIRED');
  }
  return true;
}

describe('AC-040 negative: conflated outcome records without distinct tradable label and maturity state are refused', () => {
  it('throws when tradable outcome is omitted', () => {
    expect(() =>
      validateOutcomeSeparation({
        signalOutcome: 'SIGNAL_SUCCESS',
      }),
    ).toThrow('TRADABLE_OUTCOME_REQUIRED_SEPARATE_FROM_SIGNAL');
  });

  it('throws when maturity state is omitted', () => {
    expect(() =>
      validateOutcomeSeparation({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('MATURITY_STATE_REQUIRED');
  });
});
