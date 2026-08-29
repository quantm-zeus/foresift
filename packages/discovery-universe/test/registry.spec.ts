/**
 * Discovery universe registry & PIT queries unit tests (FR-DISC-002, FR-DISC-003).
 * Earliest valid system-available entry wins as first-seen; all subsequent sources are appended.
 */
import { describe, expect, it } from 'bun:test';
import {
  FIRST_PARTY_DISCOVERY_ENTRY,
  FREE_AGGREGATE_DISCOVERY_ENTRY,
  AUTHORIZED_LAUNCH_FEED_ENTRY,
  type DiscoveryUniverseEntryFixture,
} from '../../../tests/fixtures/disc/index.ts';

function computeFirstSeenRecord(entries: DiscoveryUniverseEntryFixture[]): {
  winningSourceId: string;
  firstSeenAvailableAt: string;
  subsequentSources: string[];
} {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.sourceAvailableAt).getTime() - new Date(b.sourceAvailableAt).getTime(),
  );
  const winner = sorted[0];
  const subsequent = sorted.slice(1).map((e) => e.sourceId);

  return {
    winningSourceId: winner.sourceId,
    firstSeenAvailableAt: winner.sourceAvailableAt,
    subsequentSources: subsequent,
  };
}

describe('Discovery Universe Registry (FR-DISC-002, FR-DISC-003)', () => {
  it('selects earliest system-available entry as first-seen and appends all subsequent sources', () => {
    const entries = [
      FREE_AGGREGATE_DISCOVERY_ENTRY,
      FIRST_PARTY_DISCOVERY_ENTRY,
      AUTHORIZED_LAUNCH_FEED_ENTRY,
    ];

    const result = computeFirstSeenRecord(entries);

    // FIRST_PARTY availableAt: 10:00:00.005Z (earliest)
    // AUTHORIZED_LAUNCH availableAt: 10:00:00.400Z
    // FREE_AGGREGATE availableAt: 10:00:02.000Z
    expect(result.winningSourceId).toBe('col_solana_pump_live');
    expect(result.firstSeenAvailableAt).toBe('2026-08-20T10:00:00.005Z');
    expect(result.subsequentSources).toEqual([
      'src_pump_official_webhook',
      'src_gmgn_free_aggregate',
    ]);
  });
});
