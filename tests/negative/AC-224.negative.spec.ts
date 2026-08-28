/**
 * AC-224 negative (failure) — cost-capacity facet (collector data-truth substrate owned elsewhere).
 * Traces: FR-COST-001, FR-COST-005.
 * Tests rejection of duplicate quota ledger debit on replayed collector operations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';
import { CostQuotaAdapter } from '../../packages/cost-router/src/quota-adapter.ts';
import { FREE_QUOTA_OP } from '../fixtures/cost/operations.ts';

let tdb: TestDatabase;
let adapter: CostQuotaAdapter;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  adapter = new CostQuotaAdapter({ engine: tdb.engine, mode: 'STRICT_FREE' });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-224 negative: replayed collector window does not produce secondary reservation side-effects', () => {
  it('prevents double-debiting quota balances when replaying reservation', async () => {
    const payload = {
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH' as const,
      actorId: 'collector_solana_1',
      pipelineRunId: 'collector_replayed_window_99',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      estimate: { quotaModel: 'REQUESTS_PER_PERIOD' as const, estimatedUnits: 1 },
    };

    const id1 = await adapter.reserve(payload);
    const id2 = await adapter.reserve(payload);

    expect(id1).toBe(id2);
  });
});
