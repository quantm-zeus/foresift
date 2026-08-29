/**
 * SQL-truth structural rules for collector-solana migrations (g0_col_*).
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

describe('g0_col_* SQL migrations (collector-solana)', () => {
  it('discovers collector migrations in order', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const colMigrations = all.filter((m) => m.id.startsWith('g0_col_'));
    expect(colMigrations.map((m) => m.id)).toEqual([
      'g0_col_0001_scope_manifests',
      'g0_col_0002_stream_records',
      'g0_col_0003_checkpoints_gaps',
      'g0_col_0004_collector_health_incidents',
    ]);
  });

  it('applies migrations idempotently on PGlite', async () => {
    await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    const second = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(second.applied.length).toBe(0);
  });
});
