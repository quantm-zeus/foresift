/**
 * Schema parity check for the `trace` database schema (FR-TRACE-002 / AC-266).
 * Enumerates information_schema for table_schema = 'trace' and checks columns,
 * nullability, type classes, and primary keys against a package-local table-shape inventory.
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

interface ColumnInventory {
  readonly name: string;
  readonly dataType: string;
  readonly isNullable: boolean;
}

interface TableInventory {
  readonly tableName: string;
  readonly primaryKeys: readonly string[];
  readonly columns: readonly ColumnInventory[];
}

/**
 * Expected package-local shape inventory for the trace schema.
 */
const EXPECTED_TRACE_TABLES: Record<string, TableInventory> = {
  id_supersessions: {
    tableName: 'id_supersessions',
    primaryKeys: ['replaced_id'],
    columns: [
      { name: 'replaced_id', dataType: 'text', isNullable: false },
      { name: 'superseded_by_id', dataType: 'text', isNullable: false },
      { name: 'namespace', dataType: 'text', isNullable: false },
      { name: 'recorded_at', dataType: 'timestamp with time zone', isNullable: false },
      { name: 'reason', dataType: 'text', isNullable: false },
    ],
  },
  gate_evidence: {
    tableName: 'gate_evidence',
    primaryKeys: ['evidence_id'],
    columns: [
      { name: 'evidence_id', dataType: 'text', isNullable: false },
      { name: 'payload', dataType: 'jsonb', isNullable: false },
      { name: 'payload_sha256', dataType: 'text', isNullable: false },
      { name: 'signature', dataType: 'text', isNullable: false },
      { name: 'gate_kind', dataType: 'text', isNullable: false },
      { name: 'approver', dataType: 'text', isNullable: false },
      { name: 'issued_at', dataType: 'timestamp with time zone', isNullable: false },
      { name: 'expires_at', dataType: 'timestamp with time zone', isNullable: false },
      { name: 'revoked_at', dataType: 'timestamp with time zone', isNullable: true },
      { name: 'recorded_at', dataType: 'timestamp with time zone', isNullable: false },
    ],
  },
  decision_traces: {
    tableName: 'decision_traces',
    primaryKeys: ['trace_id'],
    columns: [
      { name: 'trace_id', dataType: 'text', isNullable: false },
      { name: 'decision_ref', dataType: 'text', isNullable: false },
      { name: 'requirement_ids', dataType: 'jsonb', isNullable: false },
      { name: 'policy_versions', dataType: 'jsonb', isNullable: false },
      { name: 'feature_versions', dataType: 'jsonb', isNullable: false },
      { name: 'model_versions', dataType: 'jsonb', isNullable: false },
      { name: 'tool_versions', dataType: 'jsonb', isNullable: false },
      { name: 'provider_versions', dataType: 'jsonb', isNullable: false },
      { name: 'adapter_versions', dataType: 'jsonb', isNullable: false },
      { name: 'artifact_versions', dataType: 'jsonb', isNullable: false },
      { name: 'test_release_id', dataType: 'text', isNullable: false },
      { name: 'conformance_release_id', dataType: 'text', isNullable: false },
      { name: 'manifest_sha256', dataType: 'text', isNullable: false },
      { name: 'release_report_id', dataType: 'text', isNullable: false },
      { name: 'recorded_at', dataType: 'timestamp with time zone', isNullable: false },
    ],
  },
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

describe('trace schema SQL parity (FR-TRACE-002, AC-266)', () => {
  it('applies g0_trace migrations and creates trace schema', async () => {
    const applied = await engine.query<{ id: string }>(
      `SELECT id FROM _foresift_schema_migrations WHERE id LIKE 'g0_trace%' ORDER BY id`,
    );
    expect(applied.rows.map((r) => r.id)).toEqual([
      'g0_trace_0001_trace_schema',
      'g0_trace_0002_decision_traces',
    ]);
  });

  it('mirrors exactly the expected trace-schema table inventory', async () => {
    const sqlTables = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'trace' ORDER BY table_name`,
    );
    const tableNames = sqlTables.rows.map((r) => r.table_name).sort();
    expect(tableNames).toEqual(Object.keys(EXPECTED_TRACE_TABLES).sort());
  });

  for (const [tableName, expected] of Object.entries(EXPECTED_TRACE_TABLES)) {
    it(`verifies columns and nullability for trace.${tableName}`, async () => {
      const sqlColumns = await engine.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'trace' AND table_name = $1
         ORDER BY ordinal_position`,
        [tableName],
      );

      const colMap = new Map(
        sqlColumns.rows.map((c) => [
          c.column_name,
          { dataType: c.data_type, isNullable: c.is_nullable === 'YES' },
        ]),
      );

      for (const col of expected.columns) {
        expect(colMap.has(col.name)).toBe(true);
        const actual = colMap.get(col.name)!;
        expect(actual.dataType).toBe(col.dataType);
        expect(actual.isNullable).toBe(col.isNullable);
      }
    });

    it(`verifies primary key constraints on trace.${tableName}`, async () => {
      const pkResult = await engine.query<{ column_name: string }>(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema = 'trace'
           AND tc.table_name = $1`,
        [tableName],
      );

      const pks = pkResult.rows.map((r) => r.column_name);
      expect(pks.sort()).toEqual([...expected.primaryKeys].sort());
    });
  }
});
