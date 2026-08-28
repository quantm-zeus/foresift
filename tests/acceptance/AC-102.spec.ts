/**
 * AC-102 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-005.
 * AC text (manifest §39): "Batch coalescing of compatible provider requests achieves
 * configured maximum safe batch utilization and charges exactly one reservation
 * per provider call."
 *
 * Facet scope (cost-capacity):
 * - Groups compatible token market requests up to maximum safe batch utilization.
 * - Confirms exactly one reservation is created per coalesced provider call.
 */
import { describe, expect, it } from 'bun:test';
import { coalesceBatchRequests } from '../../packages/cost-router/src/batch-coalescer.ts';
import { generateCompatibleBatchItems } from '../fixtures/cost/batches.ts';

describe('AC-102 acceptance (positive): batch coalescing & single reservation per provider call', () => {
  it('coalesces 40 compatible requests into a single provider call with 0.8 utilization', () => {
    const items = generateCompatibleBatchItems(40);
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
    expect(batches[0].items.length).toBe(40);
    expect(batches[0].utilization).toBe(0.8);
    expect(batches[0].reservationCount).toBe(1);
  });
});
