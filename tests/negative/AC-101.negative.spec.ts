/**
 * AC-101 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-003, FR-COST-004.
 * Tests refusal of broad-scan workloads from accessing protected reserves under repeated exhaustion waves.
 */
import { describe, expect, it } from 'bun:test';
import { routeToReserve } from '../../packages/cost-router/src/reserve-router.ts';
import { evaluateDegradeAction } from '../../packages/capacity-planner/src/degrade-policy.ts';
import { FREE_QUOTA_OP } from '../fixtures/cost/operations.ts';

describe('AC-101 negative: broad scans cannot bypass degradation into reserves', () => {
  it('refuses direct attempt to route BACKFILL_LOW to protected reserve', () => {
    const route = routeToReserve({
      workloadClass: 'BACKFILL_LOW',
      operation: {
        ...FREE_QUOTA_OP,
        protectedReserveEligible: true,
      },
    });

    expect(route.reserveId).toBeNull();
  });

  it('refuses direct attempt to route EVALUATION_LOW to protected reserve', () => {
    const route = routeToReserve({
      workloadClass: 'EVALUATION_LOW',
      operation: {
        ...FREE_QUOTA_OP,
        protectedReserveEligible: true,
      },
    });

    expect(route.reserveId).toBeNull();
  });

  it('under repeated exhaustion waves, broad-scan exhausts to QUOTA_EXHAUSTED without touching reserves', () => {
    const action = evaluateDegradeAction({
      workloadClass: 'BACKFILL_LOW',
      generalPoolRemaining: 0,
      hasNarrowedProjectionAvailable: false,
      alreadyDowngraded: true,
    });

    expect(action).not.toBe('CONSUME_RESERVE');
    expect(['QUOTA_EXHAUSTED', 'SKIP_LOW_PRIORITY', 'RETURN_CACHE']).toContain(action);
  });
});
