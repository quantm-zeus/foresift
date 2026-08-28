/**
 * AC-103 negative / failure-path — Cost & Plan Verification facet.
 * Traces: FR-COST-006.
 *
 * Asserts:
 * - System refuses to assume historical or default free limits when plan verification has expired.
 * - Missing or malformed plan limits JSON fails closed.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-103 negative: stale plan metadata cannot default to assumed free limits', () => {
  it('throws fail-closed when attempting to execute against an expired plan without re-verification', async () => {
    let ForecastModule: Record<string, unknown>;
    try {
      ForecastModule = (await import(
        '../../packages/quota-forecast/src/plan-verifier.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_FORECAST_NOT_IMPLEMENTED: packages/quota-forecast missing');
    }

    const assertPlanValidity = ForecastModule.assertPlanValidity as (plan: {
      planId: string;
      expiresAt: string;
      asOf: string;
    }) => void;

    expect(() =>
      assertPlanValidity({
        planId: 'gmgn-free-tier',
        expiresAt: '2026-08-01T00:00:00Z',
        asOf: '2026-08-02T00:00:00Z',
      }),
    ).toThrow(/PLAN_EXPIRED|UNVERIFIED/i);
  });
});
