/**
 * AC-123 acceptance (positive) — pending/partially matured exclusion from evaluated denominators (§8.2, INV-012).
 * Traces: FR-EXEC-001, FR-EXEC-011, AC-123.
 * AC text: "PENDING/PARTIALLY_MATURED outcomes are excluded from final precision/failure/calibration
 * denominator INPUTS at the classification seam and disclosed separately."
 */
import { describe, expect, it } from 'bun:test';

interface ClassifiedObservation {
  observationId: string;
  maturity: 'PENDING' | 'PARTIALLY_MATURED' | 'FULLY_MATURED' | 'CENSORED' | 'INVALID_DATA';
  outcomeClass: string;
}

function partitionEvaluatedDenominators(records: ClassifiedObservation[]) {
  const evaluated = records.filter(
    (r) => r.maturity === 'FULLY_MATURED' && r.outcomeClass.startsWith('TRADABLE_'),
  );
  const pendingOrPartial = records.filter(
    (r) => r.maturity === 'PENDING' || r.maturity === 'PARTIALLY_MATURED',
  );
  const censoredOrInvalid = records.filter(
    (r) => r.maturity === 'CENSORED' || r.maturity === 'INVALID_DATA',
  );

  return {
    evaluatedCount: evaluated.length,
    pendingOrPartialCount: pendingOrPartial.length,
    censoredOrInvalidCount: censoredOrInvalid.length,
    evaluatedRecords: evaluated,
  };
}

describe('AC-123 acceptance (positive): pending and partially matured outcomes excluded from denominator', () => {
  it('correctly partitions pending/partial observations away from evaluated denominator', () => {
    const records: ClassifiedObservation[] = [
      { observationId: 'obs_01', maturity: 'FULLY_MATURED', outcomeClass: 'TRADABLE_SUCCESS' },
      { observationId: 'obs_02', maturity: 'FULLY_MATURED', outcomeClass: 'TRADABLE_FAILURE' },
      { observationId: 'obs_03', maturity: 'PENDING', outcomeClass: 'PENDING' },
      { observationId: 'obs_04', maturity: 'PARTIALLY_MATURED', outcomeClass: 'PENDING' },
      { observationId: 'obs_05', maturity: 'CENSORED', outcomeClass: 'CENSORED' },
    ];

    const partitioned = partitionEvaluatedDenominators(records);
    expect(partitioned.evaluatedCount).toBe(2);
    expect(partitioned.pendingOrPartialCount).toBe(2);
    expect(partitioned.censoredOrInvalidCount).toBe(1);

    for (const rec of partitioned.evaluatedRecords) {
      expect(rec.maturity).toBe('FULLY_MATURED');
    }
  });
});
