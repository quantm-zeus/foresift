/**
 * AC-224 acceptance (positive) — Cost & Collector Checkpoint facet.
 * Traces: FR-COST-001, FR-COST-005.
 * AC text: "The supported-program collector reconnects from a killed connection, resumes
 * from its durable checkpoint, detects the induced slot gap, backfills or marks it unresolved,
 * and produces no duplicate canonical event."
 *
 * Facet scope (Cost control plane):
 * - Resuming from a checkpoint after killed connection does NOT duplicate quota reservations.
 * - Gap detection accounting maintains consistent quota ledger balances through resume and replay.
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

describe('AC-224 acceptance (cost facet): checkpoint resume prevents duplicate quota reservations', () => {
  it('resumes collection without creating duplicate quota reservations for already-reserved events', async () => {
    let QuotaModule: Record<string, unknown>;
    try {
      QuotaModule = (await import(
        '../../packages/cost-router/src/quota-adapter.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('COST_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const IdempotentReservationTracker = QuotaModule.IdempotentReservationTracker as new (
      engine: unknown,
    ) => {
      reserveForSlot: (slot: number, op: string) => Promise<{ reservationId: string; isDuplicate: boolean }>;
      getReservationCount: () => Promise<number>;
    };

    const tracker = new IdempotentReservationTracker(tdb.engine);

    // First run up to slot 100
    const res1 = await tracker.reserveForSlot(100, 'stream_program_events');
    expect(res1.isDuplicate).toBe(false);

    // Reconnect & resume at slot 100
    const resResume = await tracker.reserveForSlot(100, 'stream_program_events');
    expect(resResume.isDuplicate).toBe(true);
    expect(resResume.reservationId).toBe(res1.reservationId);

    // Reservation count in DB must be exactly 1
    const count = await tracker.getReservationCount();
    expect(count).toBe(1);
  });
});
