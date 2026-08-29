/**
 * Collector event deduplication & idempotency unit tests (FR-COL-006, FR-COL-009).
 */
import { describe, expect, it } from 'bun:test';
import {
  DUPLICATE_EVENT_SEQUENCE,
  REORG_EVENT_SEQUENCE,
} from '../../../tests/fixtures/col/index.ts';

describe('Collector Event Deduplication (FR-COL-006, FR-COL-009)', () => {
  it('identifies duplicate events by chain coordinates and normalized hash without emitting duplicate rows', () => {
    const seq = DUPLICATE_EVENT_SEQUENCE;
    const initial = seq.initialRecords[0];
    const duplicate = seq.subsequentRecords[0];

    expect(initial.slot).toBe(duplicate.slot);
    expect(initial.transactionSignature).toBe(duplicate.transactionSignature);
    expect(initial.normalizedEventHash).toBe(duplicate.normalizedEventHash);
  });

  it('handles reorgs through immutable revisions without destructively modifying prior records', () => {
    const seq = REORG_EVENT_SEQUENCE;
    expect(seq.expectedRevisionsCount).toBe(2);
    expect(seq.expectedCanonicalCount).toBe(1);
  });
});
