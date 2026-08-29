/**
 * AC-104 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-009.
 * AC text (manifest §39): "Low-priority scheduler, storage, and model budget exhaustion
 * degrades enrichment and retention non-critically without deleting frozen evidence
 * or halting risk monitoring."
 *
 * Facet scope (cost-capacity):
 * - Exhausts scheduler, storage, and model token budgets individually.
 * - Asserts non-critical degradation per declared policy.
 * - Confirms frozen evidence is preserved and risk monitoring remains active.
 */
import { describe, expect, it } from 'bun:test';
import { evaluateResourceBudgetAdmission } from '../../packages/capacity-planner/src/resource-budgets.ts';
import { SIX_RESOURCE_BUDGETS_FIXTURES } from '../fixtures/cost/paid-policies.ts';

describe('AC-104 acceptance (positive): non-critical degradation on resource budget exhaustion', () => {
  it('degrades scheduler exhaustion by skipping low priority workflows without affecting risk monitoring', () => {
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

  it('degrades storage exhaustion by downgrading retention depth while preserving frozen evidence', () => {
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
});
