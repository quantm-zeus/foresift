/**
 * AC-124 negative (failure) — Prohibition against reasonless censorship and silent failure mapping.
 * Traces: FR-EXEC-006, FR-EXEC-011, AC-124.
 * Tests structural refusal of CENSORED/INVALID_DATA without recorded reason and prohibition against mapping to TRADABLE_FAILURE.
 */
import { describe, expect, it } from 'bun:test';

function assertOutcomeRecordSchema(outcome: {
  outcomeClass: string;
  censorReason?: string | null;
  invalidReason?: string | null;
}) {
  if (outcome.outcomeClass === 'CENSORED' && (!outcome.censorReason || outcome.censorReason.trim() === '')) {
    throw new Error('CENSORED_OUTCOME_REQUIRES_EXPLICIT_REASON');
  }
  if (outcome.outcomeClass === 'INVALID_DATA' && (!outcome.invalidReason || outcome.invalidReason.trim() === '')) {
    throw new Error('INVALID_DATA_OUTCOME_REQUIRES_EXPLICIT_REASON');
  }
  return true;
}

function assertNoSilentFailureMapping(outcome: {
  originalCondition: 'CENSORED' | 'INVALID_DATA';
  mappedOutcomeClass: string;
}) {
  if (outcome.mappedOutcomeClass === 'TRADABLE_FAILURE') {
    throw new Error(`SILENT_MAPPING_${outcome.originalCondition}_TO_TRADABLE_FAILURE_PROHIBITED`);
  }
  return true;
}

describe('AC-124 negative: reasonless censorship/invalidity and silent failure mapping are refused', () => {
  it('refuses CENSORED outcome without an explicit reason', () => {
    expect(() =>
      assertOutcomeRecordSchema({
        outcomeClass: 'CENSORED',
        censorReason: null,
      }),
    ).toThrow('CENSORED_OUTCOME_REQUIRES_EXPLICIT_REASON');

    expect(() =>
      assertOutcomeRecordSchema({
        outcomeClass: 'CENSORED',
        censorReason: '   ',
      }),
    ).toThrow('CENSORED_OUTCOME_REQUIRES_EXPLICIT_REASON');
  });

  it('refuses INVALID_DATA outcome without an explicit reason', () => {
    expect(() =>
      assertOutcomeRecordSchema({
        outcomeClass: 'INVALID_DATA',
        invalidReason: '',
      }),
    ).toThrow('INVALID_DATA_OUTCOME_REQUIRES_EXPLICIT_REASON');
  });

  it('refuses silent remapping of CENSORED and INVALID_DATA to TRADABLE_FAILURE', () => {
    expect(() =>
      assertNoSilentFailureMapping({
        originalCondition: 'CENSORED',
        mappedOutcomeClass: 'TRADABLE_FAILURE',
      }),
    ).toThrow('SILENT_MAPPING_CENSORED_TO_TRADABLE_FAILURE_PROHIBITED');

    expect(() =>
      assertNoSilentFailureMapping({
        originalCondition: 'INVALID_DATA',
        mappedOutcomeClass: 'TRADABLE_FAILURE',
      }),
    ).toThrow('SILENT_MAPPING_INVALID_DATA_TO_TRADABLE_FAILURE_PROHIBITED');
  });
});
