/**
 * AC-224 acceptance (positive) — cost-capacity facet (collector data-truth substrate owned elsewhere).
 * Traces: FR-COST-001, FR-COST-005.
 * AC text (manifest §39): "Collector reconnect / checkpoint resume does not duplicate
 * quota reservations or evidence linked to cost admission; gap detection's cost
 * accounting is consistent through resume/replay."
 *
 * Facet scope (cost-capacity):
 * - Collector reconnect and checkpoint resume path does not double-count quota reservations.
 * - Idempotency is preserved across replayed windows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';
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

describe('AC-224 acceptance (positive): collector resume does not duplicate quota reservations', () => {
  it('resuming checkpoint and replaying window creates exactly one quota reservation', async () => {
    const reservationPayload = {
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH' as const,
      actorId: 'collector_solana_1',
      pipelineRunId: 'collector_run_checkpoint_42',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      estimate: { quotaModel: 'REQUESTS_PER_PERIOD' as const, estimatedUnits: 1 },
    };

    // First attempt before simulated disconnect
    const rsv1 = await adapter.reserve(reservationPayload);

    // Replay after resume
    const rsv2 = await adapter.reserve(reservationPayload);

    expect(rsv1).toBe(rsv2);
  });
});
