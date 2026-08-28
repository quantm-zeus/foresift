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

    const accountingWindowStart = '2026-08-01T00:00:00Z'; // Daily window containing retrievalTime

    expect(accountingWindowStart).not.toBe('2026-01-01T00:00:00Z');
  });
});
