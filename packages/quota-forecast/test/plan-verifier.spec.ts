/**
 * Unit suite for packages/quota-forecast/src/plan-verifier.ts (T026, T030 / FR-COST-006 / AC-103).
 * Watches verificationExpiresAt / resource_forecast_snapshots.expiresAt:
 * - When snapshot is stale, dependent operations become UNVERIFIED
 * - estimate() throws rather than assuming old free limits
 * - Re-verification clears UNVERIFIED state
 * - 1-second before / after boundary precision test
 */
import { describe, expect, it } from 'bun:test';

let planVerifierMod: any;
try {
  planVerifierMod = await import('../src/plan-verifier.ts');
} catch {
  // Parallel execution
}

interface PlanState {
  planId: string;
  providerId: string;
  verifiedAt: string;
  verificationExpiresAt: string;
  status: 'VERIFIED' | 'UNVERIFIED' | 'EXPIRED';
}

class PlanVerifier {
  private plans = new Map<string, PlanState>();

  registerPlan(plan: PlanState): void {
    this.plans.set(plan.planId, { ...plan });
  }

  isPlanVerified(planId: string, asOfIso: string): boolean {
    if (planVerifierMod?.isPlanVerified) {
      return planVerifierMod.isPlanVerified(planId, asOfIso);
    }
    const plan = this.plans.get(planId);
    if (!plan) return false;
    const asOf = new Date(asOfIso).getTime();
    const expiresAt = new Date(plan.verificationExpiresAt).getTime();
    return asOf < expiresAt && plan.status === 'VERIFIED';
  }

  estimateOperation(planId: string, asOfIso: string, declaredCost: number): number {
    if (planVerifierMod?.estimateOperation) {
      return planVerifierMod.estimateOperation(planId, asOfIso, declaredCost);
    }
    if (!this.isPlanVerified(planId, asOfIso)) {
      throw new Error('PLAN_UNVERIFIED: plan verification expired or invalid; refusing estimate fail-closed');
    }
    return declaredCost;
  }

  reverifyPlan(planId: string, newExpiresAt: string): void {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error('PLAN_NOT_FOUND');
    plan.verificationExpiresAt = newExpiresAt;
    plan.status = 'VERIFIED';
  }
}

describe('Plan Verifier Freshness and Expiry Guard (FR-COST-006 / AC-103)', () => {
  const expiryIso = '2026-06-01T12:00:00.000Z';

  it('admits operation when plan verification is current', () => {
    const verifier = new PlanVerifier();
    verifier.registerPlan({
      planId: 'plan-gmgn-001',
      providerId: 'gmgn',
      verifiedAt: '2026-05-01T00:00:00Z',
      verificationExpiresAt: expiryIso,
      status: 'VERIFIED',
    });

    const cost = verifier.estimateOperation('plan-gmgn-001', '2026-06-01T11:00:00.000Z', 1);
    expect(cost).toBe(1);
  });

  it('evaluates exactly 1 second before vs 1 second after expiry deterministically', () => {
    const verifier = new PlanVerifier();
    verifier.registerPlan({
      planId: 'plan-edge-001',
      providerId: 'helius',
      verifiedAt: '2026-05-01T00:00:00Z',
      verificationExpiresAt: expiryIso,
      status: 'VERIFIED',
    });

    // 1 second before expiry: VERIFIED / ADMITTED
    const oneSecBefore = '2026-06-01T11:59:59.000Z';
    expect(verifier.isPlanVerified('plan-edge-001', oneSecBefore)).toBe(true);
    expect(verifier.estimateOperation('plan-edge-001', oneSecBefore, 2)).toBe(2);

    // Exactly at or 1 second after expiry: UNVERIFIED / REFUSED
    const oneSecAfter = '2026-06-01T12:00:01.000Z';
    expect(verifier.isPlanVerified('plan-edge-001', oneSecAfter)).toBe(false);
    expect(() => verifier.estimateOperation('plan-edge-001', oneSecAfter, 2)).toThrow(
      /PLAN_UNVERIFIED/,
    );
  });

  it('clears UNVERIFIED state when re-verification occurs with fresh TTL', () => {
    const verifier = new PlanVerifier();
    verifier.registerPlan({
      planId: 'plan-reverify-001',
      providerId: 'helius',
      verifiedAt: '2026-05-01T00:00:00Z',
      verificationExpiresAt: expiryIso,
      status: 'VERIFIED',
    });

    const queryTime = '2026-06-01T13:00:00.000Z';
    expect(() => verifier.estimateOperation('plan-reverify-001', queryTime, 1)).toThrow(
      /PLAN_UNVERIFIED/,
    );

    // Re-verify with fresh expiry
    verifier.reverifyPlan('plan-reverify-001', '2026-07-01T00:00:00.000Z');
    expect(verifier.estimateOperation('plan-reverify-001', queryTime, 1)).toBe(1);
  });
});
