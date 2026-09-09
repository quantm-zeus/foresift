/**
 * Source profiles, additive-versioning laws, and provenance-completeness truth tables (FR-DISC-009, FR-DISC-011).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { DiscError, ErrorCode } from '@foresift/domain';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  registerSourceProfile,
  sourceProfileAt,
  persistEntryProvenance,
  provenanceSupportsClaim,
  entrySupportsClaim,
  SourceProfileRegistry,
  type DiscSourceProfile,
  type UniverseEntryProvenance,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let registry: SourceProfileRegistry;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  registry = new SourceProfileRegistry(engine);
});

afterAll(async () => {
  await db.close();
});

describe('Source Profiles & Additive Versioning (FR-DISC-011)', () => {
  const profileV1: DiscSourceProfile = {
    sourceId: 'src_pump_fun_v1',
    profileVersion: 1,
    sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
    coverageScope: { programs: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'] },
    rightsBasis: 'FIRST_PARTY_COLLECTOR',
    queryFilterVersion: 'qf_v1',
    upstreamDependence: {},
    upstreamLineageKeys: [],
    manipulationPolicy: 'LABEL_AND_RETAIN',
    collectorScopeIds: ['col_solana_live'],
    effectiveFrom: '2026-08-01T00:00:00Z',
  };

  const profileV2: DiscSourceProfile = {
    sourceId: 'src_pump_fun_v1',
    profileVersion: 2,
    sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
    coverageScope: { programs: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'] },
    rightsBasis: 'FIRST_PARTY_COLLECTOR',
    queryFilterVersion: 'qf_v2',
    upstreamDependence: {},
    upstreamLineageKeys: [],
    manipulationPolicy: 'LABEL_AND_DOWNWEIGHT',
    collectorScopeIds: ['col_solana_live', 'col_solana_archive'],
    effectiveFrom: '2026-08-15T00:00:00Z',
  };

  it('registers an initial immutable profile version', async () => {
    const result = await registry.register(profileV1);
    expect(result.created).toBe(true);
    expect(result.profile.sourceId).toBe('src_pump_fun_v1');
    expect(result.profile.profileVersion).toBe(1);
    expect(result.profile.queryFilterVersion).toBe('qf_v1');
  });

  it('identical registration is idempotent (no-op)', async () => {
    const retry = await registerSourceProfile(engine, profileV1);
    expect(retry.created).toBe(false);
    expect(retry.profile.sourceId).toBe('src_pump_fun_v1');
    expect(retry.profile.profileVersion).toBe(1);
  });

  it('refuses registration with modified content at an existing key', async () => {
    const conflicting = { ...profileV1, queryFilterVersion: 'qf_tampered' };
    await expect(registry.register(conflicting)).rejects.toThrow(
      /a source profile key already exists with different content/i,
    );
  });

  it('refuses non-monotonic versions or backward effective timestamps', async () => {
    const nonMonotonicVersion = {
      ...profileV1,
      profileVersion: 1,
      effectiveFrom: '2026-08-20T00:00:00.000Z',
    };
    await expect(registry.register(nonMonotonicVersion)).rejects.toThrow(DiscError);

    const backwardTime = {
      ...profileV2,
      profileVersion: 3,
      effectiveFrom: '2026-07-01T00:00:00.000Z',
    };
    await expect(registry.register(backwardTime)).rejects.toThrow(
      /source profile versions and effective times must advance monotonically/i,
    );
  });

  it('registers a succeeding forward version cleanly', async () => {
    const result = await registry.register(profileV2);
    expect(result.created).toBe(true);
    expect(result.profile.profileVersion).toBe(2);
    expect(result.profile.queryFilterVersion).toBe('qf_v2');
  });

  it('resolves effective profile by point-in-time window', async () => {
    // Before v1 effectiveFrom
    const beforeV1 = await registry.profileAt('src_pump_fun_v1', '2026-07-31T23:59:59.000Z');
    expect(beforeV1).toBeUndefined();

    // In v1 window
    const inV1 = await sourceProfileAt(engine, 'src_pump_fun_v1', '2026-08-10T12:00:00.000Z');
    expect(inV1).toBeDefined();
    expect(inV1?.profileVersion).toBe(1);
    expect(inV1?.queryFilterVersion).toBe('qf_v1');

    // In v2 window (newer effectiveFrom)
    const inV2 = await registry.effectiveProfile('src_pump_fun_v1', '2026-08-16T00:00:00.000Z');
    expect(inV2).toBeDefined();
    expect(inV2?.profileVersion).toBe(2);
    expect(inV2?.queryFilterVersion).toBe('qf_v2');
  });

  it('refuses lookup with invalid arguments', async () => {
    await expect(registry.profileAt('', '2026-08-10T00:00:00.000Z')).rejects.toThrow(DiscError);
    await expect(registry.profileAt('src_pump_fun_v1', 'invalid-date')).rejects.toThrow(DiscError);
  });
});

describe('Provenance-Completeness Truth Table (FR-DISC-011)', () => {
  beforeAll(async () => {
    // Seed universe entry foreign key target
    await engine.query(
      `INSERT INTO disc.discovery_universe_entries (
         entry_id, asset_representation_id, source_id, source_class, sighting_id, source_available_at,
         first_ingested_at, source_metadata_hash, discovery_policy_version, quality_codes
       ) VALUES (
         'entry_prov_001', 'asset_rep_001', 'src_pump_fun_v1', 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
         'sight_001', '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:01.000Z',
         'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '1.0.0', ARRAY[]::text[]
       ) ON CONFLICT (entry_id) DO NOTHING`,
    );
  });

  const validProvenance: UniverseEntryProvenance = {
    entryId: 'entry_prov_001',
    normalizedIdentityId: 'solana:token:pump_asset_001',
    entryReason: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
    coverageScopeRef: 'scope_solana_pump_fun_v1',
    rightsRecord: 'FIRST_PARTY_COLLECTOR',
    queryFilterVersion: 'qf_v1',
    upstreamDependenceDisclosed: {},
    firstPartyObserved: true,
  };

  it('persists complete per-entry provenance', async () => {
    const result = await registry.persistEntryProvenance(validProvenance);
    expect(result.created).toBe(true);
    expect(result.provenance.entryId).toBe('entry_prov_001');
    expect(result.provenance.normalizedIdentityId).toBe('solana:token:pump_asset_001');
  });

  it('re-persisting existing provenance is idempotent', async () => {
    const retry = await persistEntryProvenance(engine, validProvenance);
    expect(retry.created).toBe(false);
    expect(retry.provenance.entryId).toBe('entry_prov_001');
  });

  it('provenanceSupportsClaim truth table', () => {
    expect(provenanceSupportsClaim(validProvenance)).toBe(true);

    // Incomplete variants
    expect(provenanceSupportsClaim({ ...validProvenance, entryId: '' })).toBe(false);
    expect(provenanceSupportsClaim({ ...validProvenance, normalizedIdentityId: '' })).toBe(false);
    expect(provenanceSupportsClaim({ ...validProvenance, entryReason: 'UNKNOWN_REASON' })).toBe(
      false,
    );
    expect(provenanceSupportsClaim({ ...validProvenance, rightsRecord: 'INVALID_RIGHTS' })).toBe(
      false,
    );
    expect(provenanceSupportsClaim({ ...validProvenance, queryFilterVersion: '' })).toBe(false);
    expect(
      provenanceSupportsClaim({
        ...validProvenance,
        upstreamDependenceDisclosed: 'not-an-object',
      }),
    ).toBe(false);
    expect(provenanceSupportsClaim(null)).toBe(false);
    expect(provenanceSupportsClaim(undefined)).toBe(false);
  });

  it('entrySupportsClaim confirms persisted state against database', async () => {
    expect(await registry.entrySupportsClaim('entry_prov_001')).toBe(true);
    expect(await entrySupportsClaim(engine, 'nonexistent_entry')).toBe(false);
  });
});
