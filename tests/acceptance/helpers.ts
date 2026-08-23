/**
 * Shared bootstrap for the manifest-declared acceptance/negative suites
 * (T049–T062). Each suite gets a fresh in-process PGlite database with the ten
 * G0 migrations applied — PGlite is the deterministic TEST engine only
 * (ADR-0006); production remains real PostgreSQL per product ADR-001.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { parseChainId } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  ensureChain,
  insertDex,
  insertPool,
  type DatabaseEngine,
} from '@foresift/persistence';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

export interface TestDatabase {
  readonly db: PGlite;
  readonly engine: DatabaseEngine;
}

/** Fresh database, all G0 migrations applied. */
export async function makeTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  return { db, engine };
}

export async function closeTestDatabase(tdb: TestDatabase): Promise<void> {
  await tdb.db.close();
}

/**
 * Create the chain/dex/pool identity chain so observations may reference
 * `subject_pool_id` (the FK graph requires all three to exist).
 */
export async function seedPool(
  engine: DatabaseEngine,
  input: { chainId: string; dexId: string; poolAddress: string },
): Promise<string> {
  await ensureChain(engine, input.chainId);
  await insertDex(engine, input.chainId, input.dexId);
  const poolId = await insertPool(engine, {
    chainId: parseChainId(input.chainId),
    dexId: input.dexId,
    poolAddress: input.poolAddress,
  });
  return poolId;
}

/**
 * The promise must reject with a ForesiftError carrying exactly `code`
 * (fail-closed refusals are typed — a bare Error is not acceptable evidence).
 */
export async function expectForesiftError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const actual = err as { code?: string; name?: string };
    expect(
      actual.code,
      `expected ForesiftError ${code}, got ${actual.name}: ${(err as Error).message}`,
    ).toBe(code);
    return;
  }
  throw new Error(`expected rejection with ForesiftError ${code}, but the call resolved`);
}
