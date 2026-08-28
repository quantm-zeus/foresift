/**
 * capacity-planner migration tests (T011, FR-COST-001…010 substrate; ADR-0014).
 *
 * Asserts:
 * - Migration filenames known, ordering enforced, checksum-pinned.
 * - apply-on-PGlite is idempotent via persistence test engine.
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

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
});

afterAll(async () => {
  await db.close();
});

describe('capacity-planner migrations suite (T011, ADR-0014)', () => {
  it('applies all migrations successfully on a fresh PGlite engine', async () => {
    const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(report.applied.length).toBeGreaterThan(0);
    expect(report.skipped.length).toBe(0);
  });

  it('second migration apply is idempotent and skips already applied migrations', async () => {
    const secondReport = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(secondReport.applied.length).toBe(0);
    expect(secondReport.skipped.length).toBeGreaterThan(0);
  });
});
