/**
 * SQL-truth structural rules for discovery-universe migrations (g0_disc_* and g1_disc_*).
 * Traces: FR-DISC-006, FR-DISC-008, FR-DISC-009, FR-DISC-010, FR-DISC-011, FR-DISC-013, FR-DISC-014.
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

describe('disc migration family SQL truth (discovery-universe)', () => {
  it('discovers known discovery migration scripts in exact lexicographic order with sha256 checksums', async () => {
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

  it('creates the exact column structure for disc_source_profiles (FR-DISC-011)', async () => {
    const cols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'disc_source_profiles'
       ORDER BY ordinal_position`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'source_id',
      'profile_version',
      'source_class',
      'coverage_scope',
      'rights_basis',
      'query_filter_version',
      'upstream_dependence',
      'upstream_lineage_keys',
      'manipulation_policy',
      'collector_scope_ids',
      'effective_from',
      'superseded_at',
      'created_at',
    ]);
  });

  it('creates the exact column structure for universe_entry_provenance (FR-DISC-011)', async () => {
    const cols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'universe_entry_provenance'
       ORDER BY ordinal_position`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'entry_id',
      'normalized_identity_id',
      'entry_reason',
      'coverage_scope_ref',
      'rights_record',
      'query_filter_version',
      'upstream_dependence_disclosed',
      'first_party_observed',
      'recorded_at',
    ]);
  });

  it('creates the exact column structure for population_constraints (FR-DISC-013)', async () => {
    const cols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'population_constraints'
       ORDER BY ordinal_position`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'constraint_id',
      'manifest_id',
      'kind',
      'effect',
      'source_id',
      'collector_scope_id',
      'program_version',
      'window_start',
      'window_end',
      'window_start_slot',
      'window_end_slot',
      'evidence_refs',
      'recorded_at',
      'resolved_at',
    ]);
  });

  it('creates the exact column structure for chain_access_declarations & consumption & incidents (FR-DISC-008)', async () => {
    const declCols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'chain_access_declarations'
       ORDER BY ordinal_position`,
    );
    expect(declCols.rows.map((r) => r.column_name)).toEqual([
      'declaration_id',
      'version',
      'purpose',
      'chain_id',
      'program_ids',
      'max_candidates',
      'max_slots_per_run',
      'max_calls_per_day',
      'max_window_seconds',
      'cost_class',
      'paid_fallback_allowed',
      'protected_reserve_compatible',
      'tolerance_percent',
      'created_at',
    ]);

    const consCols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'chain_access_consumption'
       ORDER BY ordinal_position`,
    );
    expect(consCols.rows.map((r) => r.column_name)).toEqual([
      'consumption_id',
      'declaration_id',
      'declaration_version',
      'run_id',
      'consumed_at',
      'slots_scanned',
      'calls_made',
      'candidates_touched',
      'incident_id',
    ]);

    const incCols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'chain_access_incidents'
       ORDER BY ordinal_position`,
    );
    expect(incCols.rows.map((r) => r.column_name)).toEqual([
      'incident_id',
      'consumption_id',
      'declaration_id',
      'declaration_version',
      'reason',
      'effective_max_slots_per_run',
      'effective_max_calls_per_day',
      'effective_max_candidates',
      'paid_overage_consumed',
      'protected_reserve_consumed',
      'recorded_at',
    ]);
  });

  it('creates the exact column structure for recall_estimates (FR-DISC-006, FR-DISC-010)', async () => {
    const cols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'disc' AND table_name = 'recall_estimates'
       ORDER BY ordinal_position`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'estimate_id',
      'manifest_id',
      'evaluated_source_id',
      'claim_basis',
      'verdict',
      'recall_estimate',
      'inclusion_probability_source',
      'independence_evidence',
      'constraint_ids',
      'as_of',
      'recorded_at',
    ]);
  });

  it('enforces append-only triggers on discovery tables (refuses UPDATE and DELETE)', async () => {
    // Seed prerequisite manifest and profile
    await engine.query(
      `INSERT INTO disc.coverage_population_manifests (
         manifest_id, population, source_scope, collector_scope,
         window_start, window_end, gaps, rights_exclusions, program_versions,
         selection_probabilities, known_missing_sources, source_dependence_assessment
       ) VALUES (
         'man_m1', 'SUPPORTED_PROGRAM_UNIVERSE', '{"sourceIds":["src1"]}'::jsonb, '{"scopeIds":["col1"]}'::jsonb,
         '2026-08-20T10:00:00Z', '2026-08-20T11:00:00Z', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
         '{}'::jsonb, '[]'::jsonb, '{}'::jsonb
       ) ON CONFLICT (manifest_id) DO NOTHING`,
    );

    await engine.query(
      `INSERT INTO disc.disc_source_profiles (
         source_id, profile_version, source_class, coverage_scope, rights_basis,
         query_filter_version, upstream_dependence, upstream_lineage_keys, manipulation_policy,
         collector_scope_ids, effective_from
       ) VALUES (
         'src_prof_1', 1, 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT', '{}'::jsonb, 'FIRST_PARTY_COLLECTOR',
         'qf1', '{}'::jsonb, ARRAY[]::text[], 'LABEL_AND_RETAIN', ARRAY[]::text[], '2026-08-20T10:00:00Z'
       ) ON CONFLICT (source_id, profile_version) DO NOTHING`,
    );

    await expect(
      engine.query(
        `UPDATE disc.disc_source_profiles SET query_filter_version = 'qf2' WHERE source_id = 'src_prof_1'`,
      ),
    ).rejects.toThrow(/is refused/i);

    await expect(
      engine.query(`DELETE FROM disc.disc_source_profiles WHERE source_id = 'src_prof_1'`),
    ).rejects.toThrow(/is refused/i);
  });
});
