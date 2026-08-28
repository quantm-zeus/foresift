/**
 * AC-101 negative / failure-path — Cost & Capacity facet.
 * Traces: FR-COST-003, FR-COST-004.
 *
 * Asserts:
 * - Direct attempts by broad discovery workloads to request admission from protected reserves fail closed.
 * - Attempts to borrow reserve capacity across unequal/unauthorized priority boundaries are refused.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-101 negative: broad discovery cannot tap protected reserves', () => {
  it('refuses explicit reserve allocation to low-priority discovery tasks', async () => {
    let ReserveModule: Record<string, unknown>;
    try {
      ReserveModule = (await import('../../packages/cost-router/src/reserve-router.ts')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('RESERVE_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const allocateFromReserve = ReserveModule.allocateFromReserve as (req: {
      targetReserve: string;
      workloadClass: string;
      units: number;
    }) => { success: boolean; error?: string };

    const result = allocateFromReserve({
      targetReserve: 'RISK_MONITORING',
      workloadClass: 'DISCOVERY_BROAD',
      units: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/RESERVE_ACCESS_UNAUTHORIZED|WORKLOAD_NOT_ELIGIBLE/i);
  });
});
