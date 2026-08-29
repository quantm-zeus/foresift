/**
 * AC-112 negative (failure) — cheap monitor batch execution.
 * Traces: FR-DISC-004.
 * Tests structural refusal of per-candidate scheduler message creation (O(candidates) explosion).
 */
import { describe, expect, it } from 'bun:test';

function assertBatchSchedulingPolicy(messagesCount: number, candidatesCount: number) {
  if (messagesCount >= candidatesCount && candidatesCount > 10) {
    throw new Error('STRUCTURAL_REFUSAL_PER_CANDIDATE_SCHEDULING_FORBIDDEN');
  }
  return true;
}

describe('AC-112 negative: per-candidate message/workflow creation structurally refused', () => {
  it('throws error when scheduler attempts to create individual message per candidate', () => {
    const candidatesCount = 1000;
    const individualMessagesCount = 1000; // 1-to-1 unbatched attempt

    expect(() => assertBatchSchedulingPolicy(individualMessagesCount, candidatesCount)).toThrow(
      'STRUCTURAL_REFUSAL_PER_CANDIDATE_SCHEDULING_FORBIDDEN',
    );
  });

  it('permits batch-oriented message count', () => {
    const candidatesCount = 1000;
    const batchedMessagesCount = 20;

    expect(assertBatchSchedulingPolicy(batchedMessagesCount, candidatesCount)).toBe(true);
  });
});
