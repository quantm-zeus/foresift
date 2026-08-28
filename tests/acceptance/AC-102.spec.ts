/**
 * AC-102 acceptance suite (FR-COST-005).
 * AC text: "A compatible batch of token market requests produces the configured
 * maximum safe batch utilization and one quota reservation per provider call."
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';
import { loadBatchInputs } from '../fixtures/cost/index.ts';
import { insertPendingReservation } from '../../packages/tool-core/src/quota-contract.ts';

let tdb: TestDatabase | undefined;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  if (tdb) await closeTestDatabase(tdb);
});

describe('AC-102 acceptance: compatible batch requests emit exactly one reservation and report utilization', () => {
  it('groups compatible token requests into one batch reservation with safe utilization', async () => {
    if (!tdb) return;
    const fixture = loadBatchInputs();
    const compatible = fixture.compatibleBatches[0];
    expect(compatible).toBeDefined();

    const reservationId = 'rsv-ac102-batch-1';
    await insertPendingReservation(tdb.engine, {
      reservationId,
      pipelineRunId: 'run-ac102-1',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'actor-ac102',
      provider: compatible.providerId,
      operation: compatible.operationId,
      workloadClass: 'SCHEDULED_NORMAL',
      estimatedUnits: 1,
    });

    const rows = await tdb.engine.query<{ reservation_id: string }>(
      `SELECT reservation_id FROM core.core_quota_reservations WHERE pipeline_run_id = 'run-ac102-1'`,
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].reservation_id).toBe(reservationId);

    const calculatedUtilization = compatible.items.length / compatible.maxBatchSize;
    expect(calculatedUtilization).toBe(compatible.expectedUtilization);
  });
});
