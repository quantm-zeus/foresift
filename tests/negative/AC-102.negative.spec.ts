/**
 * AC-102 negative / failure-path — Cost & Batch facet.
 * Traces: FR-COST-005.
 *
 * Asserts:
 * - Incompatible or ungroupable requests produce separate individual reservations and are never merged into one batch call.
 * - Cross-provider requests cannot be combined into a shared batch under any circumstances.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-102 negative: ungroupable/cross-provider requests produce separate reservations', () => {
  it('splits cross-provider requests into distinct reservations per provider', async () => {
    let BatchModule: Record<string, unknown>;
    try {
      BatchModule = (await import(
        '../../packages/cost-router/src/batch-coalescer.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('BATCH_COALESCER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const processMixedRequests = BatchModule.processMixedRequests as (
      requests: Array<{ provider: string; operation: string; key: string }>,
    ) => Promise<{ providerBatches: Record<string, number>; totalReservations: number }>;

    const requests = [
      { provider: 'gmgn', operation: 'token_security', key: 'addr_1' },
      { provider: 'helius', operation: 'raw_asset_query', key: 'addr_1' },
      { provider: 'gmgn', operation: 'token_security', key: 'addr_2' },
    ];

    const result = await processMixedRequests(requests);
    expect(result.totalReservations).toBe(2);
    expect(result.providerBatches.gmgn).toBe(1);
    expect(result.providerBatches.helius).toBe(1);
  });
});
