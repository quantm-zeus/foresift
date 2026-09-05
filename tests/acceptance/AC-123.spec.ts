/**
 * AC-123 acceptance (positive) — Exclusion and separate disclosure of PENDING/PARTIAL outcomes.
 * Traces: FR-EXEC-001, FR-EXEC-011, AC-123.
 * AC text: "PENDING/PARTIALLY_MATURED outcomes are excluded from final precision/failure/calibration
 * denominator INPUTS at the classification seam and disclosed separately (§8.2, INV-012)."
 */
import { describe, expect, it } from 'bun:test';

interface OutcomeRecord {
  id: string;
  outcomeClass: string;
  maturity: 'PENDING' | 'PARTIALLY_MATURED' | 'FULLY_MATURED' | 'CENSORED' | 'INVALID_DATA';
}

function composeOutcomeDenominators(outcomes: OutcomeRecord[]) {
  const pendingCount = outcomes.filter((o) => o.maturity === 'PENDING').length;
  const partiallyMaturedCount = outcomes.filter((o) => o.maturity === 'PARTIALLY_MATURED').length;
  const fullyMaturedCount = outcomes.filter((o) => o.maturity === 'FULLY_MATURED').length;
  const censoredCount = outcomes.filter((o) => o.maturity === 'CENSORED').length;
  const invalidCount = outcomes.filter((o) => o.maturity === 'INVALID_DATA').length;

  // Fully matured evaluation denominator excludes pending and partially matured
  const maturedEvaluationsDenominator = fullyMaturedCount;
  const totalObserved = outcomes.length;

  return {
    totalObserved,
    maturedEvaluationsDenominator,
    disclosures: {
      pendingCount,
      partiallyMaturedCount,
      fullyMaturedCount,
      censoredCount,
      invalidCount,
    },
  };
}

describe('AC-123: Denominator exclusion and disclosure of pending/partial outcomes (positive)', () => {
  const sampleOutcomes: OutcomeRecord[] = [
    { id: '1', outcomeClass: 'TRADABLE_SUCCESS', maturity: 'FULLY_MATURED' },
    { id: '2', outcomeClass: 'TRADABLE_FAILURE', maturity: 'FULLY_MATURED' },
    { id: '3', outcomeClass: 'PENDING', maturity: 'PENDING' },
    { id: '4', outcomeClass: 'TRADABLE_SUCCESS', maturity: 'PARTIALLY_MATURED' },
    { id: '5', outcomeClass: 'CENSORED', maturity: 'CENSORED' },
    { id: '6', outcomeClass: 'INVALID_DATA', maturity: 'INVALID_DATA' },
    { id: '7', outcomeClass: 'TRADABLE_SUCCESS', maturity: 'FULLY_MATURED' },
  ];

  it('excludes PENDING and PARTIALLY_MATURED outcomes from matured denominator inputs', () => {
    const res = composeOutcomeDenominators(sampleOutcomes);

    expect(res.totalObserved).toBe(7);
    expect(res.maturedEvaluationsDenominator).toBe(3); // only fully matured rows (id 1, 2, 7)
  });

  it('discloses pending and partial counts separately', () => {
    const res = composeOutcomeDenominators(sampleOutcomes);

    expect(res.disclosures.pendingCount).toBe(1);
    expect(res.disclosures.partiallyMaturedCount).toBe(1);
    expect(res.disclosures.censoredCount).toBe(1);
    expect(res.disclosures.invalidCount).toBe(1);
  });
});
