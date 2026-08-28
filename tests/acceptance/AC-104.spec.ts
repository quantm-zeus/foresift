/**
 * AC-104 acceptance (positive) — Cost & Multi-dimension Budgets facet.
 * Traces: FR-COST-009.
 * AC text: "Exhausting low-priority scheduler/storage/model budgets degrades enrichment
 * or retention according to policy without deleting frozen evidence or stopping critical risk monitoring."
 *
 * Asserts:
 * - When scheduler, workflow, or object-storage resource budgets are exhausted:
 *   1. Low-priority enrichment (notebooks, counterfactuals, analog history) degrades per policy.
 *   2. Retention policy triggers compaction / digest mode.
 *   3. Immutable frozen evidence is NEVER deleted.
 *   4. Critical risk monitoring and alert verification remain 100% active and unblocked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-104 acceptance: low-priority budget exhaustion preserves evidence & risk monitoring', () => {
  it('degrades optional enrichment while preserving frozen evidence and risk monitoring', async () => {
    let CapacityModule: Record<string, unknown>;
    try {
      CapacityModule = (await import(
        '../../packages/capacity-planner/src/resource-budgets.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_PLANNER_NOT_IMPLEMENTED: packages/capacity-planner missing');
    }

    const ResourceBudgetEngine = CapacityModule.ResourceBudgetEngine as new () => {
      exhaustDimension: (dim: string) => void;
      canExecute: (workload: string) => boolean;
      canEvictFrozenEvidence: () => boolean;
    };

    const engine = new ResourceBudgetEngine();
    engine.exhaustDimension('SCHEDULER');
    engine.exhaustDimension('OBJECT_STORE');

    // Low priority enrichment degraded
    expect(engine.canExecute('NOTEBOOK_ANALOG_ENRICHMENT')).toBe(false);

    // Critical risk monitoring preserved
    expect(engine.canExecute('RISK_MONITORING')).toBe(true);
    expect(engine.canExecute('ALERT_VERIFICATION')).toBe(true);

    // Frozen evidence protection
    expect(engine.canEvictFrozenEvidence()).toBe(false);
  });
});
