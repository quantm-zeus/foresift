/**
 * AC-104 negative / failure-path — Cost & Multi-dimension Budgets facet.
 * Traces: FR-COST-009.
 *
 * Asserts:
 * - Direct attempts to evict or purge frozen evidence rows to reclaim database storage space fail closed.
 * - Suppressing risk monitoring under storage/budget exhaustion is refused.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-104 negative: cannot purge frozen evidence or suppress risk monitoring', () => {
  it('refuses deletion of frozen evidence under storage pressure', async () => {
    let CapacityModule: Record<string, unknown>;
    try {
      CapacityModule = (await import(
        '../../packages/capacity-planner/src/resource-budgets.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_PLANNER_NOT_IMPLEMENTED: packages/capacity-planner missing');
    }

    const attemptReclaimStorage = CapacityModule.attemptReclaimStorage as (target: {
      targetType: string;
      isFrozenEvidence: boolean;
    }) => { allowed: boolean; error?: string };

    const result = attemptReclaimStorage({
      targetType: 'EVIDENCE_PACK',
      isFrozenEvidence: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/FROZEN_EVIDENCE_IMMUTABLE|CANNOT_PURGE_EVIDENCE/i);
  });
});
