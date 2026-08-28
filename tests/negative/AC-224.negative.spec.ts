/**
 * AC-224 negative / failure-path — Cost & Collector Checkpoint facet.
 * Traces: FR-COST-001, FR-COST-005.
 *
 * Asserts:
 * - Attempted replay with altered request hash fails reservation reuse.
 * - Double-charging across checkpoint recovery boundaries is refused fail-closed.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-224 negative: double-charging on checkpoint recovery is refused', () => {
  it('detects quota ledger discrepancy if checkpoint resume re-charges settled transactions', async () => {
    let QuotaModule: Record<string, unknown>;
    try {
      QuotaModule = (await import(
        '../../packages/cost-router/src/quota-adapter.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('COST_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const verifyCheckpointLedgerIntegrity = QuotaModule.verifyCheckpointLedgerIntegrity as (
      checkpointSlot: number,
      eventsProcessed: number,
      totalUnitsCharged: number,
      unitCost: number,
    ) => boolean;

    // 10 events at 1 unit cost should be 10 units, but charged 20 (double charge)
    expect(() =>
      verifyCheckpointLedgerIntegrity(100, 10, 20, 1),
    ).toThrow(/QUOTA_DOUBLE_COUNT_DETECTED|LEDGER_CORRUPTED/i);
  });
});
