/**
 * Batch coalescer unit tests (FR-COST-005, AC-102).
 * Verifies batch grouping, maximum safe utilization, deterministic batch keys,
 * and refusal to merge across disparate providers or operations.
 */
import { describe, expect, it } from 'bun:test';
import { coalesceBatchRequests, computeBatchKey } from '../src/batch-coalescer.ts';
import {
  INCOMPATIBLE_DIFFERENT_OPERATION_ITEMS,
  INCOMPATIBLE_DIFFERENT_PROVIDER_ITEMS,
  generateCompatibleBatchItems,
} from '../../../tests/fixtures/cost/batches.ts';

describe('batch-coalescer', () => {
  it('coalesces compatible items into a single batch up to maxBatchSize', () => {
    const items = generateCompatibleBatchItems(10);
    const capability = {
      maxBatchSize: 50,
      safeMaxUtilization: 0.8,
      keyFields: ['tokenAddress'],
    };

    const batches = coalesceBatchRequests({
      items,
      capability,
    });

    expect(batches.length).toBe(1);
    expect(batches[0].items.length).toBe(10);
    expect(batches[0].utilization).toBeCloseTo(10 / 50, 2);
    expect(batches[0].providerId).toBe('prov_gmgn');
  });

  it('splits items into multiple batches when exceeding maxBatchSize', () => {
    const items = generateCompatibleBatchItems(65);
    const capability = {
      maxBatchSize: 50,
      safeMaxUtilization: 0.8,
      keyFields: ['tokenAddress'],
    };

    const batches = coalesceBatchRequests({
      items,
      capability,
    });

    expect(batches.length).toBe(2);
    expect(batches[0].items.length).toBe(50);
    expect(batches[1].items.length).toBe(15);
  });

  it('never merges items from different providers into the same batch', () => {
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

  it('never merges items with different operations into the same batch', () => {
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

  it('produces bit-for-bit deterministic batch key', () => {
    const key1 = computeBatchKey('prov_gmgn', 'get_token_security', {
      chainId: 'solana',
      tokenAddress: 'So11111111111111111111111111111111111111112',
    });
    const key2 = computeBatchKey('prov_gmgn', 'get_token_security', {
      tokenAddress: 'So11111111111111111111111111111111111111112',
      chainId: 'solana',
    });

    expect(key1).toBe(key2);
  });
});
