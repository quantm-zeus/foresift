/**
 * Solana subscription sharding determinism unit tests (FR-COL-009).
 */
import { describe, expect, it } from 'bun:test';

function computeShardPartition(programId: string, shardCount: number): number {
  let hash = 0;
  for (let i = 0; i < programId.length; i++) {
    hash = (hash * 31 + programId.charCodeAt(i)) >>> 0;
  }
  return hash % shardCount;
}

describe('Solana Subscription Sharding (FR-COL-009)', () => {
  it('deterministically assigns programs to shards within bounded count', () => {
    const shardCount = 4;
    const progA = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    const progB = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

    const shard1 = computeShardPartition(progA, shardCount);
    const shard2 = computeShardPartition(progA, shardCount);
    expect(shard1).toBe(shard2);
    expect(shard1).toBeGreaterThanOrEqual(0);
    expect(shard1).toBeLessThan(shardCount);

    const shardB = computeShardPartition(progB, shardCount);
    expect(shardB).toBeGreaterThanOrEqual(0);
    expect(shardB).toBeLessThan(shardCount);
  });
});
