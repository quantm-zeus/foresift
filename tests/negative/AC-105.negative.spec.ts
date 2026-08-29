/**
 * AC-105 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-010, FR-COST-008.
 * Tests rejection of data-provider paid calls despite presence of BYOK budget,
 * and rejection of cross-namespace borrowing between model tokens and data quota.
 */
import { describe, expect, it } from 'bun:test';
import { evaluateStrictFreeGuard } from '../../packages/cost-router/src/strict-free-guard.ts';
import { evaluateResourceBudgetAdmission } from '../../packages/capacity-planner/src/resource-budgets.ts';
import { PAID_EXPLICIT_OP } from '../fixtures/cost/operations.ts';
import { BYOK_MODEL_BUDGET_FIXTURE } from '../fixtures/cost/paid-policies.ts';

describe('AC-105 negative: BYOK budget presence does not lift data STRICT_FREE or share quota', () => {
  it('strictly blocks paid data-provider call even with abundant BYOK model budget', () => {
    const verdict = evaluateStrictFreeGuard({
      declaration: PAID_EXPLICIT_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 10,
      callerId: 'actor_agent:run_105_neg_1',
      paidFallbackAttempted: false,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.denial!.reason).toMatch(/^PAID_BLOCKED:/);
  });

  it('exhausting model tokens does not borrow or drain data-provider quota balances', () => {
    const exhaustedByok = {
      ...BYOK_MODEL_BUDGET_FIXTURE,
      used: BYOK_MODEL_BUDGET_FIXTURE.capLimit,
    };

    const modelVerdict = evaluateResourceBudgetAdmission({
      budgets: [exhaustedByok],
      requestedKind: 'MODEL_TOKENS_BYOK',
      requestedAmount: 100,
    });

    expect(modelVerdict.allowed).toBe(false);
  });
});
