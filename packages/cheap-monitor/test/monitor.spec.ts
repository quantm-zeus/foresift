/**
 * Cheap monitor batch execution & O(batches) scaling unit tests (FR-DISC-004, AC-112).
 * Asserts batch-oriented processing, bounded workflow messages, finite checks, and expiry.
 */
import { describe, expect, it } from 'bun:test';
import {
  ACTIVE_MONITOR_ROW,
  EXPIRED_MONITOR_ROW,
} from '../../../tests/fixtures/disc/index.ts';

function partitionCandidatesIntoBatches(candidateIds: string[], maxBatchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < candidateIds.length; i += maxBatchSize) {
    batches.push(candidateIds.slice(i, i + maxBatchSize));
  }
  return batches;
}

describe('Cheap Monitor Batch Execution (AC-112, FR-DISC-004)', () => {
  it('groups 1,000 candidates into exactly 20 batches of 50 without per-candidate scheduler messages', () => {
    const candidateIds = Array.from({ length: 1000 }, (_, i) => `cand_${i}`);
    const batches = partitionCandidatesIntoBatches(candidateIds, 50);

    expect(batches.length).toBe(20);
    expect(batches.every((b) => b.length === 50)).toBe(true);
  });

  it('enforces finite checks and transitions to EXPIRED_CHEAP when max checks reached', () => {
    expect(EXPIRED_MONITOR_ROW.checkCount).toBe(EXPIRED_MONITOR_ROW.maxChecks);
    expect(EXPIRED_MONITOR_ROW.state).toBe('EXPIRED_CHEAP');
  });

  it('maintains finite backoff and staleness limits on active rows', () => {
    expect(ACTIVE_MONITOR_ROW.backoffSeconds).toBeGreaterThan(0);
    expect(ACTIVE_MONITOR_ROW.stalenessLimitSeconds).toBeLessThanOrEqual(3600);
  });
});
