/**
 * Shared PGlite bootstrap for the workflow-runtime engine-core suites (T019).
 * Mirrors `tests/acceptance/helpers.ts`: a fresh in-process PGlite database with
 * the full migration set applied (PGlite is the deterministic TEST engine only,
 * ADR-0014).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

export interface TestDatabase {
  readonly db: PGlite;
  readonly engine: DatabaseEngine;
}

/** Fresh database with every migration applied. */
export async function makeTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  return { db, engine };
}

export async function closeTestDatabase(tdb: TestDatabase): Promise<void> {
  await tdb.db.close();
}

/** The promise must reject with an error carrying exactly `code`. */
export async function expectForesiftError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const actual = err as { code?: string; name?: string };
    if (actual.code !== code) {
      throw new Error(
        `expected ForesiftError ${code}, got ${actual.name}: ${(err as Error).message}`,
      );
    }
    return;
  }
  throw new Error(`expected rejection with ForesiftError ${code}, but the call resolved`);
}

export const HASH_A = `sha256:${'a'.repeat(64)}`;
export const HASH_B = `sha256:${'b'.repeat(64)}`;
