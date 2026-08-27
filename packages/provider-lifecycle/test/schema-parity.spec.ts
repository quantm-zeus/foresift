/**
 * ADR-001 conformance for the provider-lifecycle schema namespace: the
 * Drizzle mirror must match SQL truth. The migrations are the source of
 * truth; this test enumerates every `prov`-schema table in
 * `information_schema` and compares columns, nullability, type classes, and
 * primary keys against the generated mirror (same arrangement as the proven
 * security package, scoped to the `prov` schema).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mirror from '../src/generated/schema.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

function asTable(value: unknown): ReturnType<typeof getTableConfig> | undefined {
  try {
    return getTableConfig(value as PgTable);
  } catch {
    return undefined;
  }
}

/** information_schema.data_type → drizzle column dataType class. */
const TYPE_CLASS: Record<string, string> = {
  text: 'string',
  integer: 'number',
  bigint: 'number',
  boolean: 'boolean',
  'timestamp with time zone': 'date',
  jsonb: 'json',
  ARRAY: 'array',
};

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

describe('prov-schema Drizzle mirror parity with SQL truth (ADR-001)', () => {
  it('applies all five g0_prov migrations over the full proven data/dr/sec set', async () => {
    const applied = await engine.query<{ id: string }>(
      `SELECT id FROM _foresift_schema_migrations WHERE id LIKE 'g0_prov%' ORDER BY id`,
    );
    expect(applied.rows.map((r) => r.id)).toEqual([
      'g0_prov_0001_provider_operations',
      'g0_prov_0002_verification_ttl',
      'g0_prov_0003_migration_exceptions',
      'g0_prov_0004_quarantine',
      'g0_prov_0005_rights_fingerprints',
    ]);
    // The proven data/dr/sec sets stay applied alongside — one migration truth.
    const families = await engine.query<{ family: string; n: string }>(
      `SELECT substring(id from '^g0_([a-z]+)_') AS family, count(*)::text AS n
       FROM _foresift_schema_migrations GROUP BY 1 ORDER BY 1`,
    );
    const counts = Object.fromEntries(families.rows.map((r) => [r.family, Number(r.n)]));
    expect(counts['data']).toBeGreaterThan(0);
    expect(counts['dr']).toBeGreaterThan(0);
    expect(counts['sec']).toBeGreaterThan(0);
    expect(counts['prov']).toBe(5);
  });

  it('adds zero tables to the public schema (proven parity contract untouched)', async () => {
    const publicTables = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'prov_%'
         OR table_schema = 'public' AND table_name LIKE '%quarantine%'
         OR table_schema = 'public' AND table_name LIKE '%fingerprint%'
         OR table_schema = 'public' AND table_name LIKE '%rights%'
         OR table_schema = 'public' AND table_name LIKE '%lifecycle%'
         OR table_schema = 'public' AND table_name LIKE 'verification_%'`,
    );
    expect(publicTables.rows).toHaveLength(0);
  });

  it('mirrors exactly the prov-schema table set', async () => {
    const sqlTables = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'prov' ORDER BY table_name`,
    );
    const sqlNames = sqlTables.rows.map((r) => r.table_name).sort();
    const mirrorNames = Object.values(mirror)
      .map((v) => asTable(v)?.name)
      .filter((n): n is string => n !== undefined)
      .sort();
    expect(mirrorNames.length).toBe(13);
    expect(mirrorNames).toEqual(sqlNames);
  });

  it('matches every column: name, nullability, and type class', async () => {
    const failures: string[] = [];
    for (const entry of Object.values(mirror)) {
      const config = asTable(entry);
      if (!config) continue;
      const sqlCols = await engine.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'prov' AND table_name = $1
         ORDER BY ordinal_position`,
        [config.name],
      );
      if (sqlCols.rows.length === 0) {
        failures.push(`${config.name}: exists in mirror but not in SQL`);
        continue;
      }
      const byNameSql = new Map(sqlCols.rows.map((c) => [c.column_name, c]));
      const byNameMirror = new Map(config.columns.map((c) => [c.name, c]));
      for (const col of config.columns) {
        const sqlCol = byNameSql.get(col.name);
        if (!sqlCol) {
          failures.push(`${config.name}.${col.name}: in mirror but missing in SQL`);
          continue;
        }
        const expectedClass = TYPE_CLASS[sqlCol.data_type];
        if (expectedClass === undefined) {
          failures.push(`${config.name}.${col.name}: unmapped SQL type ${sqlCol.data_type}`);
        } else if (col.dataType !== expectedClass) {
          failures.push(
            `${config.name}.${col.name}: mirror type ${col.dataType} != SQL ${sqlCol.data_type} (${expectedClass})`,
          );
        }
        if (col.notNull !== (sqlCol.is_nullable === 'NO')) {
          failures.push(
            `${config.name}.${col.name}: nullability mismatch (mirror notNull=${String(col.notNull)}, SQL=${sqlCol.is_nullable})`,
          );
        }
      }
      for (const [name] of byNameSql) {
        if (!byNameMirror.has(name)) {
          failures.push(`${config.name}.${name}: in SQL but missing in mirror`);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('matches primary keys on every prov table', async () => {
    const sqlPks = await engine.query<{ table_name: string; pk_cols: string[] }>(
      `SELECT tc.table_name,
              ARRAY_AGG(kcu.column_name ORDER BY kcu.ordinal_position) AS pk_cols
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'prov' AND tc.constraint_type = 'PRIMARY KEY'
       GROUP BY tc.table_name`,
    );
    const sqlPkMap = new Map(sqlPks.rows.map((r) => [r.table_name, [...r.pk_cols].sort()]));
    let matched = 0;
    for (const entry of Object.values(mirror)) {
      const config = asTable(entry);
      if (!config) continue;
      const expected = sqlPkMap.get(config.name);
      expect(expected, `${config.name} has a PK in SQL`).toBeDefined();
      const mirrorPk = config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name));
      const singleColPk = config.columns.filter((c) => c.primary).map((c) => c.name);
      const actual = [...mirrorPk, ...singleColPk].sort();
      expect(actual, `${config.name} PK matches`).toEqual(expected!);
      matched += 1;
    }
    expect(matched).toBe(13);
  });
});
