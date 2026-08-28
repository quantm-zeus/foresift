/**
 * Planner composition unit tests (FR-COST-004, FR-COST-009, AC-101, AC-104, AC-228).
 * Tests combined decision precedence (cost-router admission + resource budgets)
 * into a single QuotaAdmissionDecision consumed by tool-core stage 12.
 */
import { describe, expect, it } from 'bun:test';
import {
  CapacityPlanner,
  type PlannerAdmissionInput,
} from '../src/planner.ts';
import { SIX_RESOURCE_BUDGETS_FIXTURES } from '../../../tests/fixtures/cost/paid-policies.ts';
import { FREE_QUOTA_OP } from '../../../tests/fixtures/cost/operations.ts';

describe('CapacityPlanner', () => {
  it('admits request when both cost router and resource budgets admit', async () => {
    const planner = new CapacityPlanner({
      resourceBudgets: SIX_RESOURCE_BUDGETS_FIXTURES,
    });

    const input: PlannerAdmissionInput = {
      providerId: FREE_QUOTA_OP.providerId,
      operationId: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH',
      estimatedUnits: 1,
      costRouterVerdict: { allowed: true, reason: 'OK' },
    };

    const decision = await planner.admit(input);
    expect(decision.allowed).toBe(true);
  });

  it('refuses request when cost router refuses even if resource budgets are abundant', async () => {
    const planner = new CapacityPlanner({
      resourceBudgets: SIX_RESOURCE_BUDGETS_FIXTURES,
    });

    const input: PlannerAdmissionInput = {
      providerId: 'prov_paid_market',
      operationId: 'get_orderbook_l3',
      workloadClass: 'INTERACTIVE_HIGH',
      estimatedUnits: 10,
      costRouterVerdict: { allowed: false, reason: 'STRICT_FREE_BLOCKED: paid provider' },
    };

    const decision = await planner.admit(input);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('STRICT_FREE_BLOCKED');
  });

  it('refuses request when a required resource budget is exhausted', async () => {
    const exhaustedBudgets = SIX_RESOURCE_BUDGETS_FIXTURES.map((b) =>
      b.kind === 'SCHEDULER_SLOTS' ? { ...b, used: b.capLimit } : b,
    );

    const planner = new CapacityPlanner({
      resourceBudgets: exhaustedBudgets,
    });

    const input: PlannerAdmissionInput = {
      providerId: FREE_QUOTA_OP.providerId,
      operationId: FREE_QUOTA_OP.operationId,
      workloadClass: 'BACKFILL_LOW',
      estimatedUnits: 1,
      costRouterVerdict: { allowed: true, reason: 'OK' },
      requiredResourceKind: 'SCHEDULER_SLOTS',
    };

    const decision = await planner.admit(input);
    expect(decision.allowed).toBe(false);
  });
});
