/**
 * SQL-truth structural rules for cheap-monitor migrations (g0_disc_* and g1_disc_*).
 * Traces: FR-DISC-009, FR-DISC-011, FR-DISC-013.
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

describe('disc migration family & rider SQL truth (cheap-monitor)', () => {
  it('discovers all discovery migration scripts in exact lexicographic order', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const discMigrations = all.filter(
      (m) => m.id.startsWith('g0_disc_') || m.id.startsWith('g1_disc_'),
    );
    expect(discMigrations.map((m) => m.id)).toEqual([
      'g0_disc_0001_universe_entries',
      'g0_disc_0002_cheap_monitor',
      'g0_disc_0003_promotions',
      'g1_disc_0001_source_profiles',
      'g1_disc_0002_constraints_gateways',
    ]);
    for (const m of discMigrations) {
      expect(m.checksum.startsWith('sha256:')).toBe(true);
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('applies migrations idempotently', async () => {
    const first = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(first.applied.length).toBeGreaterThanOrEqual(5);
    const second = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(second.applied.length).toBe(0);
  }, 60_000);

  it('adds population-rider columns to cheap_monitor_rows and promotion_decisions (FR-DISC-009, FR-DISC-011)', async () => {
    const monitorCols = await engine.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'cheap_monitor_rows'
         AND column_name IN ('population_manifest_id', 'entry_provenance_id')
       ORDER BY column_name`,
    );
    expect(monitorCols.rows).toEqual([
      { column_name: 'entry_provenance_id', is_nullable: 'YES' },
      { column_name: 'population_manifest_id', is_nullable: 'YES' },
    ]);

    const promoCols = await engine.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'promotion_decisions'
         AND column_name IN ('population_manifest_id', 'entry_provenance_id')
       ORDER BY column_name`,
    );
    expect(promoCols.rows).toEqual([
      { column_name: 'entry_provenance_id', is_nullable: 'YES' },
      { column_name: 'population_manifest_id', is_nullable: 'YES' },
    ]);
  });

  it('creates append-only cheap_monitor_population_riders and promotion_population_riders tables', async () => {
    const riderCols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'cheap_monitor_population_riders'
       ORDER BY ordinal_position`,
    );
    expect(riderCols.rows.map((r) => r.column_name)).toEqual([
      'monitor_id',
      'population_manifest_id',
      'entry_provenance_id',
      'recorded_at',
    ]);

    const promoRiderCols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'promotion_population_riders'
       ORDER BY ordinal_position`,
    );
    expect(promoRiderCols.rows.map((r) => r.column_name)).toEqual([
      'promotion_decision_id',
      'population_manifest_id',
      'entry_provenance_id',
      'monitor_id',
      'recorded_at',
    ]);
  });

  it('enforces append-only triggers on population rider tables (FR-DISC-009, FR-DISC-013)', async () => {
    // Seed prerequisite rows
    await engine.query(
      `INSERT INTO disc.coverage_population_manifests (
         manifest_id, population, source_scope, collector_scope,
         window_start, window_end, gaps, rights_exclusions, program_versions,
         selection_probabilities, known_missing_sources, source_dependence_assessment
       ) VALUES (
         'test_man_001', 'SUPPORTED_PROGRAM_UNIVERSE', '{"sourceIds":["src1"]}'::jsonb, '{"scopeIds":["col1"]}'::jsonb,
         '2026-08-20T10:00:00Z', '2026-08-20T11:00:00Z', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
         '{}'::jsonb, '[]'::jsonb, '{}'::jsonb
       ) ON CONFLICT (manifest_id) DO NOTHING`,
    );

    await engine.query(
      `INSERT INTO disc.discovery_universe_entries (
         entry_id, asset_representation_id, source_id, source_class, sighting_id, source_available_at,
         first_ingested_at, source_metadata_hash, discovery_policy_version, quality_codes
       ) VALUES (
         'test_entry_001', 'asset_001', 'src1', 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT', 'sighting_001', '2026-08-20T10:00:00Z',
         '2026-08-20T10:00:01Z', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '1.0.0', ARRAY[]::text[]
       ) ON CONFLICT (entry_id) DO NOTHING`,
    );

    await engine.query(
      `INSERT INTO disc.universe_entry_provenance (
         entry_id, normalized_identity_id, entry_reason, coverage_scope_ref,
         rights_record, query_filter_version, upstream_dependence_disclosed, first_party_observed
       ) VALUES (
         'test_entry_001', 'norm_001', 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT', 'scope_001',
         'FIRST_PARTY_COLLECTOR', 'qf_v1', '{}'::jsonb, true
       ) ON CONFLICT (entry_id) DO NOTHING`,
    );

    await engine.query(
      `INSERT INTO disc.cheap_monitor_rows (
         monitor_id, candidate_id, state, max_checks, next_check_at, expires_at,
         backoff_ms, max_staleness_ms, resource_budget_class, provider_id, operation_id,
         retained_at, created_at, updated_at
       ) VALUES (
         'test_mon_001', 'cand_001', 'NEW', 10, '2026-08-20T10:00:00Z', '2026-08-20T11:00:00Z',
         1000, 5000, 'FREE', 'p1', 'op1', '2026-08-20T10:00:00Z', now(), now()
       ) ON CONFLICT (monitor_id) DO NOTHING`,
    );

    await engine.query(
      `INSERT INTO disc.cheap_monitor_population_riders (
         monitor_id, population_manifest_id, entry_provenance_id
       ) VALUES (
         'test_mon_001', 'test_man_001', 'test_entry_001'
       ) ON CONFLICT (monitor_id) DO NOTHING`,
    );

    // Mutation must be refused by trigger
    await expect(
      engine.query(
        `UPDATE disc.cheap_monitor_population_riders SET population_manifest_id = 'other' WHERE monitor_id = 'test_mon_001'`,
      ),
    ).rejects.toThrow(/is refused/i);

    await expect(
      engine.query(
        `DELETE FROM disc.cheap_monitor_population_riders WHERE monitor_id = 'test_mon_001'`,
      ),
    ).rejects.toThrow(/is refused/i);
  });
});
