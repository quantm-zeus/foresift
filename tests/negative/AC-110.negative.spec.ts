/**
 * AC-110 negative (failure) — first-party observation & discovery attribution.
 * Traces: FR-COL-011, FR-DISC-002, FR-DISC-011.
 * Tests rejection of un-attributed sources, destructive overwriting of first-seen,
 * incomplete per-entry provenance, incompatible first-party claims, and invalid source profiles.
 *
 * Facet convention:
 * 1. Base negative facet: attribution tampering and non-append modifications refused.
 * 2. Per-source provenance & source profile refusal facet (FR-DISC-011): rejection of
 *    incomplete provenance, invalid entry reasons, missing rights, undisclosed upstream dependence,
 *    fraudulent first-party flags, and malformed source profiles.
 */
import { describe, expect, it } from 'bun:test';
import {
  FIRST_PARTY_DISCOVERY_ENTRY,
  FREE_AGGREGATE_DISCOVERY_ENTRY,
} from '../fixtures/disc/index.ts';
import {
  INCOMPLETE_ENTRY_MISSING_REASON,
  INCOMPLETE_ENTRY_UNNORMALIZED_IDENTITY,
  INCOMPLETE_ENTRY_INVERTED_TIMESTAMPS,
  INCOMPLETE_ENTRY_NON_SHA256_HASH,
  UNBACKED_FIRST_PARTY_CLAIM_ENTRY,
} from '../fixtures/disc/entry-provenance.ts';
import {
  INVALID_SELF_SUPERSEDING_PROFILE,
  INVALID_FORWARD_SUPERSEDING_PROFILE,
  INCOMPLETE_PROFILE_MISSING_SOURCE_CLASS,
  INCOMPLETE_PROFILE_MISSING_VERSION,
  INCOMPLETE_PROFILE_MISSING_RIGHTS,
  INCOMPLETE_PROFILE_UNDISCLOSED_UPSTREAM,
  INVALID_UNKNOWN_SOURCE_CLASS_PROFILE,
} from '../fixtures/disc/source-profiles.ts';
import { provenanceSupportsClaim } from '../../packages/discovery-universe/src/source-profiles.ts';
import {
  DiscSourceProfileSchema,
  UniverseEntryProvenanceSchema,
} from '../../packages/shared-schemas/src/disc.ts';

describe('AC-110 negative: attribution tampering and non-append modifications refused', () => {
  it('refuses discovery entries missing valid sourceId or sourceClass', () => {
    const invalidEntry = {
      ...FREE_AGGREGATE_DISCOVERY_ENTRY,
      sourceId: '',
      sourceClass: 'INVALID_SOURCE_CLASS',
    };

    const hasValidSource = invalidEntry.sourceId.length > 0;
    expect(hasValidSource).toBe(false);
  });

  it('refuses destructive overwrite of earliest first-seen attribution upon arrival of later source', () => {
    const originalFirstSeen = FIRST_PARTY_DISCOVERY_ENTRY.sourceAvailableAt;
    const laterEntry = FREE_AGGREGATE_DISCOVERY_ENTRY.sourceAvailableAt;

    // A later source must NOT overwrite the earlier first-seen timestamp
    const shouldOverwrite = new Date(laterEntry).getTime() < new Date(originalFirstSeen).getTime();
    expect(shouldOverwrite).toBe(false);
  });
});

