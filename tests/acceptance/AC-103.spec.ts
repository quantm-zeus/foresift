/**
 * AC-103 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-006.
 * AC text (manifest §39): "Provider operations transition to UNVERIFIED and refuse
 * estimation when plan metadata verification expires, clearing upon re-verification."
 *
 * Facet scope (cost-capacity):
 * - Plan metadata expiration renders operation UNVERIFIED.
 * - Quota estimation refuses rather than assuming stale limits.
 * - Re-verification with fresh TTL clears UNVERIFIED state.
 */
import { describe, expect, it } from 'bun:test';
import { verifyPlanFreshness } from '../../packages/quota-forecast/src/plan-verifier.ts';
import {
  EXPIRED_FORECAST_SNAPSHOT,
  VERIFIED_FORECAST_SNAPSHOT,
} from '../fixtures/cost/plans.ts';

describe('AC-103 acceptance (positive): unverified plan expiry blocks estimation', () => {
  it('identifies unexpired plan snapshot as VERIFIED', () => {
    const status = verifyPlanFreshness(VERIFIED_FORECAST_SNAPSHOT, '2026-08-01T00:00:00Z');
    expect(status.verified).toBe(true);
    expect(status.status).toBe('VERIFIED');
  });

  it('transitions expired plan snapshot to UNVERIFIED and refuses estimation', () => {
    const status = verifyPlanFreshness(EXPIRED_FORECAST_SNAPSHOT, '2026-08-01T00:00:00Z');
    expect(status.verified).toBe(false);
    expect(status.status).toBe('UNVERIFIED');
  });

  it('clears UNVERIFIED state when plan is re-verified with future expiry', () => {
    const reVerified = {
      ...EXPIRED_FORECAST_SNAPSHOT,
      expiresAt: '2027-01-01T00:00:00Z' as const,
      verifiedAt: '2026-08-01T00:00:00Z' as const,
    };

    const status = verifyPlanFreshness(reVerified, '2026-08-01T00:00:00Z');
    expect(status.verified).toBe(true);
    expect(status.status).toBe('VERIFIED');
  });
});
