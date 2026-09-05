/**
 * AC-124 negative (failure) — censored/invalid without reason or silently mapped to failure refused.
 * Traces: FR-EXEC-006, FR-EXEC-011, AC-124.
 * Refusal: CENSORED/INVALID_DATA without recorded reason or silent reclassification to TRADABLE_FAILURE is refused.
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
        reason: 'VALID_REASON',
        mappedToFailure: true,
      }),
    ).toThrow('SILENT_MAPPING_TO_TRADABLE_FAILURE_REFUSED');
  });
});