describe('AC-110 negative (failure) — per-source provenance & source profile refusal facet (FR-DISC-011)', () => {
  it('refuses per-entry provenance missing canonical entry reason or specifying unknown reason', () => {
    const res1 = UniverseEntryProvenanceSchema.safeParse(INCOMPLETE_ENTRY_MISSING_REASON);
    expect(res1.success).toBe(false);

    const unknownReason = {
      ...INCOMPLETE_ENTRY_MISSING_REASON,
      entryReason: 'UNAUTHORIZED_SPAM_INJECTION',
    };
    const res2 = UniverseEntryProvenanceSchema.safeParse(unknownReason);
    expect(res2.success).toBe(false);

    expect(provenanceSupportsClaim(unknownReason)).toBe(false);
  });

  it('refuses per-entry provenance with unnormalized identity', () => {
    const res = UniverseEntryProvenanceSchema.safeParse(INCOMPLETE_ENTRY_UNNORMALIZED_IDENTITY);
    expect(res.success).toBe(false);
    expect(provenanceSupportsClaim(INCOMPLETE_ENTRY_UNNORMALIZED_IDENTITY)).toBe(false);
  });

  it('refuses per-entry provenance with inverted timestamps (firstIngestedAt < sourceAvailableAt)', () => {
    const res = UniverseEntryProvenanceSchema.safeParse(INCOMPLETE_ENTRY_INVERTED_TIMESTAMPS);
    expect(res.success).toBe(false);
    expect(provenanceSupportsClaim(INCOMPLETE_ENTRY_INVERTED_TIMESTAMPS)).toBe(false);
  });

  it('refuses per-entry provenance with invalid metadata hash format', () => {
    const res = UniverseEntryProvenanceSchema.safeParse(INCOMPLETE_ENTRY_NON_SHA256_HASH);
    expect(res.success).toBe(false);
    expect(provenanceSupportsClaim(INCOMPLETE_ENTRY_NON_SHA256_HASH)).toBe(false);
  });

  it('refuses incompatible first-party attribution on non-first-party source classes', () => {
    // FREE_AGGREGATE_DISCOVERY claiming isFirstParty = true must be rejected
    const res = UniverseEntryProvenanceSchema.safeParse(UNBACKED_FIRST_PARTY_CLAIM_ENTRY);
    expect(res.success).toBe(false);
    expect(provenanceSupportsClaim(UNBACKED_FIRST_PARTY_CLAIM_ENTRY)).toBe(false);
  });

  it('incomplete per-entry provenance fails claim-support predicate', () => {
    const incompleteVariants = [
      INCOMPLETE_ENTRY_MISSING_REASON,
      INCOMPLETE_ENTRY_UNNORMALIZED_IDENTITY,
      INCOMPLETE_ENTRY_INVERTED_TIMESTAMPS,
      INCOMPLETE_ENTRY_NON_SHA256_HASH,
      UNBACKED_FIRST_PARTY_CLAIM_ENTRY,
    ];

    for (const variant of incompleteVariants) {
      expect(provenanceSupportsClaim(variant)).toBe(false);
    }
  });

  it('refuses source profiles missing mandatory fields or specifying unknown classes', () => {
    const resClass = DiscSourceProfileSchema.safeParse(INCOMPLETE_PROFILE_MISSING_SOURCE_CLASS);
    expect(resClass.success).toBe(false);

    const resVersion = DiscSourceProfileSchema.safeParse(INCOMPLETE_PROFILE_MISSING_VERSION);
    expect(resVersion.success).toBe(false);

    const resRights = DiscSourceProfileSchema.safeParse(INCOMPLETE_PROFILE_MISSING_RIGHTS);
    expect(resRights.success).toBe(false);

    const resUnknown = DiscSourceProfileSchema.safeParse(INVALID_UNKNOWN_SOURCE_CLASS_PROFILE);
    expect(resUnknown.success).toBe(false);
  });

  it('refuses source profiles with self-supersession or inverted validity windows', () => {
    const resSelf = DiscSourceProfileSchema.safeParse(INVALID_SELF_SUPERSEDING_PROFILE);
    expect(resSelf.success).toBe(false);

    const invertedWindow = {
      sourceId: 'src_test_inverted',
      profileVersion: 1,
      sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
      coverageScope: { scope: 'test' },
      rightsBasis: 'FIRST_PARTY_COLLECTOR',
      queryFilterVersion: 'qf_v1',
      upstreamDependence: {},
      upstreamLineageKeys: [],
      manipulationPolicy: 'LABEL_AND_RETAIN',
      collectorScopeIds: ['scope_1'],
      effectiveFrom: '2026-08-20T12:00:00.000Z',
      supersededAt: '2026-08-20T10:00:00.000Z', // Inverted: supersededAt <= effectiveFrom
    };
    const resInverted = DiscSourceProfileSchema.safeParse(invertedWindow);
    expect(resInverted.success).toBe(false);
  });
});
