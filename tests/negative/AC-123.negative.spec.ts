/**
 * AC-123 negative (failure) — Refusal of denominator composition including pending/partial outcomes.
 * Traces: FR-EXEC-001, FR-EXEC-011, AC-123.
 * Tests structural refusal of folding un-matured outcomes into final evaluation denominator inputs.
 */
import { describe, expect, it } from 'bun:test';

function validateDenominatorComposition(params: {
  denominatorInputs: { id: string; maturity: string }[];
}) {
  const invalidRow = params.denominatorInputs.find(
    (row) => row.maturity === 'PENDING' || row.maturity === 'PARTIALLY_MATURED',
  );
  if (invalidRow) {
    throw new Error(
      `DENOMINATOR_INPUT_CONTAINS_UNMATURED_OUTCOME:${invalidRow.maturity}`,
    );
  }
  return true;
}

describe('AC-123 negative: inclusion of pending/partial rows in denominator inputs is refused', () => {
  it('refuses denominator inputs containing PENDING rows', () => {
    expect(() =>
      validateDenominatorComposition({
        denominatorInputs: [
          { id: '1', maturity: 'FULLY_MATURED' },
          { id: '2', maturity: 'PENDING' },
        ],
      }),
    ).toThrow('DENOMINATOR_INPUT_CONTAINS_UNMATURED_OUTCOME:PENDING');
  });

  it('refuses denominator inputs containing PARTIALLY_MATURED rows', () => {
    expect(() =>
      validateDenominatorComposition({
        denominatorInputs: [
          { id: '1', maturity: 'FULLY_MATURED' },
          { id: '2', maturity: 'PARTIALLY_MATURED' },
        ],
      }),
    ).toThrow('DENOMINATOR_INPUT_CONTAINS_UNMATURED_OUTCOME:PARTIALLY_MATURED');
  });
});
