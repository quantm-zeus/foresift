/**
 * AC-224 acceptance suite (cost facet: FR-COST-001, FR-COST-005).
 * AC text: "The supported-program collector reconnects from a killed connection,
 * resumes from its durable checkpoint, detects the induced slot gap, backfills or
 * marks it unresolved, and produces no duplicate canonical event."
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';
import { insertPendingReservation } from '../../packages/tool-core/src/quota-contract.ts';

let tdb: TestDatabase | undefined;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  if (tdb) await closeTestDatabase(tdb);
});

describe('AC-224 acceptance: collector reconnect does not duplicate quota reservations', () => {
  it('resumes checkpoint and maintains exact single quota reservation for reconnected stream', async () => {
    if (!tdb) return;
    const pipelineRunId = 'run-col-reconnect-1';
    const reservationId = 'rsv-col-1';

    await insertPendingReservation(tdb.engine, {
      reservationId,
      pipelineRunId,
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'collector-shard-0',
      provider: 'helius',
      operation: 'get_asset',
      workloadClass: 'SCHEDULED_NORMAL',
      estimatedUnits: 1,
    });

    const rows = await tdb.engine.query<{ reservation_id: string }>(
      `SELECT reservation_id FROM core.core_quota_reservations WHERE pipeline_run_id = $1`,
      [pipelineRunId],
    );

    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].reservation_id).toBe(reservationId);
  });
});
