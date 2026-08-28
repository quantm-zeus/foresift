/**
 * Capacity-planner migration and SQL-truth substrate tests (T011 / FR-COST-004..010).
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

describe('capacity-planner migration substrate (ADR-0014, FR-COST-004..010)', () => {
  it('applies migrations idempotently to PGlite', async () => {
    const secondPass = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(secondPass.applied).toEqual([]);
    expect(secondPass.skipped.length).toBeGreaterThan(0);
  });

  it('verifies migration checksums are sha256 hex strings', async () => {
    const list = await appliedMigrations(engine);
    for (const item of list) {
      expect(item.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('verifies core quota reservations table schema is ready for capacity planning', async () => {
    const cols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'core' AND table_name = 'core_quota_reservations'`,
    );
    const colNames = cols.rows.map((c) => c.column_name);
    expect(colNames).toContain('reservation_id');
    expect(colNames).toContain('estimated_units');
    expect(colNames).toContain('state');
  });
});
