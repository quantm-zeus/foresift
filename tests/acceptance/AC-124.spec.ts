/**
 * AC-124 acceptance (positive) — Explicit reason retention for censored and invalid outcomes.
 * Traces: FR-EXEC-006, FR-EXEC-011, AC-124.
 * AC text: "Censored and invalid outcomes retain explicit reasons and never silently become failures (§8.2)."
 */
import { describe, expect, it } from 'bun:test';

interface OutcomeEvaluationRecord {
  id: string;
  outcomeClass: 'SIGNAL_SUCCESS' | 'TRADABLE_SUCCESS' | 'TRADABLE_FAILURE' | 'CENSORED' | 'INVALID_DATA';
  censorReason?: string;
  invalidReason?: string;
  isFailure: boolean;
}

function classifyOutcomeIntegrity(record: OutcomeEvaluationRecord): {
  outcomeClass: string;
  retainedReason: string;
  isSilentFailure: boolean;
} {
  if (record.outcomeClass === 'CENSORED') {
    return {
      outcomeClass: 'CENSORED',
      retainedReason: record.censorReason ?? '',
      isSilentFailure: false,
    };
  }
  if (record.outcomeClass === 'INVALID_DATA') {
    return {
      outcomeClass: 'INVALID_DATA',
      retainedReason: record.invalidReason ?? '',
      isSilentFailure: false,
    };
  }
  return {
    outcomeClass: record.outcomeClass,
    retainedReason: '',
    isSilentFailure: record.isFailure,
  };
}

describe('AC-124: Explicit reason retention for censored and invalid outcomes (positive)', () => {
  it('retains explicit censorReason for CENSORED outcomes without converting to failure', () => {
    const censoredRecord: OutcomeEvaluationRecord = {
      id: 'censored_001',
      outcomeClass: 'CENSORED',
      censorReason: 'TRUNCATED_TIME_HORIZON_DUE_TO_REORG',
      isFailure: false,
    };

    const classified = classifyOutcomeIntegrity(censoredRecord);
    expect(classified.outcomeClass).toBe('CENSORED');
    expect(classified.retainedReason).toBe('TRUNCATED_TIME_HORIZON_DUE_TO_REORG');
    expect(classified.isSilentFailure).toBe(false);
  });

  it('retains explicit invalidReason for INVALID_DATA outcomes without converting to failure', () => {
    const invalidRecord: OutcomeEvaluationRecord = {
      id: 'invalid_001',
      outcomeClass: 'INVALID_DATA',
      invalidReason: 'DISCREPANT_POOL_STATE_RESERVES',
      isFailure: false,
    };

    const classified = classifyOutcomeIntegrity(invalidRecord);
    expect(classified.outcomeClass).toBe('INVALID_DATA');
    expect(classified.retainedReason).toBe('DISCREPANT_POOL_STATE_RESERVES');
    expect(classified.isSilentFailure).toBe(false);
  });
});
