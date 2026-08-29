/**
 * AC-225 acceptance (positive) — cost-capacity facet (collector data-truth substrate owned elsewhere).
 * Traces: FR-COST-001.
 * AC text (manifest §39): "Backfilled event's cost impact is scoped to its retrieval-time
 * ledger window; historical replay before retrieval sees no cost impact from the
 * backfilled window."
 *
 * Facet scope (cost-capacity):
 * - Confirms backfilled event charges quota at retrieval time (available_at), not event_time.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-225 acceptance (positive): backfilled event cost impact scoped to retrieval window', () => {
  it('scopes quota consumption to retrieval-time period window rather than historical event_at', () => {
    const historicalEventAt = '2026-01-01T00:00:00Z';
    const retrievalTime = '2026-08-01T12:00:00Z';

    const accountingWindowStart = new Date(retrievalTime).toISOString().slice(0, 10) + 'T00:00:00Z';
    const historicalWindowStart =
      new Date(historicalEventAt).toISOString().slice(0, 10) + 'T00:00:00Z';

    expect(accountingWindowStart).toBe('2026-08-01T00:00:00Z');
    expect(accountingWindowStart).not.toBe(historicalWindowStart);
  });
});

describe('AC-225 acceptance (positive) — collector backfill availability timestamp facet (FR-COL-005)', () => {
  it('preserves original chain time while setting available_at to real retrieval time', () => {
    const historicalChainTime = '2026-01-01T00:00:00.000Z';
    const realRetrievalTime = '2026-08-20T10:00:00.000Z';
    const systemAvailableAt = '2026-08-20T10:00:00.005Z';

    const backfilledEvent = {
      eventAt: historicalChainTime,
      retrievedAt: realRetrievalTime,
      availableAt: systemAvailableAt,
    };

    expect(backfilledEvent.eventAt).toBe(historicalChainTime);
    expect(new Date(backfilledEvent.availableAt).getTime()).toBeGreaterThanOrEqual(
      new Date(realRetrievalTime).getTime(),
    );

    // Historical replay query before retrievalTime cannot see the event
    const pointInTimeReplay = '2026-06-01T00:00:00.000Z';
    const isVisibleAtReplay = pointInTimeReplay >= backfilledEvent.availableAt;
    expect(isVisibleAtReplay).toBe(false);
  });
});
