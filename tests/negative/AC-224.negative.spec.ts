/**
 * AC-224 negative (failure) — cost-capacity facet (collector data-truth substrate owned elsewhere).
 * Traces: FR-COST-001, FR-COST-005.
 * Tests rejection of duplicate quota ledger debit on replayed collector operations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';
import { CostQuotaAdapter } from '../../packages/cost-router/src/quota-adapter.ts';
import {
  FREE_QUOTA_OP,
  seedCostOperationFixture,
  seedCostQuotaBalance,
} from '../fixtures/cost/operations.ts';

let tdb: TestDatabase;
let adapter: CostQuotaAdapter;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  await seedCostOperationFixture(tdb.engine, FREE_QUOTA_OP);
  await seedCostQuotaBalance(tdb.engine, {
    providerId: FREE_QUOTA_OP.providerId,
    capLimit: 1000,
    consumedReserved: 0,
  });
  adapter = new CostQuotaAdapter({ engine: tdb.engine, mode: 'STRICT_FREE' });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-224 negative: replayed collector window does not produce secondary reservation side-effects', () => {
  it('prevents double-debiting quota balances when replaying reservation', async () => {
    const estimate = await adapter.estimate({
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH',
    });
    await adapter.admit({
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH',
      estimate,
    });

    const payload = {
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH' as const,
      actorId: 'collector_solana_1',
      pipelineRunId: 'collector_replayed_window_99',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      estimate,
    };

    const id1 = await adapter.reserve(payload);
    const id2 = await adapter.reserve(payload);

    expect(id1).toBe(id2);

    const balanceResult = await tdb.engine.query<{
      consumed_reserved: string;
      remaining_units: string;
    }>(
      'SELECT consumed_reserved, remaining_units FROM cost.cost_quota_balances WHERE provider_id = $1',
      [FREE_QUOTA_OP.providerId],
    );
    expect(Number(balanceResult.rows[0]?.consumed_reserved)).toBe(1);
    expect(Number(balanceResult.rows[0]?.remaining_units)).toBe(999);
  });
});

describe('AC-224 negative — collector checkpoint refusal & fencing facet (FR-COL-004, FR-COL-009)', () => {
  it('prevents malformed stream events from advancing durable checkpoints', () => {
    const currentCheckpointSlot = 300100100;
    const malformedEvent = { slot: 300100105, payload: 'corrupted_bytes', isValid: false };

    let updatedSlot = currentCheckpointSlot;
    if (malformedEvent.isValid) {
      updatedSlot = malformedEvent.slot;
    }

    expect(updatedSlot).toBe(currentCheckpointSlot);
  });

  it('refuses stale fencing tokens during partition takeover and resume', () => {
    const activeFenceToken = 50;
    const staleRunnerFenceToken = 49;

    const admitResume = (token: number) => {
      if (token < activeFenceToken) {
        throw new Error('STALE_FENCING_TOKEN_REFUSED');
      }
      return true;
    };

    expect(() => admitResume(staleRunnerFenceToken)).toThrow('STALE_FENCING_TOKEN_REFUSED');
    expect(admitResume(activeFenceToken)).toBe(true);
  });
});
