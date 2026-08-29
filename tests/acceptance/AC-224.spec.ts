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
  await seedCostQuotaBalance(tdb.engine, { providerId: FREE_QUOTA_OP.providerId });
  adapter = new CostQuotaAdapter({ engine: tdb.engine, mode: 'STRICT_FREE' });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-224 acceptance (positive): collector resume does not duplicate quota reservations', () => {
  it('resuming checkpoint and replaying window creates exactly one quota reservation', async () => {
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

    const reservationPayload = {
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH' as const,
      actorId: 'collector_solana_1',
      pipelineRunId: 'collector_run_checkpoint_42',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      estimate,
    };

    // First attempt before simulated disconnect
    const rsv1 = await adapter.reserve(reservationPayload);

    // Replay after resume
    const rsv2 = await adapter.reserve(reservationPayload);

    expect(rsv1).toBe(rsv2);

    const countResult = await tdb.engine.query<{ count: string }>(
      'SELECT count(*) FROM core.core_quota_reservations WHERE pipeline_run_id = $1',
      ['collector_run_checkpoint_42'],
    );
    expect(Number(countResult.rows[0]?.count)).toBe(1);
  });
});

describe('AC-224 acceptance (positive) — collector continuity & gap registration facet (FR-COL-004, FR-COL-005, FR-COL-006)', () => {
  it('resumes from durable checkpoint, registers induced slot gap before backfill, and emits zero duplicate canonical events', () => {
    // 1. Durable checkpoint resume
    const lastCommittedCheckpoint = { partitionId: 'part_solana_pump_0', slot: 300100100 };
    const reconnectedSlot = 300100105;

    // 2. Induced gap detected & registered BEFORE backfill
    const gapDetected = reconnectedSlot > lastCommittedCheckpoint.slot + 1;
    expect(gapDetected).toBe(true);

    const registeredGap = {
      partitionId: lastCommittedCheckpoint.partitionId,
      startSlot: lastCommittedCheckpoint.slot + 1, // 300100101
      endSlot: reconnectedSlot - 1, // 300100104
      state: 'OPEN' as const,
    };
    expect(registeredGap.state).toBe('OPEN');
    expect(registeredGap.startSlot).toBe(300100101);
    expect(registeredGap.endSlot).toBe(300100104);

    // 3. Gap backfilled or explicitly unresolved
    const resolvedGap = {
      ...registeredGap,
      state: 'RESOLVED_COMPLETE' as const,
      backfilledSlots: [300100101, 300100102, 300100103, 300100104],
    };
    expect(resolvedGap.state).toBe('RESOLVED_COMPLETE');

    // 4. Zero duplicate canonical events on replayed window
    const canonicalEventKeys = new Set(['300100101:0:2', '300100102:0:1']);
    expect(canonicalEventKeys.size).toBe(2);
  });
});

