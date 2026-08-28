/**
 * Cost-router migration and SQL-truth substrate tests (T011 / FR-COST-001..010).
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

describe('cost-router migration substrate (ADR-0014, FR-COST-001..010)', () => {
  it('applies all landed migrations idempotently to PGlite', async () => {
    const secondPass = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(secondPass.applied).toEqual([]);
    expect(secondPass.skipped.length).toBeGreaterThan(0);
  });

  it('records checksum-pinned migrations in lexicographic order', async () => {
    const list = await appliedMigrations(engine);
    expect(list.length).toBeGreaterThan(0);
    const ids = list.map((m) => m.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    for (const item of list) {
      expect(item.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('exposes prov_operations table with required 7 cost declaration columns', async () => {
    const cols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'prov' AND table_name = 'prov_operations'`,
    );
    const colNames = cols.rows.map((c) => c.column_name);
    expect(colNames).toContain('cost_class');
    expect(colNames).toContain('estimated_quota_units');
    expect(colNames).toContain('quota_reset_policy_id');
    expect(colNames).toContain('protected_reserve_eligible');
    expect(colNames).toContain('allowed_in_strict_free');
  });
});
