/**
 * AC-124 negative (failure) — censored/invalid without reason or silently mapped to failure refused.
 * Traces: FR-EXEC-006, FR-EXEC-011, FR-MAT-003, AC-124.
 * Refusal: CENSORED/INVALID_DATA without recorded reason or silent reclassification to TRADABLE_FAILURE is refused.
 *
 * Facet convention:
 * 1. Base execution refusal: unreasoned censored/invalid or silent failure mapping throws.
 * 2. Evaluation dataset refusal (FR-MAT-003, AC-124): evaluation dataset dropping censor reasons throws.
 */
import { describe, expect, it } from 'bun:test';

function recordCensoredOrInvalid(params: {
  outcomeClass: 'CENSORED' | 'INVALID_DATA';
  reason?: string;
  mappedToFailure?: boolean;
}) {
  if (!params.reason || params.reason.trim().length === 0) {
    throw new Error('CENSORED_OR_INVALID_WITHOUT_REASON_REFUSED');
  }
  if (params.mappedToFailure) {
    throw new Error('SILENT_MAPPING_TO_TRADABLE_FAILURE_REFUSED');
  }
  return true;
}

function validateDatasetReasonRetention(datasetRow: {
  status: string;
  retainedReason?: string;
}) {
  if ((datasetRow.status === 'CENSORED' || datasetRow.status === 'INVALID_DATA') && !datasetRow.retainedReason) {
    throw new Error('DATASET_REASON_RETENTION_REQUIRED');
  }
  return true;
}

describe('AC-124 negative: unreasoned censored/invalid or silent failure mapping refused', () => {
  it('throws when CENSORED is created without an explicit reason', () => {
    expect(() =>
      recordCensoredOrInvalid({
        outcomeClass: 'CENSORED',
        reason: '',
      }),
    ).toThrow('CENSORED_OR_INVALID_WITHOUT_REASON_REFUSED');
  });

  it('throws when INVALID_DATA is created without an explicit reason', () => {
    expect(() =>
      recordCensoredOrInvalid({
        outcomeClass: 'INVALID_DATA',
      }),
    ).toThrow('CENSORED_OR_INVALID_WITHOUT_REASON_REFUSED');
  });

  it('throws when CENSORED is silently mapped to failure', () => {
    expect(() =>
      recordCensoredOrInvalid({
        outcomeClass: 'CENSORED',
        reason: 'RIGHTS_DRIVEN_DELETION',
        mappedToFailure: true,
      }),
    ).toThrow('SILENT_MAPPING_TO_TRADABLE_FAILURE_REFUSED');
  });
});

describe('AC-124 negative — evaluation dataset retention facet (FR-MAT-003, AC-124)', () => {
  it('throws when evaluation dataset drops censor reason', () => {
    expect(() =>
      validateDatasetReasonRetention({
        status: 'CENSORED',
      }),
    ).toThrow('DATASET_REASON_RETENTION_REQUIRED');
  });
});
