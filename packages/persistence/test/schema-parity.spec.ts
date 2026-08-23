/**
 * ADR-001 conformance (T022): the Drizzle mirror must match SQL truth.
 * The migrations are the source of truth; this test enumerates every
 * foresift table in `information_schema` and compares columns, nullability,
 * type classes, and primary keys against the generated mirror.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';

/** Introspect a mirror export; undefined when it is not a table. */
function asTable(value: unknown): ReturnType<typeof getTableConfig> | undefined {
  try {
    return getTableConfig(value as PgTable);
  } catch {
    return undefined;
  }
}
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, createEngine, type DatabaseEngine } from '../src/index.ts';
import * as mirror from '../src/generated/schema.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

/** information_schema.data_type → drizzle column dataType class. */
const TYPE_CLASS: Record<string, string> = {
  text: 'string',
  integer: 'number',
  bigint: 'number',
  'double precision': 'number',
  numeric: 'string',
  boolean: 'boolean',
  'timestamp with time zone': 'date',
  jsonb: 'json',
  ARRAY: 'array',
};

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite();
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('Drizzle mirror parity with SQL truth (T022, ADR-001)', () => {
  it('mirrors exactly the table set created by the migrations', async () => {
    const sqlTables = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name NOT LIKE '_foresift%'
       ORDER BY table_name`,
    );
    const sqlNames = sqlTables.rows.map((r) => r.table_name).sort();

    const mirrorNames = Object.values(mirror)
      .map((v) => asTable(v)?.name)
      .filter((n): n is string => n !== undefined)
      .sort();

    expect(mirrorNames.length).toBeGreaterThan(30);
    expect(mirrorNames).toEqual(sqlNames);
  });

  it('matches every column: name, nullability, and type class', async () => {
    const failures: string[] = [];

    for (const entry of Object.values(mirror)) {
      const config = asTable(entry);
      if (!config) continue; // non-table export
      const sqlCols = await engine.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        udt_name: string;
      }>(
        `SELECT column_name, data_type, is_nullable, udt_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
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

  it('matches primary keys on every table', async () => {
    const sqlPks = await engine.query<{ table_name: string; pk_cols: string[] }>(
      `SELECT tc.table_name,
              ARRAY_AGG(kcu.column_name ORDER BY kcu.ordinal_position) AS pk_cols
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
       GROUP BY tc.table_name`,
    );
    const sqlPkMap = new Map(sqlPks.rows.map((r) => [r.table_name, [...r.pk_cols].sort()]));

    for (const entry of Object.values(mirror)) {
      const config = asTable(entry);
      if (!config) continue;
      // Composite PKs come from the extra config; single-column .primaryKey()
      // defs are flagged on the column itself.
      const mirrorPk = [
        ...config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)),
        ...config.columns.filter((c) => c.primary).map((c) => c.name),
      ];
      const expected = sqlPkMap.get(config.name);
      expect(expected, `${config.name} missing PK in SQL`).toBeDefined();
      expect([...mirrorPk].sort(), `${config.name} PK mismatch`).toEqual(expected);
    }
  });
});
