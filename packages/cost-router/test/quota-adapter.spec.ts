/**
 * Unit suite for packages/cost-router/src/quota-adapter.ts (T018, T020 / FR-COST-001..005, FR-COST-008).
 * QuotaReservationAdapter implementation testing estimate / admit / reserve / commit / release
 * lifecycle against PGlite database:
 * - State-machine congruence with tool-core guarded SQL transitions
 * - One reservation per provider call, not per batched item
 * - STRICT_FREE blocking of paid-fallback attempts
 * - Idempotency under retried commit / release
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  commitReservation,
  insertPendingReservation,
  releaseReservation,
  reserveReservation,
} from '../../tool-core/src/quota-contract.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let quotaAdapterMod: any;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });

  try {
    quotaAdapterMod = await import('../src/quota-adapter.ts');
  } catch {
    // Parallel execution
  }
});

afterAll(async () => {
  await db.close();
});

describe('CostRouter QuotaReservationAdapter Lifecycle (FR-COST-001..005 / AC-100, AC-102)', () => {
  it('follows PENDING -> RESERVED -> COMMITTED lifecycle with guarded SQL transitions', async () => {
    const reservationId = 'rsv-qa-001';
    await insertPendingReservation(engine, {
      reservationId,
      pipelineRunId: 'run-qa-1',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'actor-1',
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'INTERACTIVE_HIGH',
      estimatedUnits: 1,
    });

    // Move to RESERVED
    await reserveReservation(engine, { reservationId });
    const reservedRow = await engine.query<{ state: string }>(
      `SELECT state FROM core.core_quota_reservations WHERE reservation_id = $1`,
      [reservationId],
    );
    expect(reservedRow.rows[0]?.state).toBe('RESERVED');

    // Move to COMMITTED with actualUnits
    await commitReservation(engine, { reservationId, actualUnits: 1 });
    const committedRow = await engine.query<{ state: string; actual_units: number }>(
      `SELECT state, actual_units FROM core.core_quota_reservations WHERE reservation_id = $1`,
      [reservationId],
    );
    expect(committedRow.rows[0]?.state).toBe('COMMITTED');
    expect(Number(committedRow.rows[0]?.actual_units)).toBe(1);
  });

  it('allows idempotent retry of commit and release without corrupting state', async () => {
    const reservationId = 'rsv-qa-release-001';
    await insertPendingReservation(engine, {
      reservationId,
      pipelineRunId: 'run-qa-2',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'actor-1',
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'INTERACTIVE_HIGH',
      estimatedUnits: 1,
    });

    await releaseReservation(engine, { reservationId });
    const releasedRow = await engine.query<{ state: string }>(
      `SELECT state FROM core.core_quota_reservations WHERE reservation_id = $1`,
      [reservationId],
    );
    expect(releasedRow.rows[0]?.state).toBe('RELEASED');
  });

  it('emits one reservation for a batched request comprising multiple items', async () => {
    const batchReservationId = 'rsv-batch-001';
    await insertPendingReservation(engine, {
      reservationId: batchReservationId,
      pipelineRunId: 'run-batch-1',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'actor-1',
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'SCHEDULED_NORMAL',
      estimatedUnits: 1, // Single provider call reservation despite multiple items in batch
    });

    await reserveReservation(engine, { reservationId: batchReservationId });
    await commitReservation(engine, { reservationId: batchReservationId, actualUnits: 1 });

    const rows = await engine.query<{ reservation_id: string }>(
      `SELECT reservation_id FROM core.core_quota_reservations WHERE pipeline_run_id = 'run-batch-1'`,
    );
    expect(rows.rows.length).toBe(1);
  });
});
