/**
 * AC-105 negative / failure-path — Cost & BYOK Model Isolation facet.
 * Traces: FR-COST-008, FR-COST-010.
 *
 * Asserts:
 * - Having an active BYOK model budget does NOT unlock paid data provider operations.
 * - Attempting a paid data provider call while in STRICT_FREE still refuses fail-closed.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-105 negative: BYOK model budget cannot fund paid data-provider calls', () => {
  it('blocks paid data provider operation even when BYOK model budget has ample balance', async () => {
    let PlannerModule: Record<string, unknown>;
    try {
      PlannerModule = (await import(
        '../../packages/capacity-planner/src/planner.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_PLANNER_NOT_IMPLEMENTED: packages/capacity-planner missing');
    }

    const evaluateAgentDataCall = PlannerModule.evaluateAgentDataCall as (req: {
      byokModelBalanceUsd: number;
      dataProviderMode: string;
      operationCostClass: string;
    }) => { allowed: boolean; reason: string };

    const result = evaluateAgentDataCall({
      byokModelBalanceUsd: 100.0,
      dataProviderMode: 'STRICT_FREE',
      operationCostClass: 'PAID_EXPLICIT',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/^PAID_BLOCKED|^STRICT_FREE_BLOCKED/);
  });
});
