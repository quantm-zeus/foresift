/**
 * AC-225 acceptance (positive) — Cost & Backfill Ledger Scoping facet.
 * Traces: FR-COST-001.
 * AC text: "A backfilled event retains its original chain time but receives no `available_at`
 * earlier than the real retrieval time; historical replay before retrieval cannot see it."
 *
 * Facet scope (Cost control plane):
 * - Backfilled event's quota cost impact is charged in the retrieval-time ledger window (when egress/compute happened).
 * - Replaying historical quota balance snapshots as of time T < retrieval_time shows zero cost impact from the backfilled event.
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

describe('AC-225 acceptance (cost facet): backfilled cost scoped to retrieval window', () => {
  it('scopes backfill cost to retrieval-time window without altering historical point-in-time quota ledgers', async () => {
    let QuotaModule: Record<string, unknown>;
    try {
      QuotaModule = (await import(
        '../../packages/cost-router/src/quota-adapter.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('COST_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const HistoricalQuotaLedger = QuotaModule.HistoricalQuotaLedger as new (
      engine: unknown,
    ) => {
      recordBackfilledOperation: (op: {
        operationId: string;
        eventChainTime: string;
        retrievalTime: string;
        unitsCharged: number;
      }) => Promise<void>;
      getQuotaBalanceAsOf: (asOf: string) => Promise<number>;
    };

    const ledger = new HistoricalQuotaLedger(tdb.engine);

    // Event happened at chain time 2026-08-01T00:00:00Z, but retrieved/backfilled at 2026-08-05T12:00:00Z
    await ledger.recordBackfilledOperation({
      operationId: 'backfill-op-1',
      eventChainTime: '2026-08-01T00:00:00Z',
      retrievalTime: '2026-08-05T12:00:00Z',
      unitsCharged: 10,
    });

    // As of 2026-08-03 (before retrieval): backfilled cost is NOT visible
    const balanceBeforeRetrieval = await ledger.getQuotaBalanceAsOf('2026-08-03T00:00:00Z');
    expect(balanceBeforeRetrieval).toBe(0);

    // As of 2026-08-06 (after retrieval): backfilled cost IS charged
    const balanceAfterRetrieval = await ledger.getQuotaBalanceAsOf('2026-08-06T00:00:00Z');
    expect(balanceAfterRetrieval).toBe(10);
  });
});
