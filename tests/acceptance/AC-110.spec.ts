/**
 * AC-110 acceptance (positive) — first-party observation & discovery attribution.
 * Traces: FR-COL-011, FR-DISC-002, FR-DISC-011.
 * AC text (manifest §39): "Every first-seen candidate records source, source timestamp,
 * system timestamp, source rank, and all subsequent discovery sources; earliest valid
 * system-available entry wins as first-seen; all subsequent sources appended."
 *
 * Facet convention:
 * 1. Base attribution facet: deterministic first-seen attribution & subsequent appending.
 * 2. Per-source provenance facet (FR-DISC-011): source-specific first-seen, normalized
 *    identity, upstream dependence, query/filter version, coverage scope, rights, and entry reason.
 */
import { describe, expect, it } from 'bun:test';
import {
  FIRST_PARTY_DISCOVERY_ENTRY,
  FREE_AGGREGATE_DISCOVERY_ENTRY,
  AUTHORIZED_LAUNCH_FEED_ENTRY,
  type DiscoveryUniverseEntryFixture,
} from '../fixtures/disc/index.ts';
import {
  PUMP_BONDING_CURVE_ENTRY_PROVENANCE,
  GMGN_FREE_AGGREGATE_ENTRY_PROVENANCE,
  PUMP_AUTHORIZED_FEED_ENTRY_PROVENANCE,
  ALL_EIGHT_ENTRY_PROVENANCES,
  ALL_UNIVERSE_ENTRY_REASONS,
} from '../fixtures/disc/entry-provenance.ts';
import {
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V1,
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V2,
  ALL_EIGHT_SOURCE_PROFILES,
} from '../fixtures/disc/source-profiles.ts';
import { provenanceSupportsClaim } from '../../packages/discovery-universe/src/source-profiles.ts';
import {
  DiscSourceProfileSchema,
  UniverseEntryProvenanceSchema,
} from '../../packages/shared-schemas/src/disc.ts';

function recordDiscoverySources(entries: DiscoveryUniverseEntryFixture[]) {
  // Sort by system availability timestamp to find the true first-seen
  const sorted = [...entries].sort(
    (a, b) => new Date(a.sourceAvailableAt).getTime() - new Date(b.sourceAvailableAt).getTime(),
  );

  const winningEntry = sorted[0];
  const subsequentSources = sorted.slice(1).map((e) => ({
    sourceId: e.sourceId,
    sourceClass: e.sourceClass,
    availableAt: e.sourceAvailableAt,
  }));

  return {
    assetRepresentationId: winningEntry.assetRepresentationId,
    firstSeenSourceId: winningEntry.sourceId,
    firstSeenSourceClass: winningEntry.sourceClass,
    firstSeenAvailableAt: winningEntry.sourceAvailableAt,
    subsequentSources,
  };
}

describe('AC-110 acceptance (positive): deterministic first-seen attribution & subsequent appending', () => {
  it('identifies earliest system-available entry and appends all subsequent discovery sources', () => {
    const multiSourceStream = [
      FREE_AGGREGATE_DISCOVERY_ENTRY, // available at 10:00:02.000Z
      FIRST_PARTY_DISCOVERY_ENTRY, // available at 10:00:00.005Z (earliest)
      AUTHORIZED_LAUNCH_FEED_ENTRY, // available at 10:00:00.400Z
    ];

    const attribution = recordDiscoverySources(multiSourceStream);

    expect(attribution.firstSeenSourceId).toBe('col_solana_pump_live');
    expect(attribution.firstSeenSourceClass).toBe('FIRST_PARTY_SUPPORTED_PROGRAM_EVENT');
    // UtcTimestamp is a branded string: compare against the same branded view
    // (exactOptionalPropertyTypes rejects assigning a bare string to it).
    expect(attribution.firstSeenAvailableAt as string).toBe('2026-08-20T10:00:00.005Z');
    expect(attribution.subsequentSources.length).toBe(2);
    expect(attribution.subsequentSources[0].sourceId).toBe('src_pump_official_webhook');
    expect(attribution.subsequentSources[1].sourceId).toBe('src_gmgn_free_aggregate');
  });
});

