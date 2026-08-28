/**
 * AC-105 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-010, FR-COST-008.
 * AC text (manifest §39): "Nonzero approved BYOK model budget enables headless agent
 * model token consumption while data-provider mode remains STRICT_FREE with zero
 * paid data calls."
 *
 * Facet scope (cost-capacity):
 * - Activates approved BYOK model token budget.
 * - Allows model token consumption in agent workflows.
 * - Proves data-provider admission strictly remains STRICT_FREE with 0 paid calls.
 */
import { describe, expect, it } from 'bun:test';
import { evaluateResourceBudgetAdmission } from '../../packages/capacity-planner/src/resource-budgets.ts';
import { evaluateStrictFreeGuard } from '../../packages/cost-router/src/strict-free-guard.ts';
import { BYOK_MODEL_BUDGET_FIXTURE } from '../fixtures/cost/paid-policies.ts';
import { FREE_QUOTA_OP, PAID_EXPLICIT_OP } from '../fixtures/cost/operations.ts';

describe('AC-105 acceptance (positive): BYOK model budget independence from data-provider STRICT_FREE', () => {
  it('allows model token usage under approved BYOK budget while data provider stays STRICT_FREE', () => {
    // 1. Model token admission succeeds
    const modelAdmission = evaluateResourceBudgetAdmission({
      budgets: [BYOK_MODEL_BUDGET_FIXTURE],
      requestedKind: 'MODEL_TOKENS_BYOK',
      requestedAmount: 500,
    });
    expect(modelAdmission.allowed).toBe(true);

    // 2. Data provider call under STRICT_FREE admits free operations
    const dataFreeAdmission = evaluateStrictFreeGuard({
      declaration: FREE_QUOTA_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 1,
      callerId: 'actor_agent:run_105_1',
      paidFallbackAttempted: false,
    });
    expect(dataFreeAdmission.allowed).toBe(true);

    // 3. Data provider paid call remains strictly blocked
    const dataPaidAdmission = evaluateStrictFreeGuard({
      declaration: PAID_EXPLICIT_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 10,
      callerId: 'actor_agent:run_105_1',
      paidFallbackAttempted: false,
    });
    expect(dataPaidAdmission.allowed).toBe(false);
    expect(dataPaidAdmission.denial!.reason).toMatch(/^PAID_BLOCKED:/);
  });
});
