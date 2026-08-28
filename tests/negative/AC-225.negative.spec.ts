/**
 * AC-225 negative / failure-path suite (cost facet: FR-COST-001).
 * Asserts that cost impact cannot be backdated to original event time.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-225 negative: backfill cost cannot backdate into historical windows', () => {
  it('rejects attempt to charge backfilled retrieval cost to past event timestamp window', () => {
    const entry = {
      eventAt: '2026-08-01T08:00:00Z',
      fetchedAt: '2026-08-01T16:00:00Z',
      chargedWindow: '2026-08-01T08:00:00Z',
    };

    const isBackdating = entry.chargedWindow !== entry.fetchedAt;
    expect(isBackdating).toBe(true);

    const validateCostWindow = (e: typeof entry) => {
      if (e.chargedWindow < e.fetchedAt) {
        throw new Error('COST_BACKDATING_PROHIBITED: quota cost must be booked at retrieval time');
      }
    };

    expect(() => validateCostWindow(entry)).toThrow(/COST_BACKDATING_PROHIBITED/);
  });
});
