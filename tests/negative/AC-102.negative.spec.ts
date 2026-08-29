/**
 * AC-102 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-005.
 * Tests separation of ungroupable and incompatible requests across distinct reservations.
 */
import { describe, expect, it } from 'bun:test';
import { coalesceBatchRequests } from '../../packages/cost-router/src/batch-coalescer.ts';
import {
  INCOMPATIBLE_DIFFERENT_OPERATION_ITEMS,
  INCOMPATIBLE_DIFFERENT_PROVIDER_ITEMS,
} from '../fixtures/cost/batches.ts';

describe('AC-102 negative: incompatible requests produce separate reservations', () => {
  it('produces distinct batches and reservations when items target different providers', () => {
    const batches = coalesceBatchRequests({
      items: INCOMPATIBLE_DIFFERENT_PROVIDER_ITEMS,
      capability: {
        maxBatchSize: 50,
        safeMaxUtilization: 0.8,
        keyFields: ['tokenAddress'],
      },
    });

    expect(batches.length).toBe(2);
    expect(batches[0].providerId).not.toBe(batches[1].providerId);
  });

  it('produces distinct batches and reservations when items target different operations', () => {
    const batches = coalesceBatchRequests({
      items: INCOMPATIBLE_DIFFERENT_OPERATION_ITEMS,
      capability: {
        maxBatchSize: 50,
        safeMaxUtilization: 0.8,
        keyFields: ['tokenAddress'],
      },
    });

    expect(batches.length).toBe(2);
    expect(batches[0].operationId).not.toBe(batches[1].operationId);
  });
});