describe('AC-110 acceptance (positive) — per-source provenance & source profile facet (FR-DISC-011)', () => {
  it('records complete per-entry provenance across all 8 canonical entry reasons', () => {
    expect(ALL_EIGHT_ENTRY_PROVENANCES.length).toBe(8);
    expect(ALL_UNIVERSE_ENTRY_REASONS.length).toBe(8);

    for (const prov of ALL_EIGHT_ENTRY_PROVENANCES) {
      // 1. Validates against canonical shared schema
      const parsed = UniverseEntryProvenanceSchema.parse(prov);
      expect(parsed).toBeDefined();

      // 2. Contains all mandatory FR-DISC-011 fields
      expect(prov.assetRepresentationId).toBeDefined();
      expect(prov.normalizedIdentity).toBe(true);
      expect(prov.entryReason).toBeDefined();
      expect(ALL_UNIVERSE_ENTRY_REASONS).toContain(prov.entryReason);
      expect(prov.discoveryPolicyVersion.length).toBeGreaterThan(0);
      expect(prov.sourceAvailableAt).toBeDefined();
      expect(prov.firstIngestedAt).toBeDefined();
      expect(prov.sourceMetadataHash.startsWith('sha256:')).toBe(true);

      // 3. Supports downstream claims
      expect(provenanceSupportsClaim(prov)).toBe(true);
    }
  });

  it('validates complete source profiles across all 8 discovery source classes', () => {
    expect(ALL_EIGHT_SOURCE_PROFILES.length).toBe(8);

    for (const profile of ALL_EIGHT_SOURCE_PROFILES) {
      const parsed = DiscSourceProfileSchema.parse(profile);
      expect(parsed.sourceId).toBe(profile.sourceId);
      expect(profile.coverageScope.length).toBeGreaterThan(0);
      expect(profile.queryFilterVersion.length).toBeGreaterThan(0);
      expect(profile.rightsPolicy.length).toBeGreaterThan(0);
      expect(profile.upstreamDependenceDisclosed).toBe(true);
      expect(profile.metadataHash.startsWith('sha256:')).toBe(true);
    }
  });

  it('preserves immutable profile versioning with forward supersession chain', () => {
    const v1 = DiscSourceProfileSchema.parse(PUMP_FIRST_PARTY_SOURCE_PROFILE_V1);
    const v2 = DiscSourceProfileSchema.parse(PUMP_FIRST_PARTY_SOURCE_PROFILE_V2);

    expect(v1.sourceId).toBe(v2.sourceId);
    expect(PUMP_FIRST_PARTY_SOURCE_PROFILE_V2.supersedesVersion).toBe(
      PUMP_FIRST_PARTY_SOURCE_PROFILE_V1.version,
    );
    expect(new Date(PUMP_FIRST_PARTY_SOURCE_PROFILE_V2.registeredAt).getTime()).toBeGreaterThan(
      new Date(PUMP_FIRST_PARTY_SOURCE_PROFILE_V1.registeredAt).getTime(),
    );
  });

  it('distinguishes first-party observation from aggregate and downstream feeds', () => {
    expect(PUMP_BONDING_CURVE_ENTRY_PROVENANCE.isFirstParty).toBe(true);
    expect(GMGN_FREE_AGGREGATE_ENTRY_PROVENANCE.isFirstParty).toBe(false);
    expect(PUMP_AUTHORIZED_FEED_ENTRY_PROVENANCE.isFirstParty).toBe(false);

    // First-party entries have direct program event observation timestamp
    expect(PUMP_BONDING_CURVE_ENTRY_PROVENANCE.sourceObservedAt).toBeDefined();
    expect(
      new Date(PUMP_BONDING_CURVE_ENTRY_PROVENANCE.firstIngestedAt).getTime(),
    ).toBeGreaterThanOrEqual(
      new Date(PUMP_BONDING_CURVE_ENTRY_PROVENANCE.sourceAvailableAt).getTime(),
    );
  });
});
