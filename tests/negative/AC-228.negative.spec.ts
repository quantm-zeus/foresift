/**
 * AC-228 negative / failure-path — Cost & Degradation Priority Ordering facet.
 * Traces: FR-COST-003, FR-COST-004.
 *
 * Asserts:
 * - Inverting degradation sequence (e.g. degrading risk monitoring before social enrichment) fails policy validation.
 * - Suppressing protected reserves while low-priority enrichment is active is rejected fail-closed.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-228 negative: degradation sequence inversion is rejected', () => {
  it('rejects degradation plan that throttles risk monitoring while social discovery is active', async () => {
    let CapacityModule: Record<string, unknown>;
    try {
      CapacityModule = (await import(
        '../../packages/capacity-planner/src/degrade-policy.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_PLANNER_NOT_IMPLEMENTED: packages/capacity-planner missing');
    }

    const validateDegradationPlan = CapacityModule.validateDegradationPlan as (plan: {
      activeWorkloads: string[];
      degradedWorkloads: string[];
    }) => boolean;

    // Invalid plan: degraded RISK_MONITORING while SOCIAL_NARRATIVE remains active
    expect(() =>
      validateDegradationPlan({
        activeWorkloads: ['SOCIAL_NARRATIVE'],
        degradedWorkloads: ['RISK_MONITORING'],
      }),
    ).toThrow(/INVALID_DEGRADATION_PRIORITY|PROTECTED_WORKLOAD_DEGRADED_FIRST/i);
  });
});
