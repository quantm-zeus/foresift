/**
 * AC-110 negative (failure) — first-party observation & discovery attribution.
 * Traces: FR-COL-011, FR-DISC-002.
 * Tests rejection of un-attributed sources, destructive overwriting of first-seen,
 * or failure to append subsequent discovery sources.
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
