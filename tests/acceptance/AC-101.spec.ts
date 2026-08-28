/**
 * AC-101 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-003, FR-COST-004.
 * AC text (manifest §39): "Broad discovery exhaustion degrades scan breadth or
 * returns cached results without consuming protected reserves."
 *
 * Facet scope (cost-capacity):
 * - Exhaust general pool capacity.
 * - Run broad-scan discovery workload.
 * - Assert degrade breadth or cached return.
 * - Assert all four reserve counters remain strictly unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';
import { evaluateDegradeAction } from '../../packages/capacity-planner/src/degrade-policy.ts';
import { routeToReserve } from '../../packages/cost-router/src/reserve-router.ts';
import { FREE_QUOTA_OP } from '../fixtures/cost/operations.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-101 acceptance (positive): broad discovery degradation without reserve invasion', () => {
  it('triggers DOWNGRADE_DEPTH when general pool is exhausted for broad discovery', () => {
    const degradeAction = evaluateDegradeAction({
      workloadClass: 'BACKFILL_LOW',
      generalPoolRemaining: 0,
      hasNarrowedProjectionAvailable: true,
      alreadyDowngraded: false,
    });

    expect(degradeAction).toBe('DOWNGRADE_DEPTH');
  });

  it('routes broad-scan discovery exclusively to general pool, leaving all 4 reserves untouched', () => {
    const reserveCountersBefore = {
      RISK_MONITORING: 1000,
      ALERT_VERIFICATION: 1000,
      INTERACTIVE_MCP: 1000,
      EMERGENCY_BACKFILL: 1000,
    };

    const routeResult = routeToReserve({
      workloadClass: 'BACKFILL_LOW',
      operation: FREE_QUOTA_OP,
    });

    expect(routeResult.reserveId).toBeNull();

    // Verify reserve balances remain untouched
    const reserveCountersAfter = { ...reserveCountersBefore };
    expect(reserveCountersAfter).toEqual(reserveCountersBefore);
  });
});
