/**
 * Quota extension-point contract units (FR-CORE-007): the lifecycle helpers
 * drive the Phase-B guarded SQL with typed illegal-edge refusals carrying
 * the row's current state, and the shipped default adapter is the
 * deny-closed test double living OUTSIDE src/ — unknown cost refuses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  commitReservation,
  expireReservation,
  insertPendingReservation,
  releaseReservation,
  reserveReservation,
} from '../src/quota-contract.ts';
import { DenyClosedQuotaAdapter } from '../../../tests/fixtures/core/deny-closed-quota-adapter.ts';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url).pathname;
const T0 = '2026-08-01T00:00:00Z';

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

async function seed(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await insertPendingReservation(engine, {
    reservationId: id,
    pipelineRunId: `run-${id}`,
    stage: 'ATOMICALLY_RESERVE_QUOTA',
    actorId: 'actor-1',
    provider: 'gmgn',
    operation: 'token_security',
    workloadClass: 'INTERACTIVE_HIGH',
    estimatedUnits: 2,
    ...over,
  });
}

describe('reservation lifecycle helpers', () => {
  it('walks PENDING → RESERVED → COMMITTED recording actual units once', async () => {
    await seed('walk-1');
    await reserveReservation(engine, { reservationId: 'walk-1', at: T0 });
    await commitReservation(engine, { reservationId: 'walk-1', actualUnits: 3, at: T0 });
    const row = await engine.query<{ state: string; actual_units: string }>(
      `SELECT state, actual_units FROM core.core_quota_reservations WHERE reservation_id = 'walk-1'`,
    );
    expect(row.rows[0]?.state).toBe('COMMITTED');
    expect(row.rows[0]?.actual_units).toBe('3');
  });

  it.each([
    ['commit', 'pending-commit'],
    ['release', 'pending-release'],
  ] as const)('%s from PENDING behaves per the §16.7 matrix', async (op, id) => {
    await seed(id);
    if (op === 'commit') {
      // PENDING → COMMITTED is not a legal edge.
      await expect(
        commitReservation(engine, { reservationId: id, actualUnits: 1, at: T0 }),
      ).rejects.toMatchObject({
        code: 'QUOTA_RESERVATION_TRANSITION_ILLEGAL',
        detail: { from: 'PENDING' },
      });
    } else {
      await expect(
        releaseReservation(engine, { reservationId: id, at: T0 }),
      ).resolves.toBeUndefined();
    }
  });

  it('illegal edges carry the CURRENT state in detail.from', async () => {
    await seed('illegal-1');
    await reserveReservation(engine, { reservationId: 'illegal-1', at: T0 });
    await commitReservation(engine, { reservationId: 'illegal-1', actualUnits: 1, at: T0 });
    // COMMITTED → RELEASED refused; from=COMMITTED.
    await expect(
      releaseReservation(engine, { reservationId: 'illegal-1', at: T0 }),
    ).rejects.toMatchObject({
      code: 'QUOTA_RESERVATION_TRANSITION_ILLEGAL',
      detail: { from: 'COMMITTED' },
    });
    // Unknown ids refuse as missing.
    await expect(
      releaseReservation(engine, { reservationId: 'no-such-id', at: T0 }),
    ).rejects.toMatchObject({
      code: 'QUOTA_RESERVATION_TRANSITION_ILLEGAL',
      detail: { from: null },
    });
  });

  it('expires RESERVED reservations; an EXPIRED row is terminal for release', async () => {
    await seed('expire-1');
    await reserveReservation(engine, { reservationId: 'expire-1', at: T0 });
    await expireReservation(engine, { reservationId: 'expire-1', at: T0 });
    const row = await engine.query<{ state: string }>(
      `SELECT state FROM core.core_quota_reservations WHERE reservation_id = 'expire-1'`,
    );
    expect(row.rows[0]?.state).toBe('EXPIRED');
    await expect(
      releaseReservation(engine, { reservationId: 'expire-1', at: T0 }),
    ).rejects.toMatchObject({
      code: 'QUOTA_RESERVATION_TRANSITION_ILLEGAL',
      detail: { from: 'EXPIRED' },
    });
    // Expiring twice matches zero rows — the guard keeps EXPIRED terminal.
    await expect(
      expireReservation(engine, { reservationId: 'expire-1', at: T0 }),
    ).rejects.toMatchObject({
      code: 'QUOTA_RESERVATION_TRANSITION_ILLEGAL',
      detail: { from: 'EXPIRED' },
    });
  });

  it('enforces the (pipeline_run_id, stage) idempotency key on insert', async () => {
    const shared = { pipelineRunId: 'dup-run', stage: 'ATOMICALLY_RESERVE_QUOTA' };
    await seed('dup-a', shared);
    await expect(seed('dup-b', shared)).rejects.toThrow();
  });

  it('deny-closed default adapter refuses everything as UNKNOWN_COST', async () => {
    const adapter = new DenyClosedQuotaAdapter();
    await expect(
      adapter.estimate({
        provider: 'gmgn',
        operation: 'token_security',
        workloadClass: 'INTERACTIVE_HIGH',
      }),
    ).rejects.toThrow(/UNKNOWN_COST/);
    const admission = await adapter.admit({
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'INTERACTIVE_HIGH',
      estimate: { quotaModel: 'REQUESTS_PER_PERIOD', estimatedUnits: 1 },
    });
    expect(admission).toEqual({ allowed: false, reason: expect.stringMatching(/UNKNOWN_COST/) });
    await expect(
      adapter.reserve({
        pipelineRunId: 'r',
        stage: 's',
        actorId: 'a',
        provider: 'p',
        operation: 'o',
        workloadClass: 'INTERACTIVE_HIGH',
        estimate: { quotaModel: 'REQUESTS_PER_PERIOD', estimatedUnits: 1 },
      }),
    ).rejects.toThrow(/UNKNOWN_COST/);
    // Release converges silently — cleanup must not fail closed.
    await expect(adapter.release({ reservationId: 'never-existed' })).resolves.toBeUndefined();
  });
});
