/**
 * SQL-truth structural rules for collector-core migrations (g0_col_*).
 * Tests migration discovery, ordering, checksums, and idempotent apply on PGlite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  discoverMigrations,
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

describe('g0_col_* SQL migrations (collector-core)', () => {
  it('discovers known collector migration scripts in exact lexicographic order with sha256 checksums', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const colMigrations = all.filter((m) => m.id.startsWith('g0_col_'));
    expect(colMigrations.map((m) => m.id)).toEqual([
      'g0_col_0001_scopes_partitions',
      'g0_col_0002_stream_receipts',
      'g0_col_0003_incidents_decodescope',
      'g0_col_0004_health_ceiling',
    ]);
    for (const m of colMigrations) {
      expect(m.checksum.startsWith('sha256:')).toBe(true);
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('applies migrations idempotently', async () => {
    const report1 = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(report1.applied.length).toBeGreaterThanOrEqual(0);

    const report2 = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(report2.applied.length).toBe(0);
  }, 60_000);
});
