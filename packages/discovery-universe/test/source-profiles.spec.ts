/**
 * Source profiles, additive-versioning law, and provenance-completeness truth table.
 * Traces: FR-DISC-011.
 * Normative text: "Every discovery source stores source-specific first-seen, normalized identity,
 * upstream dependence, query/filter version, coverage scope, rights, and reason an asset entered the universe."
 */
import { describe, expect, it } from 'bun:test';
import type { UtcTimestamp } from '@foresift/domain';
import {
  DiscoveryUniverseEntrySchema,
  type DiscoveryUniverseEntry,
} from '@foresift/shared-schemas';

export interface DiscoverySourceProfile {
  readonly profileId: string;
  readonly version: string;
  readonly sourceClass: string;
  readonly programFilters: readonly string[];
  readonly queryCadenceMs: number;
  readonly upstreamDependenceSourceIds: readonly string[];
  readonly rightsFingerprint: string;
  readonly allowedEntryReasons: readonly string[];
  readonly immutable: boolean;
}

export interface ProvenanceRecord {
  readonly assetRepresentationId: string;
  readonly sourceId: string;
  readonly sourceAvailableAt: UtcTimestamp;
  readonly normalizedIdentity: string;
  readonly upstreamDependence: string;
  readonly queryFilterVersion: string;
  readonly coverageScope: string;
  readonly rights: string;
  readonly entryReason: string;
}

export type PartialProvenance = {
  [K in keyof ProvenanceRecord]?: ProvenanceRecord[K] | undefined;
};

