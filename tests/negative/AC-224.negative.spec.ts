/**
 * AC-224 negative / failure-path suite (cost facet: FR-COST-001, FR-COST-005).
 * Asserts that duplicate checkpoint resume attempts fail closed against double-charging quota.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';
import { insertPendingReservation } from '../../packages/tool-core/src/quota-contract.ts';

let tdb: TestDatabase | undefined;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  if (tdb) await closeTestDatabase(tdb);
});

describe('AC-224 negative: replayed checkpoint resume cannot double-insert quota reservation', () => {
  it('refuses duplicate reservation insertion under same reservation_id', async () => {
    if (!tdb) return;
    const reservationId = 'rsv-ac224n-dup';
    await insertPendingReservation(tdb.engine, {
      reservationId,
      pipelineRunId: 'run-ac224n-1',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'collector-shard-0',
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'SCHEDULED_NORMAL',
      estimatedUnits: 1,
    });

    await expect(
      insertPendingReservation(tdb.engine, {
        reservationId,
        pipelineRunId: 'run-ac224n-2',
        stage: 'ATOMICALLY_RESERVE_QUOTA',
        actorId: 'collector-shard-0',
        provider: 'gmgn',
        operation: 'token_security',
        workloadClass: 'SCHEDULED_NORMAL',
        estimatedUnits: 1,
      }),
    ).rejects.toThrow();
  });
});
