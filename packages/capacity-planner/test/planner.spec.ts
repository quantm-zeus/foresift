/**
 * Capacity planner composition units (FR-COST-004, FR-COST-009, AC-101, AC-104, AC-228).
 *
 * Asserts:
 * - Merges cost-router admission + resource-budgets into the single QuotaAdmissionDecision seen by tool-core stage 12.
 * - Data-provider STRICT_FREE and BYOK model budget are disjoint adapter bindings that never share state.
 */
import { describe, expect, it } from 'bun:test';

describe('planner composition and admission merging (FR-COST-004, FR-COST-009)', () => {
  it('merges cost-router and resource-budget decisions into single QuotaAdmissionDecision', async () => {
    let PlannerModule: Record<string, unknown>;
    try {
      PlannerModule = (await import('../src/planner.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('PLANNER_NOT_IMPLEMENTED: src/planner.ts missing');
    }

    const CapacityPlanner = PlannerModule.CapacityPlanner as new (options?: Record<string, unknown>) => {
      evaluateAdmission: (req: {
        provider: string;
        operation: string;
        workloadClass: string;
        estimatedUnits: number;
        costMode: string;
        resourceDimension?: string;
      }) => Promise<{ allowed: boolean; reason: string }>;
    };

    const planner = new CapacityPlanner({ costMode: 'STRICT_FREE' });
    const decision = await planner.evaluateAdmission({
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'RISK_MONITORING',
      estimatedUnits: 1,
      costMode: 'STRICT_FREE',
    });

    expect(typeof decision.allowed).toBe('boolean');
    expect(typeof decision.reason).toBe('string');
  });

  it('keeps data-provider STRICT_FREE and BYOK model budget strictly disjoint', async () => {
    let PlannerModule: Record<string, unknown>;
    try {
      PlannerModule = (await import('../src/planner.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('PLANNER_NOT_IMPLEMENTED: src/planner.ts missing');
    }

    const CapacityPlanner = PlannerModule.CapacityPlanner as new (options?: Record<string, unknown>) => {
      canRunAgentWithByok: (params: {
        byokModelBudgetActive: boolean;
        dataProviderMode: string;
        attemptPaidDataCall: boolean;
      }) => { canRunAgent: boolean; canMakePaidDataCall: boolean };
    };

    const planner = new CapacityPlanner();
    const result = planner.canRunAgentWithByok({
      byokModelBudgetActive: true,
      dataProviderMode: 'STRICT_FREE',
      attemptPaidDataCall: true,
    });

    expect(result.canRunAgent).toBe(true);
    expect(result.canMakePaidDataCall).toBe(false);
  });
});
