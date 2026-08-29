/**
 * Backfill bounds and available_at timestamp preservation unit tests (FR-COL-005).
 * Backfill preserves actual retrieval time and strictly refuses backdated available_at.
 */
import { describe, expect, it } from 'bun:test';

interface BackfillEventPayload {
  eventAt: string;
  retrievedAt: string;
  availableAt: string;
}

function validateBackfillEvent(event: BackfillEventPayload): { valid: boolean; reason?: string } {
  const tEvent = new Date(event.eventAt).getTime();
  const tRetrieved = new Date(event.retrievedAt).getTime();
  const tAvailable = new Date(event.availableAt).getTime();

  if (tAvailable < tRetrieved) {
    return { valid: false, reason: 'AVAILABLE_AT_CANNOT_BE_EARLIER_THAN_RETRIEVAL' };
  }
  if (tRetrieved < tEvent) {
    return { valid: false, reason: 'RETRIEVAL_CANNOT_PREDATE_EVENT' };
  }
  return { valid: true };
}

describe('Backfill Bounds & Timestamp Invariants (FR-COL-005)', () => {
  it('admits backfilled events when available_at >= retrieval_time', () => {
    const valid = {
      eventAt: '2026-01-01T00:00:00Z',
      retrievedAt: '2026-08-20T10:00:00Z',
      availableAt: '2026-08-20T10:00:00.010Z',
    };
    const res = validateBackfillEvent(valid);
    expect(res.valid).toBe(true);
  });

  it('refuses backdated available_at that attempts to predate real retrieval', () => {
    const backdated = {
      eventAt: '2026-01-01T00:00:00Z',
      retrievedAt: '2026-08-20T10:00:00Z',
      availableAt: '2026-01-01T00:00:05Z', // Backdated claim
    };
    const res = validateBackfillEvent(backdated);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('AVAILABLE_AT_CANNOT_BE_EARLIER_THAN_RETRIEVAL');
  });
});
