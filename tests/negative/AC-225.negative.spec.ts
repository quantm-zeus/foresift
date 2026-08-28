/**
 * AC-225 negative / failure-path — Cost & Backfill Ledger Scoping facet.
 * Traces: FR-COST-001.
 *
 * Asserts:
 * - Rejecting retroactive assignment of backfill costs to past closed quota balance periods.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-225 negative: backfill cost cannot backdate into closed quota windows', () => {
  it('throws error when backfill cost timestamp is forged to precede retrieval window', async () => {
    let QuotaModule: Record<string, unknown>;
    try {
      QuotaModule = (await import(
        '../../packages/cost-router/src/quota-adapter.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('COST_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const validateBackfillCostTimestamp = QuotaModule.validateBackfillCostTimestamp as (
      eventChainTime: string,
      costAssignedTime: string,
      earliestAllowedTime: string,
    ) => boolean;

    // costAssignedTime backdated before retrieval time
    expect(() =>
      validateBackfillCostTimestamp(
        '2026-08-01T00:00:00Z',
        '2026-08-01T00:00:00Z', // Attempted retroactive cost timestamp
        '2026-08-05T00:00:00Z', // Actual retrieval time
      ),
    ).toThrow(/BACKDATED_COST_ASSIGNMENT_REFUSED|RETRIEVAL_WINDOW_VIOLATION/i);
  });
});
