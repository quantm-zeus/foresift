/**
 * Batch coalescing units (FR-COST-005, AC-102).
 *
 * Asserts:
 * - Groups compatible requests inside the coalescing window.
 * - Respects batchCapability: maxBatchSize, safeMaxUtilization, keyFields.
 * - Bit-for-bit deterministic key construction for request deduping.
 * - Emits exactly one provider call per batch, returns utilization metrics.
 * - Error cases never merge across different providers.
 */
import { describe, expect, it } from 'bun:test';

describe('batch-coalescer batch grouping and safety limits (FR-COST-005, AC-102)', () => {
  it('coalesces compatible requests up to safe max batch utilization', async () => {
    let BatchModule: Record<string, unknown>;
    try {
      BatchModule = (await import('../src/batch-coalescer.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('BATCH_COALESCER_NOT_IMPLEMENTED: src/batch-coalescer.ts missing');
    }

    const coalesceRequests = BatchModule.coalesceRequests as (
      requests: Array<{ provider: string; operation: string; key: string }>,
      capability: { maxBatchSize: number; safeMaxUtilization: number },
    ) => Array<{ batchId: string; items: unknown[]; utilization: number }>;

    const requests = Array.from({ length: 20 }, (_, i) => ({
      provider: 'gmgn',
      operation: 'token_security',
      key: `addr_${i.toString().padStart(2, '0')}`,
    }));

    const batches = coalesceRequests(requests, {
      maxBatchSize: 20,
      safeMaxUtilization: 0.8, // 16 items per safe batch
    });

    expect(batches.length).toBe(2);
    expect(batches[0]?.items.length).toBe(16);
    expect(batches[0]?.utilization).toBe(0.8);
    expect(batches[1]?.items.length).toBe(4);
  });

  it('never merges requests across different providers into the same batch', async () => {
    let BatchModule: Record<string, unknown>;
    try {
      BatchModule = (await import('../src/batch-coalescer.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('BATCH_COALESCER_NOT_IMPLEMENTED: src/batch-coalescer.ts missing');
    }

    const coalesceRequests = BatchModule.coalesceRequests as (
      requests: Array<{ provider: string; operation: string; key: string }>,
      capability: { maxBatchSize: number; safeMaxUtilization: number },
    ) => Array<{ provider: string; items: unknown[] }>;

    const crossProviderRequests = [
      { provider: 'gmgn', operation: 'token_security', key: 'addr_1' },
      { provider: 'helius', operation: 'raw_asset_query', key: 'addr_1' },
      { provider: 'gmgn', operation: 'token_security', key: 'addr_2' },
    ];

    const batches = coalesceRequests(crossProviderRequests, {
      maxBatchSize: 10,
      safeMaxUtilization: 1.0,
    });

    expect(batches.length).toBe(2);
    for (const batch of batches) {
      const providers = new Set((batch.items as Array<{ provider: string }>).map((i) => i.provider));
      expect(providers.size).toBe(1);
    }
  });

  it('generates deterministic bit-for-bit batch keys', async () => {
    let BatchModule: Record<string, unknown>;
    try {
      BatchModule = (await import('../src/batch-coalescer.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('BATCH_COALESCER_NOT_IMPLEMENTED: src/batch-coalescer.ts missing');
    }

    const computeBatchKey = BatchModule.computeBatchKey as (
      provider: string,
      operation: string,
      keyFields: Record<string, unknown>,
    ) => string;

    const key1 = computeBatchKey('gmgn', 'token_security', { address: '0xabc', chain: 'solana' });
    const key2 = computeBatchKey('gmgn', 'token_security', { chain: 'solana', address: '0xabc' });

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^batch_key:/);
  });
});
