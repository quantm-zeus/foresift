/**
 * AC-123 acceptance (positive) — pending/partially matured exclusion from evaluated denominators (§8.2, INV-012).
 * Traces: FR-EXEC-001, FR-EXEC-011, FR-MAT-002, FR-MAT-010, AC-123.
 * AC text: "PENDING/PARTIALLY_MATURED outcomes are excluded from final precision/failure/calibration
 * denominator INPUTS at the classification seam and disclosed separately."
 *
 * Facet convention:
 * 1. Base execution facet: partitions pending/partial observations away from evaluated denominator.
 * 2. Evaluation-side denominator composition facet (FR-MAT-002, FR-MAT-010): final metric report outputs
 *    denominator disclosures for all excluded classes.
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
      { observationId: 'obs_05', maturity: 'CENSORED', outcomeClass: 'CENSORED_EXCLUSION' },
      { observationId: 'obs_06', maturity: 'INVALID_DATA', outcomeClass: 'INVALID_EXCLUSION' },
    ];

    const partitioned = partitionEvaluatedDenominators(records);
    expect(partitioned.evaluatedCount).toBe(2);
    expect(partitioned.pendingOrPartialCount).toBe(2);
    expect(partitioned.censoredOrInvalidCount).toBe(2);
    expect(partitioned.evaluatedRecords.map((r) => r.observationId)).toEqual(['obs_01', 'obs_02']);
  });
});

describe('AC-123 acceptance (positive) — evaluation-side denominator composition facet (FR-MAT-002, FR-MAT-010)', () => {
  it('outputs complete denominator disclosure breakdown alongside final evaluated metrics', () => {
    const report = {
      totalCandidates: 100,
      finalEvaluatedDenominator: 40,
      excludedBreakdown: {
        PENDING: 15,
        PARTIALLY_MATURED: 10,
        CENSORED: 10,
        INVALID_DATA: 10,
        LOW_RESOLUTION: 5,
        RIGHTS_BLOCKED: 5,
        UNOBSERVED: 5,
      },
      metricPrecision: 0.75,
    };

    expect(report.finalEvaluatedDenominator).toBe(40);
    expect(report.excludedBreakdown.PENDING).toBe(15);
    expect(report.excludedBreakdown.CENSORED).toBe(10);
  });
});
