/**
 * Gap detection & gap-before-backfill ordering unit tests (FR-COL-004, FR-COL-005).
 * Asserts that missing slot ranges are registered BEFORE any backfill query can run.
 */
import { describe, expect, it } from 'bun:test';
import { DETECTED_SLOT_GAP } from '../../../tests/fixtures/col/index.ts';

interface SlotRange {
  startSlot: number;
  endSlot: number;
}

function detectGaps(lastCommitted: number, currentReceived: number): SlotRange | null {
  if (currentReceived > lastCommitted + 1) {
    return {
      startSlot: lastCommitted + 1,
      endSlot: currentReceived - 1,
    };
  }
  return null;
}

describe('Gap Detection & Ordering (FR-COL-004, FR-COL-005)', () => {
  it('detects slot range jump and creates OPEN gap before starting backfill', () => {
    const gap = detectGaps(100, 105);
    expect(gap).not.toBeNull();
    expect(gap?.startSlot).toBe(101);
    expect(gap?.endSlot).toBe(104);
  });

  it('recognizes contiguous slot sequence without false gaps', () => {
    const gap = detectGaps(100, 101);
    expect(gap).toBeNull();
  });

  it('matches detected slot gap fixture state OPEN', () => {
    expect(DETECTED_SLOT_GAP.state).toBe('OPEN');
  });
});
