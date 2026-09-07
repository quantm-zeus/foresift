/**
 * AC-123 negative (failure) — denominator including pending/partial rows is refused.
 * Traces: FR-EXEC-001, FR-EXEC-011, AC-123.
 * Refusal: Building an evaluated metric denominator that includes immature (PENDING / PARTIALLY_MATURED) rows is refused.
 */
import { describe, expect, it } from 'bun:test';

function buildEvaluatedDenominator(
  records: { observationId: string; maturity: string; outcomeClass: string }[],
) {
  const invalidRows = records.filter(
    (r) => r.maturity === 'PENDING' || r.maturity === 'PARTIALLY_MATURED',
  );

  if (invalidRows.length > 0) {
    throw new Error('IMMATURE_OBSERVATIONS_IN_EVALUATED_DENOMINATOR_REFUSED');
  }

  return records.length;
}

describe('AC-123 negative: immature observation rows in evaluated denominator refused', () => {
  it('throws when evaluated denominator contains PENDING maturity rows', () => {
    const records = [
      { observationId: 'obs_01', maturity: 'FULLY_MATURED', outcomeClass: 'TRADABLE_SUCCESS' },
      { observationId: 'obs_02', maturity: 'PENDING', outcomeClass: 'PENDING' },
    ];

    expect(() => buildEvaluatedDenominator(records)).toThrow(
      'IMMATURE_OBSERVATIONS_IN_EVALUATED_DENOMINATOR_REFUSED',
    );
  });

  it('throws when evaluated denominator contains PARTIALLY_MATURED rows', () => {
    const records = [
      { observationId: 'obs_01', maturity: 'FULLY_MATURED', outcomeClass: 'TRADABLE_SUCCESS' },
      { observationId: 'obs_03', maturity: 'PARTIALLY_MATURED', outcomeClass: 'PENDING' },
    ];

    expect(() => buildEvaluatedDenominator(records)).toThrow(
      'IMMATURE_OBSERVATIONS_IN_EVALUATED_DENOMINATOR_REFUSED',
    );
  });
});
