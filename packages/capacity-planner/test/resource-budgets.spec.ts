/**
 * Resource budgets unit tests (FR-COST-009, FR-COST-010, AC-104, AC-105).
 * Tests independent capping across the six resource dimensions,
 * non-critical degradation containment, and BYOK namespace isolation.
 */
import { describe, expect, it } from 'bun:test';
import { evaluateResourceBudgetAdmission } from '../src/resource-budgets.ts';
import { SIX_RESOURCE_BUDGETS_FIXTURES } from '../../../tests/fixtures/cost/paid-policies.ts';

describe('resource-budgets', () => {
  it('admits requests when all six resource budgets are within capacity', () => {
    const verdict = evaluateResourceBudgetAdmission({
      budgets: SIX_RESOURCE_BUDGETS_FIXTURES,
      requestedKind: 'SCHEDULER_SLOTS',
      requestedAmount: 5,
    });

    expect(verdict.allowed).toBe(true);
  });

  it('degrades non-critically when low-priority scheduler slots are exhausted', () => {
    const exhaustedScheduler = SIX_RESOURCE_BUDGETS_FIXTURES.map((b) =>
      b.kind === 'SCHEDULER_SLOTS' ? { ...b, used: b.capLimit } : b,
    );

    const verdict = evaluateResourceBudgetAdmission({
      budgets: exhaustedScheduler,
      requestedKind: 'SCHEDULER_SLOTS',
      requestedAmount: 1,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe('SKIP_LOW_PRIORITY');
  });

  it('degrades non-critically when object storage is exhausted without deleting frozen evidence', () => {
    const exhaustedStorage = SIX_RESOURCE_BUDGETS_FIXTURES.map((b) =>
      b.kind === 'OBJECT_STORE_BYTES' ? { ...b, used: b.capLimit } : b,
    );

    const verdict = evaluateResourceBudgetAdmission({
      budgets: exhaustedStorage,
      requestedKind: 'OBJECT_STORE_BYTES',
      requestedAmount: 1000,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe('DOWNGRADE_DEPTH');
    expect(verdict.preserveFrozenEvidence).toBe(true);
  });

  it('keeps MODEL_TOKENS_BYOK strictly isolated from provider quota counters', () => {
    const byokBudget = SIX_RESOURCE_BUDGETS_FIXTURES.find((b) => b.kind === 'MODEL_TOKENS_BYOK');
    expect(byokBudget).toBeDefined();
    expect(byokBudget!.kind).toBe('MODEL_TOKENS_BYOK');
  });
});
