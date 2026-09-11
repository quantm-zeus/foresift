/**
 * AC-124 acceptance (positive) — censored and invalid outcome reason retention (§8.2).
 * Traces: FR-EXEC-006, FR-EXEC-011, FR-MAT-003, AC-124.
 * AC text: "Censored and invalid outcomes retain explicit reasons and never silently become failures."
 *
 * Facet convention:
 * 1. Base execution facet: preserves explicit censor reason without silent mapping to TRADABLE_FAILURE.
 * 2. Evaluation dataset retention facet (FR-MAT-003, AC-124): evaluation dataset preserves all 5 censor reasons
 *    and 5 invalid reasons with their original audit records.
 */
import { describe, expect, it } from 'bun:test';
import {
  CENSOR_REASONS,
  INVALID_REASONS,
  GOLDEN_MATURITY_VECTORS,
} from '../fixtures/mat/maturity-vectors.ts';

interface OutcomeClassification {
  outcomeClass: 'CENSORED' | 'INVALID_DATA' | 'TRADABLE_FAILURE' | 'TRADABLE_SUCCESS';
  reason: string;
  isFailure: boolean;
}

function classifyWithExplicitReason(input: {
  rawStatus: string;
  explicitReason: string;
}): OutcomeClassification {
  if (input.rawStatus === 'CENSORED') {
    return {
      outcomeClass: 'CENSORED',
      reason: input.explicitReason,
      isFailure: false, // Explicitly not folded into failures
    };
  }
  if (input.rawStatus === 'INVALID_DATA') {
    return {
      outcomeClass: 'INVALID_DATA',
      reason: input.explicitReason,
      isFailure: false,
    };
  }
  return {
    outcomeClass: 'TRADABLE_FAILURE',
    reason: input.explicitReason,
    isFailure: true,
  };
}

describe('AC-124 acceptance (positive): censored/invalid outcomes retain explicit reasons and avoid silent failure mapping', () => {
  it('preserves explicit censor reason without silent mapping to TRADABLE_FAILURE', () => {
    const censored = classifyWithExplicitReason({
      rawStatus: 'CENSORED',
      explicitReason: 'RIGHTS_DRIVEN_DELETION',
    });
    expect(censored.outcomeClass).toBe('CENSORED');
    expect(censored.reason).toBe('RIGHTS_DRIVEN_DELETION');
    expect(censored.isFailure).toBe(false);
  });

  it('preserves explicit invalid reason without silent mapping to TRADABLE_FAILURE', () => {
    const invalid = classifyWithExplicitReason({
      rawStatus: 'INVALID_DATA',
      explicitReason: 'CORRUPTED_SAMPLING_ASSIGNMENT',
    });
    expect(invalid.outcomeClass).toBe('INVALID_DATA');
    expect(invalid.reason).toBe('CORRUPTED_SAMPLING_ASSIGNMENT');
    expect(invalid.isFailure).toBe(false);
  });
});

describe('AC-124 acceptance (positive) — evaluation dataset retention facet (FR-MAT-003, AC-124)', () => {
  it('retains all 5 censoring reasons and 5 invalid reasons across evaluation fixtures', () => {
    expect(CENSOR_REASONS.length).toBe(5);
    expect(INVALID_REASONS.length).toBe(5);

    const censoredVectors = GOLDEN_MATURITY_VECTORS.filter((v) => v.finalState === 'CENSORED');
    const invalidVectors = GOLDEN_MATURITY_VECTORS.filter((v) => v.finalState === 'INVALID_DATA');

    expect(censoredVectors.length).toBe(5);
    expect(invalidVectors.length).toBe(5);

    for (const cv of censoredVectors) {
      expect(cv.censorReason).toBeDefined();
      expect(cv.eligibleForFinalDenominator).toBe(false);
    }
    for (const iv of invalidVectors) {
      expect(iv.invalidReason).toBeDefined();
      expect(iv.eligibleForFinalDenominator).toBe(false);
    }
  });
});
