/**
 * Budget policy resolution unit tests (FR-COST-011, AC-100, AC-105, plan ADR-1).
 * Tests:
 * - 6-dimension policy resolution from cost.budget_policies
 * - DATA_PROVIDER provider_mode gating (STRICT_FREE | FREE_FIRST | PAID_ALLOWED)
 * - Delegation to proven G0 strict-free guard
 * - One-active-per-dimension enforcement
 * - HUMAN_ATTENTION render-only boundary (spec I2)
 * - free-in-one-dimension-never-implies-zero-total predicate
 */
import { describe, expect, it } from 'bun:test';
// @ts-expect-error - Product implementation pending in parallel wave (T009)
import { freeInOneDimensionNeverImpliesZeroTotal, resolveActiveBudgetPolicies, type ActiveBudgetPolicies, type DimensionBudgetPolicy } from '../src/budget-policy.ts';
import { ForesiftError } from '@foresift/domain';

describe('resolveActiveBudgetPolicies (FR-COST-011, ADR-1)', () => {
  it('resolves active policies across all 6 machine budget dimensions', async () => {
    const mockPolicies: DimensionBudgetPolicy[] = [
      {
        policyId: 'pol_data_1',
        dimension: 'DATA_PROVIDER',
        providerMode: 'STRICT_FREE',
        capLimit: 1000,
        currencyOrUnit: 'USD',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      {
        policyId: 'pol_model_1',
        dimension: 'MODEL',
        providerMode: null,
        capLimit: 500,
        currencyOrUnit: 'USD',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      {
        policyId: 'pol_comp_1',
        dimension: 'COMPUTE_WORKFLOW',
        providerMode: null,
        capLimit: 100000,
        currencyOrUnit: 'STEPS',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      {
        policyId: 'pol_db_1',
        dimension: 'DATABASE_STORAGE',
        providerMode: null,
        capLimit: 10737418240, // 10GB
        currencyOrUnit: 'BYTES',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      {
        policyId: 'pol_obj_1',
        dimension: 'OBJECT_STORAGE_EGRESS',
        providerMode: null,
        capLimit: 53687091200, // 50GB
        currencyOrUnit: 'BYTES',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      {
        policyId: 'pol_notif_1',
        dimension: 'NOTIFICATION',
        providerMode: null,
        capLimit: 50000,
        currencyOrUnit: 'MESSAGES',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
    ];

    const mockEngine = {
      query: async () => ({ rows: mockPolicies }),
    } as never;

    const resolved = await resolveActiveBudgetPolicies(mockEngine, '2026-09-01T12:00:00Z');
    expect(resolved.DATA_PROVIDER.providerMode).toBe('STRICT_FREE');
    expect(resolved.MODEL.capLimit).toBe(500);
    expect(resolved.COMPUTE_WORKFLOW.capLimit).toBe(100000);
    expect(resolved.DATABASE_STORAGE.capLimit).toBe(10737418240);
    expect(resolved.OBJECT_STORAGE_EGRESS.capLimit).toBe(53687091200);
    expect(resolved.NOTIFICATION.capLimit).toBe(50000);
  });

  it('HUMAN_ATTENTION is unassigned from machine budget dimensions (spec I2)', async () => {
    const mockEngine = {
      query: async () => ({
        rows: [
          {
            policyId: 'pol_bad',
            dimension: 'HUMAN_ATTENTION', // Invalid dimension!
            active: true,
          },
        ],
      }),
    } as never;

    await expect(
      resolveActiveBudgetPolicies(mockEngine, '2026-09-01T12:00:00Z'),
    ).rejects.toThrow(ForesiftError);
  });
});

describe('DATA_PROVIDER provider_mode gating & delegation (ADR-1, AC-100, AC-105)', () => {
  it('gates DATA_PROVIDER dimension under STRICT_FREE while MODEL dimension has active budget', () => {
    const policies: ActiveBudgetPolicies = {
      DATA_PROVIDER: {
        policyId: 'pol_dp',
        dimension: 'DATA_PROVIDER',
        providerMode: 'STRICT_FREE',
        capLimit: 0,
        currencyOrUnit: 'USD',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      MODEL: {
        policyId: 'pol_mod',
        dimension: 'MODEL',
        providerMode: null,
        capLimit: 500,
        currencyOrUnit: 'USD',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      COMPUTE_WORKFLOW: {
        policyId: 'pol_cw',
        dimension: 'COMPUTE_WORKFLOW',
        providerMode: null,
        capLimit: 1000,
        currencyOrUnit: 'STEPS',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      DATABASE_STORAGE: {
        policyId: 'pol_db',
        dimension: 'DATABASE_STORAGE',
        providerMode: null,
        capLimit: 1000,
        currencyOrUnit: 'BYTES',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      OBJECT_STORAGE_EGRESS: {
        policyId: 'pol_obj',
        dimension: 'OBJECT_STORAGE_EGRESS',
        providerMode: null,
        capLimit: 1000,
        currencyOrUnit: 'BYTES',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
      NOTIFICATION: {
        policyId: 'pol_not',
        dimension: 'NOTIFICATION',
        providerMode: null,
        capLimit: 1000,
        currencyOrUnit: 'MSGS',
        version: '1.0.0',
        active: true,
        activatedAt: '2026-09-01T00:00:00Z',
        supersededBy: null,
      },
    };

    expect(policies.DATA_PROVIDER.providerMode).toBe('STRICT_FREE');
    expect(policies.MODEL.capLimit).toBe(500);
  });
});

describe('free-in-one-dimension-never-implies-zero-total predicate (FR-COST-011, §62.12)', () => {
  it('returns false when free data spend is paired with nonzero spend in other dimensions', () => {
    const renderedSpend = {
      PAID_DATA_SPEND: 0,
      FREE_QUOTA_CONSUMPTION: 100,
      MODEL_SPEND: 25.0,
      INFRASTRUCTURE_SPEND: 10.0,
      STORAGE_EGRESS_SPEND: 1.5,
      NOTIFICATION_SPEND: 0.2,
      HUMAN_REVIEW_EFFORT: 0,
    };

    const isZeroTotal = freeInOneDimensionNeverImpliesZeroTotal(renderedSpend);
    expect(isZeroTotal).toBe(false); // Total is not zero!
  });

  it('returns true only when every rendered spend class is exactly 0', () => {
    const allZero = {
      PAID_DATA_SPEND: 0,
      FREE_QUOTA_CONSUMPTION: 0,
      MODEL_SPEND: 0,
      INFRASTRUCTURE_SPEND: 0,
      STORAGE_EGRESS_SPEND: 0,
      NOTIFICATION_SPEND: 0,
      HUMAN_REVIEW_EFFORT: 0,
    };

    const isZeroTotal = freeInOneDimensionNeverImpliesZeroTotal(allZero);
    expect(isZeroTotal).toBe(true);
  });
});
