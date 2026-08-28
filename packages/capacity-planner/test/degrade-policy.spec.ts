/**
 * Degrade policy unit tests (FR-COST-004, AC-101, AC-228).
 * Asserts broad-scan degrade strategy:
 * 1. Reduce scan breadth (fewer candidates)
 * 2. Reduce scan depth (narrower projection / shallower history)
 * 3. Never consume protected reserves for broad-scan workloads.
 * Workload degradation ordering: social -> analog -> wallet-history -> exploration -> broad-scan depth.
 */
import { describe, expect, it } from 'bun:test';
import {
  evaluateDegradeAction,
  getDegradationPriorityOrder,
  type DegradePolicyContext,
} from '../src/degrade-policy.ts';

describe('degrade-policy', () => {
  it('preserves exact AC-228 degradation priority order', () => {
    const order = getDegradationPriorityOrder();
    expect(order).toEqual([
      'social',
      'analog',
      'wallet_history',
      'exploration',
      'broad_scan_depth',
    ]);
  });

  it('selects DOWNGRADE_DEPTH before QUOTA_EXHAUSTED for broad-scan workloads under pressure', () => {
    const context: DegradePolicyContext = {
      workloadClass: 'BACKFILL_LOW',
      generalPoolRemaining: 0,
      hasNarrowedProjectionAvailable: true,
      alreadyDowngraded: false,
    };

    const action = evaluateDegradeAction(context);
    expect(action).toBe('DOWNGRADE_DEPTH');
  });

  it('selects RETURN_CACHE or QUOTA_EXHAUSTED when projection is already downgraded', () => {
    const context: DegradePolicyContext = {
      workloadClass: 'BACKFILL_LOW',
      generalPoolRemaining: 0,
      hasNarrowedProjectionAvailable: true,
      alreadyDowngraded: true,
    };

    const action = evaluateDegradeAction(context);
    expect(['RETURN_CACHE', 'QUOTA_EXHAUSTED', 'SKIP_LOW_PRIORITY']).toContain(action);
  });

  it('never routes broad-scan exhaustion to protected reserves', () => {
    const context: DegradePolicyContext = {
      workloadClass: 'BACKFILL_LOW',
      generalPoolRemaining: 0,
      hasNarrowedProjectionAvailable: false,
      alreadyDowngraded: true,
    };

    const action = evaluateDegradeAction(context);
    expect(action).not.toBe('CONSUME_RESERVE');
  });
});
