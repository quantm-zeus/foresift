/**
 * ADR-001 conformance (T022): the Drizzle mirror must match SQL truth.
 * The migrations are the source of truth; this test enumerates every
 * foresift table in `information_schema` and compares columns, nullability,
 * type classes, and primary keys against the generated mirror.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  ALL_ACQUISITION_STATES,
  ALL_AVAILABILITY_PROVENANCE_CLASSES,
  ALL_QUALITY_CODES,
  RecoveryDataClass,
} from '@foresift/domain';
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
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '../src/index.ts';
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
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
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

describe('§13.9 quality-code vocabulary parity (SQL truth ↔ domain)', () => {
  it('the quality_codes seed table is exactly ALL_QUALITY_CODES', async () => {
    const rows = await engine.query<{ code: string }>('SELECT code FROM quality_codes');
    const sqlCodes = rows.rows.map((r) => r.code).sort();
    expect(sqlCodes).toEqual([...ALL_QUALITY_CODES].sort());
    expect(sqlCodes.length).toBeGreaterThanOrEqual(30);
  });

  it('every full `<@` allowlist CHECK is byte-equal to the domain vocabulary', async () => {
    const checks = await engine.query<{ table_name: string; def: string }>(
      `SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE contype = 'c' AND pg_get_constraintdef(oid) LIKE '%quality_codes <@%'`,
    );
    expect(checks.rows.length).toBeGreaterThanOrEqual(3); // observations, revisions, null-quantity rule

    let fullAllowlists = 0;
    for (const { table_name, def } of checks.rows) {
      const match = /ARRAY\[([^\]]*)\]/.exec(def);
      expect(match, `${table_name}: allowlist shape`).not.toBeNull();
      const codes = [...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
      // Every listed code must exist in the domain vocabulary…
      for (const code of codes) {
        expect(
          ALL_QUALITY_CODES.includes(code as never),
          `${table_name}: unknown quality code '${code}' in SQL allowlist`,
        ).toBe(true);
      }
      // …and any COMPLETE allowlist must be byte-equal to it (this is the
      // assertion that would have caught the OUTCOME_CENSURED typo).
      if (codes.length === ALL_QUALITY_CODES.length) {
        fullAllowlists += 1;
        expect([...codes].sort(), `${table_name} full allowlist drifts from domain`).toEqual(
          [...ALL_QUALITY_CODES].sort(),
        );
      }
    }
    // observations + observation_revisions + quality_sources + features.
    expect(fullAllowlists).toBeGreaterThanOrEqual(4);
  });

  it('admits the real §13.9 outcome codes and refuses the historical typo', async () => {
    const insertWithCodes = async (codes: string[], id: string): Promise<void> => {
      await engine.query(
        `INSERT INTO observations
           (observation_id, event_at, available_at, availability_provenance,
            quality_codes, receipt_hash)
         VALUES ($1, $2, $2, 'PROVIDER_LIVE_RESPONSE', $3::text[], $4)`,
        [id, '2026-06-13T09:00:00Z', codes, `sha256:${id.padEnd(64, '0').slice(0, 64)}`],
      );
    };
    await insertWithCodes(['OUTCOME_CENSORED'], 'obs_vocab_ok');
    await expect(insertWithCodes(['OUTCOME_CENSURED'], 'obs_vocab_typo')).rejects.toThrow();
  });

  it('every enum IN-list CHECK on a mirrored column equals its domain registry (M-5)', async () => {
    // Each SQL CHECK IN-list over these columns must be byte-equal (as a set)
    // to its domain vocabulary — mechanical parity that would have caught
    // C-1-class drift in ANY enum, not just quality codes.
    const cases: readonly {
      table: string;
      column: string;
      expected: readonly string[];
    }[] = [
      {
        table: 'observations',
        column: 'availability_provenance',
        expected: ALL_AVAILABILITY_PROVENANCE_CLASSES,
      },
      {
        table: 'observation_revisions',
        column: 'availability_provenance',
        expected: ALL_AVAILABILITY_PROVENANCE_CLASSES,
      },
      {
        table: 'evidence_acquisition_decisions',
        column: 'state',
        expected: ALL_ACQUISITION_STATES,
      },
      { table: 'recovery_tiers', column: 'data_class', expected: Object.values(RecoveryDataClass) },
      {
        table: 'protected_assets',
        column: 'data_class',
        expected: Object.values(RecoveryDataClass),
      },
    ];
    for (const c of cases) {
      const checks = await engine.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE contype = 'c'
           AND conrelid::regclass::text = $1
           AND pg_get_constraintdef(oid) LIKE '%${c.column}%'`,
        [c.table],
      );
      expect(
        checks.rows.length,
        `${c.table}.${c.column}: constraint present`,
      ).toBeGreaterThanOrEqual(1);
      const listed = new Set<string>();
      for (const { def } of checks.rows) {
        for (const m of def.matchAll(/'([A-Z][A-Z_]+)'/g)) {
          if (m[1] !== undefined) listed.add(m[1]);
        }
      }
      // The IN-list values are a subset of the constraint text; compare only
      // when this table's own list is complete (skip composite constraints).
      const fullList = [...listed].sort();
      expect(fullList.length > 0, `${c.table}.${c.column}: extracted values`).toBe(true);
      expect([...c.expected].sort(), `${c.table}.${c.column} drifts from domain registry`).toEqual(
        fullList,
      );
    }
  });
});
