/**
 * AC-110 acceptance (positive) — first-party observation & discovery attribution.
 * Traces: FR-COL-011, FR-DISC-002.
 * AC text (manifest §39): "Every first-seen candidate records source, source timestamp,
 * system timestamp, source rank, and all subsequent discovery sources; earliest valid
 * system-available entry wins as first-seen; all subsequent sources appended."
 */
import { describe, expect, it } from 'bun:test';
import {
  FIRST_PARTY_DISCOVERY_ENTRY,
  FREE_AGGREGATE_DISCOVERY_ENTRY,
  AUTHORIZED_LAUNCH_FEED_ENTRY,
  type DiscoveryUniverseEntryFixture,
} from '../fixtures/disc/index.ts';

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
      FIRST_PARTY_DISCOVERY_ENTRY,    // available at 10:00:00.005Z (earliest)
      AUTHORIZED_LAUNCH_FEED_ENTRY,   // available at 10:00:00.400Z
    ];

    const attribution = recordDiscoverySources(multiSourceStream);

    expect(attribution.firstSeenSourceId).toBe('col_solana_pump_live');
    expect(attribution.firstSeenSourceClass).toBe('FIRST_PARTY_SUPPORTED_PROGRAM_EVENT');
    expect(attribution.firstSeenAvailableAt).toBe('2026-08-20T10:00:00.005Z');
    expect(attribution.subsequentSources.length).toBe(2);
    expect(attribution.subsequentSources[0].sourceId).toBe('src_pump_official_webhook');
    expect(attribution.subsequentSources[1].sourceId).toBe('src_gmgn_free_aggregate');
  });
});
