/**
 * TransactionalEngine semantics: atomic commit/rollback at depth 0 and
 * savepoint-scoped nesting. Every repository boundary guard relies on these
 * two primitives ("committed on success, rolled back on throw"), so a
 * regression here would silently change the failure mode of every write
 * path in the data-truth layer.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { utcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '../src/index.ts';

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
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

async function storedKeys(): Promise<string[]> {
  const rows = await engine.query<{ canonical_key: string }>(
    "SELECT canonical_key FROM canonical_event_keys WHERE event_family = 'tx_probe' ORDER BY canonical_key",
  );
  return rows.rows.map((r) => r.canonical_key);
}

async function insertKey(tx: DatabaseEngine, key: string): Promise<void> {
  await tx.query(
    'INSERT INTO canonical_event_keys (canonical_key, event_family, first_seen_at) VALUES ($1,$2,$3)',
    [key, 'tx_probe', utcTimestamp('2026-07-01T00:00:00Z')],
  );
}

describe('depth-0 transaction atomicity', () => {
  it('persists the whole unit on success', async () => {
    await engine.transaction(async (tx) => {
      await insertKey(tx, 'tx-commit:a');
      await insertKey(tx, 'tx-commit:b');
    });
    expect(await storedKeys()).toEqual(expect.arrayContaining(['tx-commit:a', 'tx-commit:b']));
  });

  it('rolls back EVERY statement of the unit when work throws', async () => {
    await insertKey(engine, 'tx-rollback:preexisting');
    await expect(
      engine.transaction(async (tx) => {
        await insertKey(tx, 'tx-rollback:before-failure');
        throw new Error('simulated mid-unit failure');
      }),
    ).rejects.toThrowError(/simulated mid-unit failure/);
    const keys = await storedKeys();
    expect(keys).toContain('tx-rollback:preexisting');
    expect(keys).not.toContain('tx-rollback:before-failure');
  });
});

describe('nested transactions use savepoints', () => {
  it('a caught inner failure rolls back only its own scope; the outer unit commits', async () => {
    await engine.transaction(async (outer) => {
      await insertKey(outer, 'tx-sp:outer');
      try {
        await outer.transaction(async (inner) => {
          await insertKey(inner, 'tx-sp:doomed');
          throw new Error('inner failure');
        });
      } catch {
        // Recovered INSIDE the outer unit: only the savepoint rewinds.
      }
      await insertKey(outer, 'tx-sp:after-inner');
    });
    const keys = await storedKeys();
    expect(keys).toContain('tx-sp:outer');
    expect(keys).toContain('tx-sp:after-inner');
    expect(keys).not.toContain('tx-sp:doomed');
  });

  it('an uncaught inner failure rolls back the entire outer unit', async () => {
    await insertKey(engine, 'tx-sp2:preexisting');
    await expect(
      engine.transaction(async (outer) => {
        await insertKey(outer, 'tx-sp2:outer');
        await outer.transaction(async (inner) => {
          await insertKey(inner, 'tx-sp2:inner');
          throw new Error('uncontained inner failure');
        });
      }),
    ).rejects.toThrowError(/uncontained inner failure/);
    const keys = await storedKeys();
    expect(keys).toContain('tx-sp2:preexisting');
    expect(keys).not.toContain('tx-sp2:outer');
    expect(keys).not.toContain('tx-sp2:inner');
  });
});