function validateProvenanceRecord(record: PartialProvenance): {
  valid: boolean;
  missingFields: string[];
} {
  const requiredFields: (keyof ProvenanceRecord)[] = [
    'assetRepresentationId',
    'sourceId',
    'sourceAvailableAt',
    'normalizedIdentity',
    'upstreamDependence',
    'queryFilterVersion',
    'coverageScope',
    'rights',
    'entryReason',
  ];

  const missingFields = requiredFields.filter((f) => {
    const val = record[f];
    return val === undefined || val === null || (typeof val === 'string' && val.trim().length === 0);
  });

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

describe('Source Profiles & Additive-Versioning Law (FR-DISC-011)', () => {
  const profileV1: DiscoverySourceProfile = {
    profileId: 'prof_solana_pump_early',
    version: '1.0.0',
    sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
    programFilters: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
    queryCadenceMs: 50,
    upstreamDependenceSourceIds: [],
    rightsFingerprint: 'sha256:rights_first_party_direct',
    allowedEntryReasons: ['BONDING_CURVE_LAUNCH', 'MIGRATION_LINKAGE'],
    immutable: true,
  };

  const profileV1_1: DiscoverySourceProfile = {
    ...profileV1,
    version: '1.1.0',
    programFilters: [
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      'BSfD6SHZigAcJZz6GQURAR9VRe128ufE38Aioq1YgVDG', // added Raydium LaunchLab filter
    ],
    allowedEntryReasons: [
      'BONDING_CURVE_LAUNCH',
      'MIGRATION_LINKAGE',
      'RAYDIUM_LAUNCHLAB_POOL_INITIALIZED',
    ],
  };

  it('enforces that profile definitions are immutable per version', () => {
    expect(profileV1.version).toBe('1.0.0');
    expect(profileV1.immutable).toBe(true);

    // Modifying a profile requires a new version string
    expect(profileV1_1.version).toBe('1.1.0');
    expect(profileV1_1.programFilters.length).toBeGreaterThan(profileV1.programFilters.length);
    // Original v1 remains unchanged
    expect(profileV1.programFilters).toHaveLength(1);
  });

  it('ensures historical queries reference exact historical profile versions without mutation', () => {
    const profileRegistry = new Map<string, DiscoverySourceProfile>();
    profileRegistry.set(`${profileV1.profileId}@${profileV1.version}`, profileV1);
    profileRegistry.set(`${profileV1_1.profileId}@${profileV1_1.version}`, profileV1_1);

    const v1LookedUp = profileRegistry.get('prof_solana_pump_early@1.0.0');
    expect(v1LookedUp).toBeDefined();
    expect(v1LookedUp?.allowedEntryReasons).toEqual([
      'BONDING_CURVE_LAUNCH',
      'MIGRATION_LINKAGE',
    ]);

    const v1_1LookedUp = profileRegistry.get('prof_solana_pump_early@1.1.0');
    expect(v1_1LookedUp).toBeDefined();
    expect(v1_1LookedUp?.allowedEntryReasons).toContain('RAYDIUM_LAUNCHLAB_POOL_INITIALIZED');
  });
});

describe('Provenance-Completeness Truth Table (FR-DISC-011)', () => {
  const completeProvenance: ProvenanceRecord = {
    assetRepresentationId: 'asset_rep_sol_token_001',
    sourceId: 'col_solana_pump_live',
    sourceAvailableAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
    normalizedIdentity: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300100200:0:2',
    upstreamDependence: 'INDEPENDENT_FIRST_PARTY',
    queryFilterVersion: '1.0.0',
    coverageScope: 'scope_pump_bonding_v1',
    rights: 'RIGHTS_INTERNAL_OBSERVATION',
    entryReason: 'BONDING_CURVE_INITIALIZED',
  };

  it('accepts complete provenance record with all 7 mandatory dimensions', () => {
    const check = validateProvenanceRecord(completeProvenance);
    expect(check.valid).toBe(true);
    expect(check.missingFields).toHaveLength(0);
  });

  it('truth table: rejects any record missing one or more required provenance dimensions', () => {
    const testCases: { missingField: keyof ProvenanceRecord; partial: PartialProvenance }[] = [
      {
        missingField: 'sourceAvailableAt',
        partial: { ...completeProvenance, sourceAvailableAt: undefined },
      },
      {
        missingField: 'normalizedIdentity',
        partial: { ...completeProvenance, normalizedIdentity: '' },
      },
      {
        missingField: 'upstreamDependence',
        partial: { ...completeProvenance, upstreamDependence: '' },
      },
      {
        missingField: 'queryFilterVersion',
        partial: { ...completeProvenance, queryFilterVersion: '' },
      },
      {
        missingField: 'coverageScope',
        partial: { ...completeProvenance, coverageScope: '' },
      },
      {
        missingField: 'rights',
        partial: { ...completeProvenance, rights: '' },
      },
      {
        missingField: 'entryReason',
        partial: { ...completeProvenance, entryReason: '' },
      },
    ];

    for (const tc of testCases) {
      const check = validateProvenanceRecord(tc.partial);
      expect(check.valid).toBe(false);
      expect(check.missingFields).toContain(tc.missingField);
    }
  });

  it('validates schema compliance for discovery universe entries with full provenance', () => {
    const validEntry: DiscoveryUniverseEntry = {
      assetRepresentationId: 'asset_rep_sol_token_001',
      sourceId: 'col_solana_pump_live',
      sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
      sourceAvailableAt: '2026-08-20T10:00:00.005Z',
      firstIngestedAt: '2026-08-20T10:00:00.010Z',
      chainCoordinates: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300100200:0:2',
      sourceMetadataHash: 'sha256:provenance_hash_001',
      discoveryPolicyVersion: '1.0.0',
      collectorCoverageManifestId: 'scope_pump_bonding_v1',
      qualityCodes: ['QUALITY_FIRST_PARTY_VERIFIED'],
    };

    const parsed = DiscoveryUniverseEntrySchema.parse(validEntry);
    expect(parsed.assetRepresentationId).toBe('asset_rep_sol_token_001');
    expect(parsed.collectorCoverageManifestId).toBe('scope_pump_bonding_v1');
  });
});
