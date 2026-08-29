/**
 * Watermark contiguity rules unit tests (FR-COL-004).
 */
import { describe, expect, it } from 'bun:test';

function computeContiguousWatermark(receivedSlots: number[], baseWatermark: number): number {
  const set = new Set(receivedSlots);
  let cur = baseWatermark;
  while (set.has(cur + 1)) {
    cur += 1;
  }
  return cur;
}

describe('Watermark Contiguity Rules (FR-COL-004)', () => {
  it('advances contiguous watermark only up to the first gap boundary', () => {
    // Received slots: 101, 102, 105 (missing 103, 104)
    const watermark = computeContiguousWatermark([101, 102, 105], 100);
    expect(watermark).toBe(102);
  });

  it('advances fully when all intermediate slots are present', () => {
    const watermark = computeContiguousWatermark([101, 102, 103, 104, 105], 100);
    expect(watermark).toBe(105);
  });
});
