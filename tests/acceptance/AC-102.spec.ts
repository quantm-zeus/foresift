/**
 * AC-102 acceptance (positive) — Cost & Batch facet.
 * Traces: FR-COST-005.
 * AC text: "A compatible batch of token market requests produces the configured maximum
 * safe batch utilization and one quota reservation per provider call."
 *
 * Asserts:
 * - Compatible requests inside coalescing window form a single batch at configured safe max utilization.
 * - Exactly ONE quota reservation is created for the entire batch call (not per batched entity).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-102 acceptance: batch coalescing and single reservation per provider call', () => {
  it('creates one quota reservation per coalesced batch with safe max utilization', async () => {
    let BatchModule: Record<string, unknown>;
    try {
      BatchModule = (await import(
        '../../packages/cost-router/src/batch-coalescer.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('BATCH_COALESCER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const processBatchRequests = BatchModule.processBatchRequests as (req: {
      provider: string;
      operation: string;
      items: Array<{ address: string }>;
      batchCapability: { maxBatchSize: number; safeMaxUtilization: number };
    }) => Promise<{
      batches: Array<{ batchId: string; itemCount: number; utilization: number }>;
      reservationCount: number;
    }>;

    const items = Array.from({ length: 16 }, (_, i) => ({
      address: `So1111111111111111111111111111111111111111${i.toString(16)}`,
    }));

    const result = await processBatchRequests({
      provider: 'gmgn',
      operation: 'token_security',
      items,
      batchCapability: { maxBatchSize: 20, safeMaxUtilization: 0.8 },
    });

    expect(result.batches.length).toBe(1);
    expect(result.batches[0]?.itemCount).toBe(16);
    expect(result.batches[0]?.utilization).toBe(0.8);
    expect(result.reservationCount).toBe(1);
  });
});
