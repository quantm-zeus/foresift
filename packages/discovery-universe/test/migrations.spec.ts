/**
 * SQL-truth structural rules for discovery-universe migrations (g0_disc_*, g1_disc_*).
 * Traces: FR-DISC-002, FR-DISC-003, FR-DISC-009, FR-DISC-011, FR-DISC-013.
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
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('discovery-universe SQL migrations (g0_disc_* and g1_disc_*)', () => {
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
    const second = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(second.applied.length).toBe(0);
  }, 60_000);

  it('enforces discovery_universe_entries timing order and metadata hash constraints (FR-DISC-011)', async () => {
    // Valid universe entry
    await engine.query(
      `INSERT INTO disc.discovery_universe_entries
         (entry_id, asset_representation_id, source_id, source_class, sighting_id,
          source_observed_at, source_available_at, first_ingested_at,
          source_metadata_hash, discovery_policy_version, quality_codes)
       VALUES ('entry_test_1', 'asset_rep_1', 'col_solana_pump',
               'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT', 'sight_1',
               '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.005Z', '2026-08-20T10:00:00.010Z',
               'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
               '1.0.0', ARRAY['QUALITY_FIRST_PARTY_VERIFIED'])
       ON CONFLICT (entry_id) DO NOTHING`,
    );

    // Negative: first_ingested_at < source_available_at fails CHECK constraint
    await expect(
      engine.query(
        `INSERT INTO disc.discovery_universe_entries
           (entry_id, asset_representation_id, source_id, source_class, sighting_id,
            source_observed_at, source_available_at, first_ingested_at,
            source_metadata_hash, discovery_policy_version, quality_codes)
         VALUES ('entry_test_bad_time', 'asset_rep_2', 'col_solana_pump',
                 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT', 'sight_2',
                 '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.010Z', '2026-08-20T10:00:00.005Z',
                 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                 '1.0.0', ARRAY[]::text[])`,
      ),
    ).rejects.toThrow();

    // Negative: invalid source_metadata_hash (missing sha256 prefix) fails regex CHECK
    await expect(
      engine.query(
        `INSERT INTO disc.discovery_universe_entries
           (entry_id, asset_representation_id, source_id, source_class, sighting_id,
            source_observed_at, source_available_at, first_ingested_at,
            source_metadata_hash, discovery_policy_version, quality_codes)
         VALUES ('entry_test_bad_hash', 'asset_rep_3', 'col_solana_pump',
                 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT', 'sight_3',
                 '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.005Z', '2026-08-20T10:00:00.010Z',
                 'invalid_hash_not_sha256',
                 '1.0.0', ARRAY[]::text[])`,
      ),
    ).rejects.toThrow();
  });

  it('enforces discovery_attribution immutability triggers (FR-DISC-011)', async () => {
    await engine.query(
      `INSERT INTO disc.discovery_attribution
         (attribution_id, universe_entry_id, source_id, source_class, sighting_id,
          source_observed_at, source_available_at, first_ingested_at,
          source_metadata_hash, quality_codes)
       VALUES ('attr_test_1', 'entry_test_1', 'src_gmgn_free',
               'FREE_AGGREGATE_DISCOVERY', 'sight_gmgn_1',
               '2026-08-20T10:00:01.000Z', '2026-08-20T10:00:02.000Z', '2026-08-20T10:00:02.100Z',
               'sha256:1111111111111111111111111111111111111111111111111111111111111111',
               ARRAY['QUALITY_AGGREGATE_OBSERVED'])
       ON CONFLICT (attribution_id) DO NOTHING`,
    );

    // Refuses UPDATE
    await expect(
      engine.query(
        `UPDATE disc.discovery_attribution SET source_id = 'tampered' WHERE attribution_id = 'attr_test_1'`,
      ),
    ).rejects.toThrow(/DISCOVERY_HISTORY_IMMUTABLE/);

    // Refuses DELETE
    await expect(
      engine.query(
        `DELETE FROM disc.discovery_attribution WHERE attribution_id = 'attr_test_1'`,
      ),
    ).rejects.toThrow(/DISCOVERY_HISTORY_IMMUTABLE/);
  });

  it('enforces named population enum and window constraints on coverage_population_manifests (FR-DISC-009, FR-DISC-013)', async () => {
    const validScope = JSON.stringify({ sources: ['col_solana_pump'] });
    const emptyArray = JSON.stringify([]);
    const emptyObject = JSON.stringify({});

    // Valid named population manifest
    await engine.query(
      `INSERT INTO disc.coverage_population_manifests
         (manifest_id, population, source_scope, collector_scope, window_start, window_end,
          gaps, rights_exclusions, program_versions, selection_probabilities,
          known_missing_sources, source_dependence_assessment)
       VALUES ('pop_manifest_test_1', 'SUPPORTED_PROGRAM_UNIVERSE', $1, $1,
               '2026-08-20T00:00:00.000Z', '2026-08-20T23:59:59.000Z',
               $2, $2, $2, $3, $2, $3)
       ON CONFLICT (manifest_id) DO NOTHING`,
      [validScope, emptyArray, emptyObject],
    );

    // Negative: Unnamed / forbidden population (e.g. ALL_SOLANA_MARKET) fails CHECK constraint
    await expect(
      engine.query(
        `INSERT INTO disc.coverage_population_manifests
           (manifest_id, population, source_scope, collector_scope, window_start, window_end,
            gaps, rights_exclusions, program_versions, selection_probabilities,
            known_missing_sources, source_dependence_assessment)
         VALUES ('pop_manifest_bad', 'ALL_SOLANA_MARKET', $1, $1,
                 '2026-08-20T00:00:00.000Z', '2026-08-20T23:59:59.000Z',
                 $2, $2, $2, $3, $2, $3)`,
        [validScope, emptyArray, emptyObject],
      ),
    ).rejects.toThrow();

    // Negative: window_end <= window_start fails window order CHECK
    await expect(
      engine.query(
        `INSERT INTO disc.coverage_population_manifests
           (manifest_id, population, source_scope, collector_scope, window_start, window_end,
            gaps, rights_exclusions, program_versions, selection_probabilities,
            known_missing_sources, source_dependence_assessment)
         VALUES ('pop_manifest_bad_window', 'SUPPORTED_PROGRAM_UNIVERSE', $1, $1,
                 '2026-08-20T23:59:59.000Z', '2026-08-20T00:00:00.000Z',
                 $2, $2, $2, $3, $2, $3)`,
        [validScope, emptyArray, emptyObject],
      ),
    ).rejects.toThrow();
  });
});
