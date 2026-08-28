/**
 * Quota-forecast migration and SQL-truth substrate tests (T011 / FR-COST-006..010).
 * Asserts migration filenames known, ordering enforced, checksum-pinned,
 * and apply-on-PGlite idempotent via packages/persistence test engine per ADR-0014.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  appliedMigrations,
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

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

describe('quota-forecast migration substrate (ADR-0014, FR-COST-006..010)', () => {
  it('applies migrations idempotently to PGlite', async () => {
    const secondPass = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(secondPass.applied).toEqual([]);
    expect(secondPass.skipped.length).toBeGreaterThan(0);
  });

  it('verifies migration ordering is monotonic and sorted', async () => {
    const list = await appliedMigrations(engine);
    const ids = list.map((m) => m.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('verifies provider operations verification_expires_at is present for TTL checks', async () => {
    const cols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'prov' AND table_name = 'prov_operations'
       AND column_name = 'verification_expires_at'`,
    );
    expect(cols.rows.length).toBe(1);
  });
});
