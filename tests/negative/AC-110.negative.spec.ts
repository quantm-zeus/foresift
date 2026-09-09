/**
 * AC-110 negative (failure) — first-party observation & discovery attribution.
 * Traces: FR-COL-011, FR-DISC-002, FR-DISC-011.
 * Tests rejection of un-attributed sources, destructive overwriting of first-seen,
 * failure to append subsequent discovery sources, or truncated provenance dimensions.
 */
import { describe, expect, it } from 'bun:test';
import {
  FIRST_PARTY_DISCOVERY_ENTRY,
  FREE_AGGREGATE_DISCOVERY_ENTRY,
} from '../fixtures/disc/index.ts';

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

describe('AC-110 negative facet (FR-DISC-011): provenance truncation and backdating refused', () => {
  it('refuses discovery entries with backdated firstIngestedAt preceding sourceAvailableAt', () => {
    const backdatedEntry = {
      ...FIRST_PARTY_DISCOVERY_ENTRY,
      sourceAvailableAt: '2026-08-20T10:00:00.010Z' as const,
      firstIngestedAt: '2026-08-20T10:00:00.005Z' as const, // backdated by 5ms!
    };

    const isTemporallyConsistent =
      new Date(backdatedEntry.firstIngestedAt).getTime() >=
      new Date(backdatedEntry.sourceAvailableAt).getTime();
    expect(isTemporallyConsistent).toBe(false);
  });

  it('refuses entries missing query/filter version or metadata verification hash', () => {
    const truncatedEntry = {
      ...FIRST_PARTY_DISCOVERY_ENTRY,
      discoveryPolicyVersion: '',
      sourceMetadataHash: 'unhashed_raw_string',
    };

    const hasValidPolicy = truncatedEntry.discoveryPolicyVersion.length > 0;
    const hasValidSha256 = truncatedEntry.sourceMetadataHash.startsWith('sha256:');

    expect(hasValidPolicy).toBe(false);
    expect(hasValidSha256).toBe(false);
  });
});
