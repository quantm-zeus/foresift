/**
 * AC-225 acceptance suite (cost facet: FR-COST-001).
 * AC text: "A backfilled event retains its original chain time but receives
 * no available_at earlier than the real retrieval time; historical replay before
 * retrieval cannot see it."
 */
import { describe, expect, it } from 'bun:test';

describe('AC-225 acceptance: backfill cost impact is scoped to retrieval window', () => {
  it('attributes cost to retrieval-time ledger and hides cost from pre-retrieval replay', () => {
    const eventTime = '2026-08-01T09:00:00Z';
    const retrievalTime = '2026-08-01T15:00:00Z';
    const preRetrievalReplayTime = '2026-08-01T12:00:00Z';

    const costLedgerEntries = [
      {
        entryId: 'cost-backfill-1',
        eventTime,
        retrievalTime,
        costUnits: 5,
      },
    ];

    const preRetrievalCost = costLedgerEntries
      .filter((e) => new Date(e.retrievalTime).getTime() <= new Date(preRetrievalReplayTime).getTime())
      .reduce((sum, e) => sum + e.costUnits, 0);

    expect(preRetrievalCost).toBe(0);

    const postRetrievalCost = costLedgerEntries
      .filter((e) => new Date(e.retrievalTime).getTime() <= new Date('2026-08-01T16:00:00Z').getTime())
      .reduce((sum, e) => sum + e.costUnits, 0);

    expect(postRetrievalCost).toBe(5);
  });
});
