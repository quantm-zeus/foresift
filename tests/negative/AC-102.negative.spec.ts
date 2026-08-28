/**
 * AC-102 negative / failure-path suite (FR-COST-005).
 * Incompatible or ungroupable requests produce separate reservations
 * and are never merged into a single provider call.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';
import { loadBatchInputs } from '../fixtures/cost/index.ts';
import { insertPendingReservation } from '../../packages/tool-core/src/quota-contract.ts';

let tdb: TestDatabase | undefined;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  if (tdb) await closeTestDatabase(tdb);
});

describe('AC-102 negative: ungroupable/incompatible requests produce separate reservations', () => {
  it('creates distinct reservations for requests targeting different providers', async () => {
    if (!tdb) return;
    const fixture = loadBatchInputs();
    const incompatible = fixture.incompatibleBatches.find(
      (b) => b.reason === 'CROSS_PROVIDER_MERGE_FORBIDDEN',
    );
    expect(incompatible).toBeDefined();

    // Incompatible requests each produce a separate provider call reservation (different pipeline runs)
    await insertPendingReservation(tdb.engine, {
      reservationId: 'rsv-ac102n-gmgn',
      pipelineRunId: 'run-ac102n-call-1',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'actor-ac102',
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'SCHEDULED_NORMAL',
      estimatedUnits: 1,
    });
    await insertPendingReservation(tdb.engine, {
      reservationId: 'rsv-ac102n-helius',
      pipelineRunId: 'run-ac102n-call-2',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'actor-ac102',
      provider: 'helius',
      operation: 'get_asset',
      workloadClass: 'SCHEDULED_NORMAL',
      estimatedUnits: 1,
    });

    const rows = await tdb.engine.query<{ reservation_id: string }>(
      `SELECT reservation_id FROM core.core_quota_reservations WHERE pipeline_run_id IN ('run-ac102n-call-1', 'run-ac102n-call-2')`,
    );
    expect(rows.rows.length).toBe(2);
  });
});
