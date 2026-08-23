import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMigrations,
  appliedMigrations,
  createEngine,
  discoverMigrations,
  type DatabaseEngine,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

describe('migration suite shape (T015–T019, +AC-243 probe assignments)', () => {
  it('discovers exactly the G0 scripts in lexicographic order', async () => {
    const migrations = await discoverMigrations(MIGRATIONS_DIR);
    expect(migrations.map((m) => m.id)).toEqual([
      'g0_data_0001_identity',
      'g0_data_0002_observations_revisions',
      'g0_data_0003_quality_sources',
      'g0_data_0004_features_acquisition',
      'g0_data_0005_object_artifact_index',
      'g0_data_0006_probe_assignments',
      'g0_dr_0001_recovery_tiers',
      'g0_dr_0002_backup_policy',
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
    db = new PGlite();
    engine = createEngine(db, 'pglite');
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies all eight to an empty database and records state', { timeout: 120_000 }, async () => {
    const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(report.applied.length).toBe(8);
    expect(report.skipped).toEqual([]);

    const recorded = await appliedMigrations(engine);
    expect(recorded.map((r) => r.id)).toEqual([
      'g0_data_0001_identity',
      'g0_data_0002_observations_revisions',
      'g0_data_0003_quality_sources',
      'g0_data_0004_features_acquisition',
      'g0_data_0005_object_artifact_index',
      'g0_data_0006_probe_assignments',
      'g0_dr_0001_recovery_tiers',
      'g0_dr_0002_backup_policy',
    ]);
  });

  it('applies twice without damage (idempotent)', async () => {
    const second = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(8);

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

describe('failure isolation (T021)', () => {
  it(
    'a failing script aborts cleanly leaving prior recorded state intact',
    { timeout: 120_000 },
    async () => {
      const db = new PGlite();
      const engine = createEngine(db, 'pglite');
      try {
        const dirBase = path.dirname(fileURLToPath(import.meta.url));
        const sandbox = path.join(dirBase, '.tmp-migration-sandbox');
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
    },
  );
});

async function readFileAsync(p: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(p, 'utf8');
}
