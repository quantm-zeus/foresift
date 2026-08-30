/**
 * SQL-truth structural rules for cheap-monitor migrations (g0_disc_*).
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

describe('g0_disc_* SQL migrations (cheap-monitor)', () => {
  it('discovers cheap-monitor migrations in order', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const discMigrations = all.filter((m) => m.id.startsWith('g0_disc_'));
    expect(discMigrations.map((m) => m.id)).toEqual([
      'g0_disc_0001_universe_entries',
      'g0_disc_0002_cheap_monitor',
      'g0_disc_0003_promotions',
    ]);
  }, 60_000);

  it('applies migrations idempotently', async () => {
    await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    const second = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(second.applied.length).toBe(0);
  }, 60_000);
});
