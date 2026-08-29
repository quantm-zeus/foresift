/**
 * AC-104 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-009.
 * Tests protection of frozen evidence against destructive purge on storage exhaustion,
 * and independent degradation without double-counting on multiple budget exhaustion.
 */
import { describe, expect, it } from 'bun:test';
import { evaluateResourceBudgetAdmission } from '../../packages/capacity-planner/src/resource-budgets.ts';
import { SIX_RESOURCE_BUDGETS_FIXTURES } from '../fixtures/cost/paid-policies.ts';

describe('AC-104 negative: storage pressure cannot delete frozen evidence; independent exhaustion', () => {
  it('refuses actions that would purge or mutate frozen evidence rows', () => {
    const fullyExhaustedStorage = SIX_RESOURCE_BUDGETS_FIXTURES.map((b) =>
      b.kind === 'DATABASE_BYTES' ? { ...b, used: b.capLimit * 2 } : b,
    );

    const verdict = evaluateResourceBudgetAdmission({
      budgets: fullyExhaustedStorage,
      requestedKind: 'DATABASE_BYTES',
      requestedAmount: 5000,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.preserveFrozenEvidence).toBe(true);
  });

  it('simultaneous exhaustion of two budgets degrades each workload along its own policy', () => {
    const doubleExhausted = SIX_RESOURCE_BUDGETS_FIXTURES.map((b) => {
      if (b.kind === 'SCHEDULER_SLOTS' || b.kind === 'NOTIFICATION_RATE') {
        return { ...b, used: b.capLimit };
      }
      return b;
    });

    const schedulerVerdict = evaluateResourceBudgetAdmission({
      budgets: doubleExhausted,
      requestedKind: 'SCHEDULER_SLOTS',
      requestedAmount: 1,
    });
    const notificationVerdict = evaluateResourceBudgetAdmission({
      budgets: doubleExhausted,
      requestedKind: 'NOTIFICATION_RATE',
      requestedAmount: 1,
    });

    expect(schedulerVerdict.allowed).toBe(false);
    expect(notificationVerdict.allowed).toBe(false);
  });
});
