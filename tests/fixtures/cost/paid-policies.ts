/**
 * Paid provider policy fixtures and BYOK model budget fixtures (FR-COST-008, FR-COST-010, AC-105).
 */
import type { UtcTimestamp } from '@foresift/domain';

export interface PaidProviderPolicyFixture {
  readonly policyId: string;
  readonly providerId: string;
  readonly budgetUnits: number;
  readonly budgetCurrencyOrModel: string;
  readonly approvedBy: string;
  readonly approvedAt: UtcTimestamp;
  readonly activatedAt: UtcTimestamp;
  readonly reAuthDueAt: UtcTimestamp;
  readonly active: boolean;
  readonly supersededBy: string | null;
}

export interface ResourceBudgetFixture {
  readonly kind: string;
  readonly capLimit: number;
  readonly used: number;
  readonly forecastUsed: number;
  readonly degradeBehavior: string;
}

export const ACTIVE_PAID_POLICY: PaidProviderPolicyFixture = {
  policyId: 'pol-paid-active-001',
  providerId: 'prov_paid_market',
  budgetUnits: 50_000,
  budgetCurrencyOrModel: 'USD_CENTS',
  approvedBy: 'compliance_officer_alice',
  approvedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  activatedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  reAuthDueAt: '2027-01-01T00:00:00Z' as UtcTimestamp,
  active: true,
  supersededBy: null,
};

export const UNACTIVATED_PAID_POLICY: PaidProviderPolicyFixture = {
  policyId: 'pol-paid-draft-002',
  providerId: 'prov_paid_market_2',
  budgetUnits: 10_000,
  budgetCurrencyOrModel: 'USD_CENTS',
  approvedBy: 'compliance_officer_bob',
  approvedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  activatedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  reAuthDueAt: '2027-01-01T00:00:00Z' as UtcTimestamp,
  active: false,
  supersededBy: null,
};

export const EXPIRED_REAUTH_PAID_POLICY: PaidProviderPolicyFixture = {
  policyId: 'pol-paid-expired-003',
  providerId: 'prov_paid_market_3',
  budgetUnits: 20_000,
  budgetCurrencyOrModel: 'USD_CENTS',
  approvedBy: 'compliance_officer_alice',
  approvedAt: '2025-01-01T00:00:00Z' as UtcTimestamp,
  activatedAt: '2025-01-01T00:00:00Z' as UtcTimestamp,
  reAuthDueAt: '2026-01-01T00:00:00Z' as UtcTimestamp, // Expired!
  active: true,
  supersededBy: null,
};

export const SUPERSEDED_PAID_POLICY: PaidProviderPolicyFixture = {
  policyId: 'pol-paid-superseded-000',
  providerId: 'prov_paid_market',
  budgetUnits: 25_000,
  budgetCurrencyOrModel: 'USD_CENTS',
  approvedBy: 'compliance_officer_alice',
  approvedAt: '2026-06-01T00:00:00Z' as UtcTimestamp,
  activatedAt: '2026-06-01T00:00:00Z' as UtcTimestamp,
  reAuthDueAt: '2026-12-01T00:00:00Z' as UtcTimestamp,
  active: false,
  supersededBy: 'pol-paid-active-001',
};

export const BYOK_MODEL_BUDGET_FIXTURE: ResourceBudgetFixture = {
  kind: 'MODEL_TOKENS_BYOK',
  capLimit: 2_000_000,
  used: 150_000,
  forecastUsed: 500_000,
  degradeBehavior: 'DOWNGRADE_DEPTH',
};

export const SIX_RESOURCE_BUDGETS_FIXTURES: readonly ResourceBudgetFixture[] = [
  {
    kind: 'SCHEDULER_SLOTS',
    capLimit: 100,
    used: 25,
    forecastUsed: 50,
    degradeBehavior: 'SKIP_LOW_PRIORITY',
  },
  {
    kind: 'WORKFLOW_STEPS',
    capLimit: 50_000,
    used: 10_000,
    forecastUsed: 25_000,
    degradeBehavior: 'SKIP_LOW_PRIORITY',
  },
  {
    kind: 'DATABASE_BYTES',
    capLimit: 10_000_000_000,
    used: 2_000_000_000,
    forecastUsed: 5_000_000_000,
    degradeBehavior: 'DOWNGRADE_DEPTH',
  },
  {
    kind: 'OBJECT_STORE_BYTES',
    capLimit: 50_000_000_000,
    used: 5_000_000_000,
    forecastUsed: 15_000_000_000,
    degradeBehavior: 'DOWNGRADE_DEPTH',
  },
  {
    kind: 'NOTIFICATION_RATE',
    capLimit: 1_000,
    used: 100,
    forecastUsed: 300,
    degradeBehavior: 'SKIP_LOW_PRIORITY',
  },
  BYOK_MODEL_BUDGET_FIXTURE,
];
