/**
 * AC-103 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-006.
 * Tests closure isolation and cross-provider expiration independence.
 */
import { describe, expect, it } from 'bun:test';
import { verifyPlanFreshness } from '../../packages/quota-forecast/src/plan-verifier.ts';
import {
  EXPIRED_FORECAST_SNAPSHOT,
  VERIFIED_FORECAST_SNAPSHOT,
} from '../fixtures/cost/plans.ts';

describe('AC-103 negative: stale plan closures remain unverified; provider expiry isolated', () => {
  it('stale plan snapshot captured in a closure refuses even if queried repeatedly', () => {
    const check1 = verifyPlanFreshness(EXPIRED_FORECAST_SNAPSHOT, '2026-08-01T00:00:00Z');
    const check2 = verifyPlanFreshness(EXPIRED_FORECAST_SNAPSHOT, '2026-08-02T00:00:00Z');

    expect(check1.verified).toBe(false);
    expect(check2.verified).toBe(false);
  });

  it('expiration of one provider plan does not contaminate verified status of another provider', () => {
    const expiredProvider = verifyPlanFreshness(EXPIRED_FORECAST_SNAPSHOT, '2026-08-01T00:00:00Z');
    const verifiedProvider = verifyPlanFreshness(VERIFIED_FORECAST_SNAPSHOT, '2026-08-01T00:00:00Z');

    expect(expiredProvider.verified).toBe(false);
    expect(verifiedProvider.verified).toBe(true);
  });
});
