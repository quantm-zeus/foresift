/**
 * Population constraints kind × effect matrix, publication gates, and window exclusion (FR-DISC-009, FR-DISC-013).
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
import {
  resolvePopulationConstraints,
  persistPopulationConstraint,
  gatePopulationReport,
  excludeConstrainedWindows,
  PopulationConstraintResolver,
  type PopulationConstraint,
} from '../src/constraints.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let resolver: PopulationConstraintResolver;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  resolver = new PopulationConstraintResolver(engine);
});

afterAll(async () => {
  await db.close();
});

describe('Population Constraints Kind × Effect Matrix (FR-DISC-013)', () => {
  beforeAll(async () => {
    // Seed manifest
    await engine.query(
      `INSERT INTO disc.coverage_population_manifests (
         manifest_id, population, source_scope, collector_scope,
         window_start, window_end, gaps, rights_exclusions, program_versions,
         selection_probabilities, known_missing_sources, source_dependence_assessment
       ) VALUES (
         'man_const_001', 'SUPPORTED_PROGRAM_UNIVERSE',
         '{"sourceIds":["src_prov_1"],"unresolvedIdentityIds":["ident_unres_1"]}'::jsonb,
         '{"scopeIds":["col_shard_1"],"startSlot":"100","endSlot":"500","unverifiedProgramVersions":["prog_unver@0.9.0"]}'::jsonb,
         '2026-08-20T10:00:00Z', '2026-08-20T12:00:00Z',
         '[]'::jsonb,
         '["src_rights_excl_1"]'::jsonb,
         '[{"programId":"prog_man","version":"0.1.0","verified":false}]'::jsonb,
         '{}'::jsonb,
         '["src_missing_1"]'::jsonb,
         '{}'::jsonb
       ) ON CONFLICT (manifest_id) DO NOTHING`,
    );

    // Seed collector gaps (gap_id, shard_id, gap_start_slot, gap_end_slot, reason, recovery_status)
    await engine.query(
      `INSERT INTO collector_gaps (
         gap_id, shard_id, gap_start_slot, gap_end_slot, reason, recovery_status, registered_at
       ) VALUES (
         'gap_001', 'col_shard_1', 150, 160, 'NETWORK_DISCONNECT', 'UNRECOVERED', now()
       ) ON CONFLICT (gap_id) DO NOTHING`,
    );

    // Seed collector incident and decode pause
    await engine.query(
      `INSERT INTO col.collector_incidents (
         incident_id, kind, decoder_version, program_id, program_version,
         opened_at, status, evidence_refs, audit_chain_ref
       ) VALUES (
         'inc_001', 'PROGRAM_UPGRADE', 'dec_v1', 'prog_paused', '1.0.0',
         '2026-08-20T10:00:00Z', 'OPEN', '["ev1"]'::jsonb, 'audit_ref_1'
       ) ON CONFLICT (incident_id) DO NOTHING`,
    );

    await engine.query(
      `INSERT INTO col.collector_decode_pauses (
         pause_id, decoder_version, program_id, program_version,
         reason, opening_incident_id, paused_at, revalidation_state, derived_facts_state
       ) VALUES (
         'pause_001', 'dec_v1', 'prog_paused', '1.0.0',
         'PROGRAM_UPGRADE', 'inc_001', '2026-08-20T10:30:00Z', 'PAUSED', 'BLOCKED'
       ) ON CONFLICT (pause_id) DO NOTHING`,
    );

    // Seed provider and unhealthy operation
    await engine.query(
      `INSERT INTO prov.prov_providers (provider_id, display_name, provider_group)
       VALUES ('src_prov_1', 'Provider 1', 'PUBLIC') ON CONFLICT (provider_id) DO NOTHING`,
    );

    await engine.query(
      `INSERT INTO prov.prov_operations (
         provider_id, operation_id, version, capability_class, cost_class, supported_chains,
         input_schema_id, raw_output_schema_id, normalized_output_schema_id,
         quota_model_id, cache_policy_id, timeout_ms, retry_policy_id,
         declared_independence_group, license_policy_id, estimated_quota_units,
         quota_reset_policy_id, verification_expires_at, current_state, health_status
       ) VALUES (
         'src_prov_1', 'op_stream', '1.0.0', 'STREAM_PROGRAM_EVENT', 'FREE_UNMETERED', ARRAY['solana'],
         'schema_in_1', 'schema_raw_1', 'schema_norm_1',
         'quota_1', 'cache_1', 1000, 'retry_1',
         'group_1', 'license_1', 1,
         'reset_1', '2026-12-31T00:00:00Z', 'ACTIVE', 'DEGRADED'
       ) ON CONFLICT (provider_id, operation_id, version) DO NOTHING`,
    );
  });

  it('resolves the full constraint matrix and assigns precise effect semantics', async () => {
    const constraints = await resolver.resolve('man_const_001', { blockGapAboveSlots: 50 });

    const kinds = constraints.map((c) => c.kind);
    expect(kinds).toContain('COLLECTOR_GAP');
    expect(kinds).toContain('DECODER_OUTAGE');
    expect(kinds).toContain('UNVERIFIED_PROGRAM_VERSION');
    expect(kinds).toContain('PROVIDER_UNAVAILABLE');
    expect(kinds).toContain('RIGHTS_EXCLUSION');
    expect(kinds).toContain('IDENTITY_UNRESOLVED');

    // Gap <= 50 slots -> EXCLUDE_WINDOW
    const gap = constraints.find((c) => c.kind === 'COLLECTOR_GAP');
    expect(gap?.effect).toBe('EXCLUDE_WINDOW');

    // Decoder pause -> EXCLUDE_WINDOW
    const pause = constraints.find((c) => c.kind === 'DECODER_OUTAGE');
    expect(pause?.effect).toBe('EXCLUDE_WINDOW');

    // Unverified program versions -> BLOCK_CLAIM
    const unverified = constraints.filter((c) => c.kind === 'UNVERIFIED_PROGRAM_VERSION');
    expect(unverified.length).toBeGreaterThanOrEqual(1);
    expect(unverified.every((c) => c.effect === 'BLOCK_CLAIM')).toBe(true);

    // Provider unavailable, rights exclusion, unresolved identity -> NARROW_CLAIM
    const narrows = constraints.filter((c) =>
      ['PROVIDER_UNAVAILABLE', 'RIGHTS_EXCLUSION', 'IDENTITY_UNRESOLVED'].includes(c.kind),
    );
    expect(narrows.every((c) => c.effect === 'NARROW_CLAIM')).toBe(true);
  });

  it('blocks claims when gap width exceeds the configured tolerance policy', async () => {
    // Gap width is 11 slots (150 to 160). blockGapAboveSlots = 5 -> BLOCK_CLAIM!
    const constraints = await resolvePopulationConstraints(engine, 'man_const_001', {
      blockGapAboveSlots: 5,
    });
    const gap = constraints.find((c) => c.kind === 'COLLECTOR_GAP');
    expect(gap?.effect).toBe('BLOCK_CLAIM');
  });
});

describe('Publication Gate & Constrained Window Filtering (FR-DISC-013)', () => {
  const narrowConstraint: PopulationConstraint = {
    constraintId: 'c_narrow',
    manifestId: 'man_1',
    kind: 'RIGHTS_EXCLUSION',
    effect: 'NARROW_CLAIM',
    sourceId: 'src_excl',
    evidenceRefs: ['ev_rights'],
  };

  const excludeWindowConstraint: PopulationConstraint = {
    constraintId: 'c_window',
    manifestId: 'man_1',
    kind: 'DECODER_OUTAGE',
    effect: 'EXCLUDE_WINDOW',
    windowStart: '2026-08-20T10:30:00Z',
    windowEnd: '2026-08-20T11:00:00Z',
    evidenceRefs: ['ev_pause'],
  };

  const blockingConstraint: PopulationConstraint = {
    constraintId: 'c_block',
    manifestId: 'man_1',
    kind: 'UNVERIFIED_PROGRAM_VERSION',
    effect: 'BLOCK_CLAIM',
    programVersion: 'prog@0.1.0',
    evidenceRefs: ['ev_unver'],
  };

  it('allows publication when no BLOCK_CLAIM constraints are active', () => {
    const gate = gatePopulationReport([narrowConstraint, excludeWindowConstraint]);
    expect(gate.publicationAllowed).toBe(true);
    expect(gate.blockingConstraintIds).toEqual([]);
    expect(gate.disclosures).toHaveLength(2);
  });

  it('blocks publication when a BLOCK_CLAIM constraint is present and active', () => {
    const gate = gatePopulationReport([narrowConstraint, blockingConstraint]);
    expect(gate.publicationAllowed).toBe(false);
    expect(gate.blockingConstraintIds).toEqual(['c_block']);
  });

  it('unblocks publication if the blocking constraint was resolved before asOf', () => {
    const resolvedBlock: PopulationConstraint = {
      ...blockingConstraint,
      resolvedAt: '2026-08-20T11:00:00Z',
    };
    const gate = gatePopulationReport([resolvedBlock], '2026-08-20T12:00:00Z');
    expect(gate.publicationAllowed).toBe(true);
    expect(gate.blockingConstraintIds).toEqual([]);
  });

  it('excludes observations inside constrained windows rather than counting as misses', () => {
    const observations = [
      { id: 'obs_1', time: '2026-08-20T10:00:00Z' }, // Before window -> Kept
      { id: 'obs_2', time: '2026-08-20T10:45:00Z' }, // Inside window -> Excluded!
      { id: 'obs_3', time: '2026-08-20T11:15:00Z' }, // After window -> Kept
    ];

    const filtered = excludeConstrainedWindows(observations, (obs) => obs.time, [
      excludeWindowConstraint,
    ]);

    expect(filtered.map((o) => o.id)).toEqual(['obs_1', 'obs_3']);
  });

  it('persists constraint record cleanly to database', async () => {
    await persistPopulationConstraint(engine, {
      ...narrowConstraint,
      constraintId: 'c_persisted_narrow_1',
      manifestId: 'man_const_001',
    });

    const rows = await engine.query<{ constraint_id: string }>(
      'SELECT constraint_id FROM disc.population_constraints WHERE constraint_id = $1',
      ['c_persisted_narrow_1'],
    );
    expect(rows.rows[0]?.constraint_id).toBe('c_persisted_narrow_1');
  });
});
