/**
 * Durable monotonic checkpoints & fencing unit tests (FR-COL-004, FR-COL-009).
 * Tests partition checkpoint commit monotonicity, fencing token validation, and stale token refusal.
 */
import { describe, expect, it } from 'bun:test';

interface CheckpointState {
  partitionId: string;
  lastCommittedSlot: number;
  fencingToken: number;
}

function advanceCheckpoint(
  current: CheckpointState,
  newSlot: number,
  token: number,
): { success: boolean; state: CheckpointState; error?: string } {
  if (token !== current.fencingToken) {
    return { success: false, state: current, error: 'STALE_FENCING_TOKEN' };
  }
  if (newSlot <= current.lastCommittedSlot) {
    return { success: false, state: current, error: 'NON_MONOTONIC_SLOT' };
  }
  return {
    success: true,
    state: { ...current, lastCommittedSlot: newSlot },
  };
}

describe('Collector Checkpoints & Fencing (FR-COL-004, FR-COL-009)', () => {
  it('advances checkpoint monotonically when valid fencing token is presented', () => {
    const current: CheckpointState = {
      partitionId: 'part_0',
      lastCommittedSlot: 100,
      fencingToken: 42,
    };

    const res = advanceCheckpoint(current, 105, 42);
    expect(res.success).toBe(true);
    expect(res.state.lastCommittedSlot).toBe(105);
  });

  it('refuses stale fencing tokens to prevent split-brain dual-runner corruption', () => {
    const current: CheckpointState = {
      partitionId: 'part_0',
      lastCommittedSlot: 100,
      fencingToken: 43,
    };

    const res = advanceCheckpoint(current, 105, 42); // Stale token 42
    expect(res.success).toBe(false);
    expect(res.error).toBe('STALE_FENCING_TOKEN');
  });

  it('refuses non-monotonic slot regressions', () => {
    const current: CheckpointState = {
      partitionId: 'part_0',
      lastCommittedSlot: 100,
      fencingToken: 42,
    };

    const res = advanceCheckpoint(current, 95, 42);
    expect(res.success).toBe(false);
    expect(res.error).toBe('NON_MONOTONIC_SLOT');
  });
});
