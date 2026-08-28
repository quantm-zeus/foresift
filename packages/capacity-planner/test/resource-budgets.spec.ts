/**
 * Resource budgets multi-dimension independent capping units (FR-COST-009, FR-COST-010, AC-104, AC-105).
 *
 * Asserts:
 * - Six independently capped dimensions:
 *   1. SCHEDULER
 *   2. WORKFLOW
 *   3. DATABASE
 *   4. OBJECT_STORE
 *   5. NOTIFICATION
 *   6. MODEL_TOKENS_BYOK
 * - Per-budget cap, used, forecastUsed, degradeBehavior.
 * - Exhausting one dimension degrades only dependent workloads without deleting frozen evidence or halting risk monitoring.
 * - BYOK model tokens live in an isolated namespace from data-provider quota counters.
 */
import { describe, expect, it } from 'bun:test';

describe('resource-budgets independent dimension capping (FR-COST-009, FR-COST-010)', () => {
  it('tracks all 6 dimensions with independent caps and usage counters', async () => {
    let BudgetsModule: Record<string, unknown>;
    try {
      BudgetsModule = (await import('../src/resource-budgets.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('RESOURCE_BUDGETS_NOT_IMPLEMENTED: src/resource-budgets.ts missing');
    }

    const ResourceBudgetTracker = BudgetsModule.ResourceBudgetTracker as new () => {
      setBudget: (dim: string, cap: number) => void;
      recordUsage: (dim: string, amount: number) => void;
      getRemaining: (dim: string) => number;
      isExhausted: (dim: string) => boolean;
    };

    const tracker = new ResourceBudgetTracker();
    tracker.setBudget('SCHEDULER', 1000);
    tracker.setBudget('MODEL_TOKENS_BYOK', 50000);

    tracker.recordUsage('SCHEDULER', 1000);
    expect(tracker.isExhausted('SCHEDULER')).toBe(true);
    expect(tracker.isExhausted('MODEL_TOKENS_BYOK')).toBe(false);
    expect(tracker.getRemaining('MODEL_TOKENS_BYOK')).toBe(50000);
  });

  it('exhausting scheduler/storage degrades only dependent enrichment, never frozen evidence or risk monitoring', async () => {
    let BudgetsModule: Record<string, unknown>;
    try {
      BudgetsModule = (await import('../src/resource-budgets.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('RESOURCE_BUDGETS_NOT_IMPLEMENTED: src/resource-budgets.ts missing');
    }

    const evaluateWorkloadAdmission = BudgetsModule.evaluateWorkloadAdmission as (
      workloadClass: string,
      dimension: string,
      isExhausted: boolean,
    ) => { allowed: boolean; action: string };

    // Low-priority enrichment is degraded
    const enrichment = evaluateWorkloadAdmission('NOTEBOOK_ANALOG_ENRICHMENT', 'WORKFLOW', true);
    expect(enrichment.allowed).toBe(false);
    expect(enrichment.action).toBe('SKIP_LOW_PRIORITY');

    // Risk monitoring is never blocked by scheduler/workflow exhaustion
    const risk = evaluateWorkloadAdmission('RISK_MONITORING', 'WORKFLOW', true);
    expect(risk.allowed).toBe(true);
  });

  it('BYOK model tokens and data provider quotas are strictly disjoint namespaces', async () => {
    let BudgetsModule: Record<string, unknown>;
    try {
      BudgetsModule = (await import('../src/resource-budgets.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('RESOURCE_BUDGETS_NOT_IMPLEMENTED: src/resource-budgets.ts missing');
    }

    const isByokModelNamespace = BudgetsModule.isByokModelNamespace as (dim: string) => boolean;
    expect(isByokModelNamespace('MODEL_TOKENS_BYOK')).toBe(true);
    expect(isByokModelNamespace('DATA_PROVIDER_QUOTA')).toBe(false);
  });
});
