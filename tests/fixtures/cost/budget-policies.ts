/**
 * Budget policies fixtures (FR-COST-011, AC-100, AC-105, plan ADR-1).
 * Provides six-dimension policy fixtures, provider modes (STRICT_FREE/FREE_FIRST/PAID_ALLOWED),
 * and zero-overclaim composition vectors.
 */
import type { BudgetDimension, ProviderMode } from '@foresift/domain';

export interface BudgetPolicyFixture {
  policyId: string;
  dimension: BudgetDimension;
  providerMode: ProviderMode | null;
  capLimit: number;
  currencyOrUnit: string;
  version: string;
  active: boolean;
  activatedAt: string;
  supersededBy: string | null;
}

export const SIX_DIMENSION_BUDGET_POLICIES: BudgetPolicyFixture[] = [
  {
    policyId: 'pol_data_strict_free_1',
    dimension: 'DATA_PROVIDER',
    providerMode: 'STRICT_FREE',
    capLimit: 0,
    currencyOrUnit: 'USD',
    version: '1.0.0',
    active: true,
    activatedAt: '2026-09-01T00:00:00Z',
    supersededBy: null,
  },
  {
    policyId: 'pol_model_byok_1',
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
    policyId: 'pol_compute_1',
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
    policyId: 'pol_db_storage_1',
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
    policyId: 'pol_obj_storage_1',
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
    policyId: 'pol_notification_1',
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

export const DATA_PROVIDER_MODE_FIXTURES = {
  STRICT_FREE: {
    policyId: 'pol_dp_strict_free',
    dimension: 'DATA_PROVIDER' as const,
    providerMode: 'STRICT_FREE' as const,
    capLimit: 0,
    currencyOrUnit: 'USD',
    version: '1.0.0',
    active: true,
    activatedAt: '2026-09-01T00:00:00Z',
    supersededBy: null,
  },
  FREE_FIRST: {
    policyId: 'pol_dp_free_first',
    dimension: 'DATA_PROVIDER' as const,
    providerMode: 'FREE_FIRST' as const,
    capLimit: 250,
    currencyOrUnit: 'USD',
    version: '1.0.0',
    active: true,
    activatedAt: '2026-09-01T00:00:00Z',
    supersededBy: null,
  },
  PAID_ALLOWED: {
    policyId: 'pol_dp_paid_allowed',
    dimension: 'DATA_PROVIDER' as const,
    providerMode: 'PAID_ALLOWED' as const,
    capLimit: 1000,
    currencyOrUnit: 'USD',
    version: '1.0.0',
    active: true,
    activatedAt: '2026-09-01T00:00:00Z',
    supersededBy: null,
  },
};

export const ZERO_OVERCLAIM_COMPOSITION_FIXTURES = {
  STRICT_FREE_WITH_MODEL_SPEND: {
    PAID_DATA_SPEND: 0,
    FREE_QUOTA_CONSUMPTION: 250,
    MODEL_SPEND: 10.0,
    INFRASTRUCTURE_SPEND: 2.0,
    STORAGE_EGRESS_SPEND: 0.5,
    NOTIFICATION_SPEND: 0.1,
    HUMAN_REVIEW_EFFORT: 0,
  },
  ALL_ZERO_SPEND: {
    PAID_DATA_SPEND: 0,
    FREE_QUOTA_CONSUMPTION: 0,
    MODEL_SPEND: 0,
    INFRASTRUCTURE_SPEND: 0,
    STORAGE_EGRESS_SPEND: 0,
    NOTIFICATION_SPEND: 0,
    HUMAN_REVIEW_EFFORT: 0,
  },
};
