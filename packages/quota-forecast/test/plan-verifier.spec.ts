/**
 * Provider plan verification and TTL expiry units (FR-COST-006, AC-103).
 *
 * Asserts:
 * - Watches verificationExpiresAt / resource_forecast_snapshots.expiresAt.
 * - When metadata is stale, dependent operations transition to UNVERIFIED and estimate throws fail-closed rather than assuming old free limits.
 * - Re-verification clears UNVERIFIED status.
 * - 1-second before/after expiry is deterministically correct.
 */
import { describe, expect, it } from 'bun:test';

describe('plan-verifier freshness and TTL boundaries (FR-COST-006, AC-103)', () => {
  it('marks operation UNVERIFIED exactly 1 second after verification expiry', async () => {
    let VerifierModule: Record<string, unknown>;
    try {
      VerifierModule = (await import('../src/plan-verifier.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('PLAN_VERIFIER_NOT_IMPLEMENTED: src/plan-verifier.ts missing');
    }

    const checkPlanFreshness = VerifierModule.checkPlanFreshness as (
      plan: { expiresAt: string },
      asOf: string,
    ) => { isVerified: boolean; status: string };

    const expiresAt = '2026-08-01T12:00:00Z';

    // 1 second before -> VERIFIED
    const before = checkPlanFreshness({ expiresAt }, '2026-08-01T11:59:59Z');
    expect(before.isVerified).toBe(true);
    expect(before.status).toBe('VERIFIED');

    // Exactly at expiry -> EXPIRED / UNVERIFIED
    const atExpiry = checkPlanFreshness({ expiresAt }, '2026-08-01T12:00:00Z');
    expect(atExpiry.isVerified).toBe(false);

    // 1 second after -> UNVERIFIED
    const after = checkPlanFreshness({ expiresAt }, '2026-08-01T12:00:01Z');
    expect(after.isVerified).toBe(false);
    expect(after.status).toBe('UNVERIFIED');
  });

  it('unverified plan forces estimate/admission to throw fail-closed', async () => {
    let VerifierModule: Record<string, unknown>;
    try {
      VerifierModule = (await import('../src/plan-verifier.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('PLAN_VERIFIER_NOT_IMPLEMENTED: src/plan-verifier.ts missing');
    }

    const assertPlanVerified = VerifierModule.assertPlanVerified as (plan: {
      isVerified: boolean;
      status: string;
      planId: string;
    }) => void;

    expect(() =>
      assertPlanVerified({
        planId: 'stale-plan',
        isVerified: false,
        status: 'UNVERIFIED',
      }),
    ).toThrow(/UNVERIFIED|COST_BLOCKED/i);
  });

  it('re-verification with fresh TTL clears UNVERIFIED status', async () => {
    let VerifierModule: Record<string, unknown>;
    try {
      VerifierModule = (await import('../src/plan-verifier.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('PLAN_VERIFIER_NOT_IMPLEMENTED: src/plan-verifier.ts missing');
    }

    const reVerifyPlan = VerifierModule.reVerifyPlan as (
      planId: string,
      freshTtlSeconds: number,
      now: string,
    ) => { isVerified: boolean; status: string; newExpiresAt: string };

    const renewed = reVerifyPlan('stale-plan', 86400, '2026-08-01T12:00:00Z');
    expect(renewed.isVerified).toBe(true);
    expect(renewed.status).toBe('VERIFIED');
    expect(renewed.newExpiresAt).toBe('2026-08-02T12:00:00Z');
  });
});
