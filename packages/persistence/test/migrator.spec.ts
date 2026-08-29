import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import {
  appliedMigrations,
  applyMigrations,
  clearMigrationLeases,
  createEngine,
  discoverMigrations,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  SCHEMA_MIGRATION_LEASES_TABLE,
  SCHEMA_MIGRATIONS_TABLE,
  type DatabaseEngine,
} from '../src/index.ts';
import { ErrorCode, ForesiftError } from '@foresift/domain';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

/**
 * Sandbox dirs are namespaced PER PROCESS: the full suite legitimately runs
 * twice concurrently (outer bun test run + the nested gate e2e child), and
 * fixed-path scratch dirs made the two instances trample each other's
 * migration-refusal fixtures.
 */
const RUN_TAG = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

describe('migration suite shape (+AC-243 probe assignments)', () => {
  it('discovers exactly the G0 scripts in lexicographic order', async () => {
    const migrations = await discoverMigrations(MIGRATIONS_DIR);
    expect(migrations.map((m) => m.id)).toEqual([
      'g0_core_0001_tool_registry',
      'g0_core_0002_single_flight_leases',
      'g0_core_0003_quota_reservations',
      'g0_core_0004_exact_cache',
      'g0_cost_0001_cost_ledgers',
      'g0_cost_0002_paid_policies',
      'g0_cost_0003_capacity_budgets',
      'g0_cost_0004_resource_forecast_snapshots',
      'g0_col_0001_scope_manifests',
      'g0_col_0002_stream_records',
      'g0_col_0003_checkpoints_gaps',
      'g0_col_0004_collector_health_incidents',
      'g0_data_0001_identity',
      'g0_data_0002_observations_revisions',
      'g0_data_0003_quality_sources',
      'g0_data_0004_features_acquisition',
      'g0_data_0005_object_artifact_index',
      'g0_data_0006_probe_assignments',
      'g0_data_0007_checkpoints_gaps',
      'g0_disc_0001_universe_registry',
      'g0_disc_0002_cheap_monitor',
      'g0_disc_0003_promotion_decisions',
      'g0_dr_0001_recovery_tiers',
      'g0_dr_0002_backup_policy',
      'g0_dr_0003_incidents',
      'g0_dr_0004_tier_measurement_incident_fk',
      'g0_dr_0005_health_state_incident_fk',
      'g0_prov_0001_provider_operations',
      'g0_prov_0002_verification_ttl',
      'g0_prov_0003_migration_exceptions',
      'g0_prov_0004_quarantine',
      'g0_prov_0005_rights_fingerprints',
      'g0_sec_0001_audit_chain',
      'g0_sec_0002_mcp_credentials',
      'g0_sec_0003_import_quarantine',
      'g0_sec_0004_incidents_pauses',
    ]);
    for (const m of migrations) {
      expect(m.checksum.startsWith('sha256:')).toBe(true);
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('applyMigrations (FR-DATA-001…006, FR-DR-001/002 foundation)', () => {
  let db: PGlite;
  let engine: DatabaseEngine;

  beforeAll(() => {
    db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    engine = createEngine(db, 'pglite');
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies all G0 scripts to an empty database and records state', async () => {
    const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(report.applied.length).toBe(36);
    expect(report.skipped).toEqual([]);

    const recorded = await appliedMigrations(engine);
    expect(recorded.map((r) => r.id)).toEqual([
      'g0_core_0001_tool_registry',
      'g0_core_0002_single_flight_leases',
      'g0_core_0003_quota_reservations',
      'g0_core_0004_exact_cache',
      'g0_cost_0001_cost_ledgers',
      'g0_cost_0002_paid_policies',
      'g0_cost_0003_capacity_budgets',
      'g0_cost_0004_resource_forecast_snapshots',
      'g0_col_0001_scope_manifests',
      'g0_col_0002_stream_records',
      'g0_col_0003_checkpoints_gaps',
      'g0_col_0004_collector_health_incidents',
      'g0_data_0001_identity',
      'g0_data_0002_observations_revisions',
      'g0_data_0003_quality_sources',
      'g0_data_0004_features_acquisition',
      'g0_data_0005_object_artifact_index',
      'g0_data_0006_probe_assignments',
      'g0_data_0007_checkpoints_gaps',
      'g0_disc_0001_universe_registry',
      'g0_disc_0002_cheap_monitor',
      'g0_disc_0003_promotion_decisions',
      'g0_dr_0001_recovery_tiers',
      'g0_dr_0002_backup_policy',
      'g0_dr_0003_incidents',
      'g0_dr_0004_tier_measurement_incident_fk',
      'g0_dr_0005_health_state_incident_fk',
      'g0_prov_0001_provider_operations',
      'g0_prov_0002_verification_ttl',
      'g0_prov_0003_migration_exceptions',
      'g0_prov_0004_quarantine',
      'g0_prov_0005_rights_fingerprints',
      'g0_sec_0001_audit_chain',
      'g0_sec_0002_mcp_credentials',
      'g0_sec_0003_import_quarantine',
      'g0_sec_0004_incidents_pauses',
    ]);
  }, 120_000);

  it('applies twice without damage (idempotent)', async () => {
    const second = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(36);

    // The full table set still exists exactly once each.
    const tables = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('observations','recovery_tiers','watermarks')
       ORDER BY table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'observations',
      'recovery_tiers',
      'watermarks',
    ]);
  });

  it('refuses checksum drift on an already-applied migration', async () => {
    const recorded = await appliedMigrations(engine);
    const first = recorded[0];
    if (!first) throw new Error('expected a recorded migration');
    await engine.query('UPDATE _foresift_schema_migrations SET checksum = $1 WHERE id = $2', [
      'sha256:deadbeef',
      first.id,
    ]);
    await expect(applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR })).rejects.toThrow(
      /checksum mismatch/,
    );
    // Restore honest state for later tests in this file.
    const migrations = await discoverMigrations(MIGRATIONS_DIR);
    const original = migrations.find((m) => m.id === first.id);
    if (!original) throw new Error('discovery lost the migration');
    await engine.query('UPDATE _foresift_schema_migrations SET checksum = $1 WHERE id = $2', [
      original.checksum,
      first.id,
    ]);
  });
});

describe('failure isolation', () => {
  it('a failing script aborts cleanly leaving prior recorded state intact', async () => {
    const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    const engine = createEngine(db, 'pglite');
    try {
      const dirBase = path.dirname(fileURLToPath(import.meta.url));
      const sandbox = path.join(dirBase, `.tmp-migration-sandbox-${RUN_TAG}`);
      const { mkdir, writeFile, rm } = await import('node:fs/promises');
      await rm(sandbox, { recursive: true, force: true });
      await mkdir(sandbox, { recursive: true });

      const good = await readFileAsync(path.join(MIGRATIONS_DIR, 'g0_data_0001_identity.sql'));
      await writeFile(path.join(sandbox, 'g0_data_0001_identity.sql'), good);
      // Second file references a nonexistent table → fails inside its tx.
      await writeFile(
        path.join(sandbox, 'g0_data_0002_broken.sql'),
        'CREATE TABLE depends_on_missing (id text REFERENCES does_not_exist(id));',
      );

      await expect(applyMigrations({ engine, migrationsDir: sandbox })).rejects.toThrow(
        /g0_data_0002_broken failed/,
      );

      // First migration stayed recorded; broken one did not.
      const recorded = await appliedMigrations(engine);
      expect(recorded.map((r) => r.id)).toEqual(['g0_data_0001_identity']);
      const broken = await engine.query("SELECT to_regclass('depends_on_missing') AS t");
      expect(broken.rows[0]?.t).toBeNull();

      // Re-pointing the id at valid SQL applies cleanly afterwards.
      await rm(sandbox, { recursive: true, force: true });
      await mkdir(sandbox, { recursive: true });
      await writeFile(path.join(sandbox, 'g0_data_0001_identity.sql'), good);
      await writeFile(
        path.join(sandbox, 'g0_data_0002_fixed.sql'),
        'CREATE TABLE fixed (id text);',
      );
      const retry = await applyMigrations({ engine, migrationsDir: sandbox });
      // 0001 stays recorded (skipped); the new valid id applies cleanly.
      expect(retry.applied).toEqual(['g0_data_0002_fixed']);
      expect(retry.skipped).toEqual(['g0_data_0001_identity']);

      const fixedTables = await engine.query("SELECT to_regclass('fixed') AS t");
      expect(fixedTables.rows[0]?.t).toBe('fixed');
      await rm(sandbox, { recursive: true, force: true });
    } finally {
      await db.close();
    }
  }, 120_000);
});

describe('migrator fail-closed defenses (FR-DATA-001…006 / FR-DR-001/002 substrate)', () => {
  const dirBase = path.dirname(fileURLToPath(import.meta.url));

  async function makeSandbox(name: string): Promise<string> {
    const sandbox = path.join(dirBase, `.tmp-${name}-${RUN_TAG}`);
    await rm(sandbox, { recursive: true, force: true });
    await mkdir(sandbox, { recursive: true });
    return sandbox;
  }

  async function freshEngine(): Promise<{ db: PGlite; engine: DatabaseEngine }> {
    const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    return { db, engine: createEngine(db, 'pglite') };
  }

  async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<ForesiftError> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForesiftError);
    const foresiftError = caught as ForesiftError;
    expect(foresiftError.code).toBe(code);
    return foresiftError;
  }

  it('refuses .sql files matching no known family instead of silently ignoring them', async () => {
    const { db, engine } = await freshEngine();
    try {
      const sandbox = await makeSandbox('unknown-family');
      await writeFile(
        path.join(sandbox, 'g0_data_0001_identity.sql'),
        await readFileAsync(path.join(MIGRATIONS_DIR, 'g0_data_0001_identity.sql')),
      );
      await writeFile(path.join(sandbox, 'legacy_v1_setup.sql'), 'CREATE TABLE legacy (id text);');

      const error = await expectCode(
        applyMigrations({ engine, migrationsDir: sandbox }),
        ErrorCode.MIGRATION_FILENAME_UNKNOWN,
      );
      expect(error.message).toContain('legacy_v1_setup.sql');
      // Nothing was applied and nothing recorded — refusal precedes any write.
      expect(await appliedMigrations(engine)).toEqual([]);

      // A non-.sql entry (e.g. a README) is not SQL truth and stays ignorable.
      await rm(path.join(sandbox, 'legacy_v1_setup.sql'));
      await writeFile(path.join(sandbox, 'README.md'), 'notes');
      const report = await applyMigrations({ engine, migrationsDir: sandbox });
      expect(report.applied).toEqual(['g0_data_0001_identity']);
    } finally {
      await db.close();
      await rm(path.join(dirBase, `.tmp-unknown-family-${RUN_TAG}`), {
        recursive: true,
        force: true,
      });
    }
  }, 120_000);

  it('applies future-generation g1_* scripts in lexicographic order (never silently dropped)', async () => {
    const { db, engine } = await freshEngine();
    try {
      const sandbox = await makeSandbox('g1-support');
      await writeFile(
        path.join(sandbox, 'g0_data_0001_identity.sql'),
        await readFileAsync(path.join(MIGRATIONS_DIR, 'g0_data_0001_identity.sql')),
      );
      await writeFile(
        path.join(sandbox, 'g1_dr_0009_future_family.sql'),
        'CREATE TABLE g1_future (id text);',
      );

      const report = await applyMigrations({ engine, migrationsDir: sandbox });
      expect(report.applied).toEqual(['g0_data_0001_identity', 'g1_dr_0009_future_family']);
      const tables = await engine.query("SELECT to_regclass('g1_future') AS t");
      expect(tables.rows[0]?.t).toBe('g1_future');
    } finally {
      await db.close();
      await rm(path.join(dirBase, `.tmp-g1-support-${RUN_TAG}`), {
        recursive: true,
        force: true,
      });
    }
  }, 120_000);

  it('refuses when a recorded migration id has no file on disk', async () => {
    const { db, engine } = await freshEngine();
    try {
      const sandbox = await makeSandbox('missing-file');
      const good = await readFileAsync(path.join(MIGRATIONS_DIR, 'g0_data_0001_identity.sql'));
      await writeFile(path.join(sandbox, 'g0_data_0001_identity.sql'), good);
      await applyMigrations({ engine, migrationsDir: sandbox });

      // The applied script disappears from disk; a different id appears.
      await rm(path.join(sandbox, 'g0_data_0001_identity.sql'));
      await writeFile(
        path.join(sandbox, 'g0_data_0002_replacement.sql'),
        'CREATE TABLE r (id text);',
      );

      const error = await expectCode(
        applyMigrations({ engine, migrationsDir: sandbox }),
        ErrorCode.MIGRATION_FILE_MISSING,
      );
      expect(error.message).toContain('g0_data_0001_identity');
      // Recorded history is untouched by the refusal.
      expect((await appliedMigrations(engine)).map((m) => m.id)).toEqual(['g0_data_0001_identity']);
    } finally {
      await db.close();
      await rm(path.join(dirBase, `.tmp-missing-file-${RUN_TAG}`), {
        recursive: true,
        force: true,
      });
    }
  }, 120_000);

  it('refuses a new migration sorting behind already-applied state (out of order)', async () => {
    const { db, engine } = await freshEngine();
    try {
      // Establish a database whose ONLY applied migration is 0002.
      const first = await makeSandbox('out-of-order-first');
      const sql0002 = 'CREATE TABLE only_0002 (id text);';
      await writeFile(path.join(first, 'g0_data_0002_standalone.sql'), sql0002);
      await applyMigrations({ engine, migrationsDir: first });

      // Now present 0001 as a latecomer: it sorts BEFORE the applied 0002.
      const second = await makeSandbox('out-of-order-second');
      await writeFile(
        path.join(second, 'g0_data_0001_latecomer.sql'),
        'CREATE TABLE latecomer (id text);',
      );
      await writeFile(path.join(second, 'g0_data_0002_standalone.sql'), sql0002);

      const error = await expectCode(
        applyMigrations({ engine, migrationsDir: second }),
        ErrorCode.MIGRATION_OUT_OF_ORDER_REFUSED,
      );
      expect(error.message).toContain('g0_data_0001_latecomer');

      // State intact: nothing new applied, nothing removed.
      expect((await appliedMigrations(engine)).map((m) => m.id)).toEqual([
        'g0_data_0002_standalone',
      ]);
      const latecomerTable = await engine.query("SELECT to_regclass('latecomer') AS t");
      expect(latecomerTable.rows[0]?.t).toBeNull();
    } finally {
      await db.close();
      await rm(path.join(dirBase, `.tmp-out-of-order-first-${RUN_TAG}`), {
        recursive: true,
        force: true,
      });
      await rm(path.join(dirBase, `.tmp-out-of-order-second-${RUN_TAG}`), {
        recursive: true,
        force: true,
      });
    }
  }, 120_000);

  it('fences a concurrent run through the lease table (INV-009)', async () => {
    const { db, engine } = await freshEngine();
    try {
      // A foreign holder pre-occupies the fence.
      await engine.exec(`CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATION_LEASES_TABLE} (
            lease_key text PRIMARY KEY, owner text NOT NULL,
            acquired_at timestamptz NOT NULL DEFAULT now())`);
      await engine.query(
        `INSERT INTO ${SCHEMA_MIGRATION_LEASES_TABLE} (lease_key, owner) VALUES ($1, $2)`,
        ['schema-migrations-apply', 'other-runner'],
      );

      const error = await expectCode(
        applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR }),
        ErrorCode.MIGRATION_APPLY_ALREADY_RUNNING,
      );
      expect(error.message).toContain('other-runner');
      expect(await appliedMigrations(engine)).toEqual([]);

      // Operator clears the stale fence explicitly…
      expect(await clearMigrationLeases(engine)).toBe(1);
      // …and the same call then applies cleanly.
      const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
      expect(report.applied.length).toBe(36);
    } finally {
      await db.close();
    }
  }, 120_000);

  it('two simultaneous runs on one engine: exactly one applies, one is fenced', async () => {
    const { db, engine } = await freshEngine();
    try {
      const outcomes = await Promise.allSettled([
        applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR }),
        applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR }),
      ]);
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const cause = rejected[0]?.reason;
      expect(cause).toBeInstanceOf(ForesiftError);
      expect((cause as ForesiftError).code).toBe(ErrorCode.MIGRATION_APPLY_ALREADY_RUNNING);

      // The winning run completed the full application.
      expect((await appliedMigrations(engine)).length).toBe(36);
      // The loser left no lease behind after its refusal cleanup.
      const leases = await engine.query(`SELECT * FROM ${SCHEMA_MIGRATION_LEASES_TABLE}`);
      expect(leases.rows).toHaveLength(0);
    } finally {
      await db.close();
    }
  }, 120_000);

  it('releases its own lease after success AND after a failed migration', async () => {
    const { db, engine } = await freshEngine();
    try {
      const sandbox = await makeSandbox('lease-release');
      await writeFile(
        path.join(sandbox, 'g0_data_0001_identity.sql'),
        await readFileAsync(path.join(MIGRATIONS_DIR, 'g0_data_0001_identity.sql')),
      );
      await writeFile(
        path.join(sandbox, 'g0_dr_0002_broken.sql'),
        'CREATE TABLE depends_on_missing (id text REFERENCES does_not_exist(id));',
      );

      // Failed application must still release the fence…
      await expectCode(
        applyMigrations({ engine, migrationsDir: sandbox }),
        ErrorCode.MIGRATION_APPLICATION_FAILED,
      );
      let leases = await engine.query(`SELECT owner FROM ${SCHEMA_MIGRATION_LEASES_TABLE}`);
      expect(leases.rows).toHaveLength(0);

      // …so the retry (with valid SQL) is not blocked.
      await rm(path.join(sandbox, 'g0_dr_0002_broken.sql'));
      await writeFile(
        path.join(sandbox, 'g0_dr_0003_recovery_tiers.sql'),
        await readFileAsync(path.join(MIGRATIONS_DIR, 'g0_dr_0001_recovery_tiers.sql')),
      );
      const retry = await applyMigrations({ engine, migrationsDir: sandbox });
      expect(retry.applied).toEqual(['g0_dr_0003_recovery_tiers']);
      expect(retry.skipped).toEqual(['g0_data_0001_identity']);

      leases = await engine.query(`SELECT owner FROM ${SCHEMA_MIGRATION_LEASES_TABLE}`);
      expect(leases.rows).toHaveLength(0);
    } finally {
      await db.close();
      await rm(path.join(dirBase, `.tmp-lease-release-${RUN_TAG}`), {
        recursive: true,
        force: true,
      });
    }
  }, 120_000);

  it('exposes the state-table name constant unchanged for restore checks', () => {
    expect(SCHEMA_MIGRATIONS_TABLE).toBe('_foresift_schema_migrations');
  });
});

async function readFileAsync(p: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(p, 'utf8');
}
