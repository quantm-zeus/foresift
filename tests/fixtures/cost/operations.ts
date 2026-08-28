/**
 * Provider operation snapshots and cost declaration fixtures (FR-COST-001, FR-COST-002).
 * Covers free-unmetered, free-quota, paid-explicit, unknown-cost, auto-upgrade, and unverified operations.
 */
import type { UtcTimestamp } from '@foresift/domain';

export interface BatchCapabilityFixture {
  readonly maxBatchSize: number;
  readonly safeMaxUtilization: number;
  readonly keyFields: readonly string[];
  readonly autoUpgrade?: boolean;
}

export interface OperationCostFixture {
  readonly providerId: string;
  readonly operationId: string;
  readonly version: string;
  readonly costClass: string;
  readonly quotaModelId: string;
  readonly estimatedQuotaUnits: number;
  readonly quotaResetPolicyId: string;
  readonly batchCapability: BatchCapabilityFixture | null;
  readonly minimumCandidateStage: string;
  readonly protectedReserveEligible: boolean;
  readonly allowedInStrictFree: boolean;
  readonly verificationExpiresAt: UtcTimestamp;
}

export const T_FUTURE = '2027-01-01T00:00:00Z' as UtcTimestamp;
export const T_EXPIRED = '2026-01-01T00:00:00Z' as UtcTimestamp;

export const FREE_UNMETERED_OP: OperationCostFixture = {
  providerId: 'prov_helius',
  operationId: 'get_slot_leader',
  version: '1.0.0',
  costClass: 'FREE_UNMETERED',
  quotaModelId: 'REQUESTS_PER_PERIOD',
  estimatedQuotaUnits: 0,
  quotaResetPolicyId: 'DAILY_MIDNIGHT_UTC',
  batchCapability: null,
  minimumCandidateStage: 'DISCOVERED',
  protectedReserveEligible: true,
  allowedInStrictFree: true,
  verificationExpiresAt: T_FUTURE,
};

export const FREE_QUOTA_OP: OperationCostFixture = {
  providerId: 'prov_gmgn',
  operationId: 'get_token_security',
  version: '1.0.0',
  costClass: 'FREE_QUOTA',
  quotaModelId: 'REQUESTS_PER_PERIOD',
  estimatedQuotaUnits: 1,
  quotaResetPolicyId: 'DAILY_MIDNIGHT_UTC',
  batchCapability: {
    maxBatchSize: 50,
    safeMaxUtilization: 0.8,
    keyFields: ['tokenAddress'],
  },
  minimumCandidateStage: 'DISCOVERED',
  protectedReserveEligible: true,
  allowedInStrictFree: true,
  verificationExpiresAt: T_FUTURE,
};

export const PAID_EXPLICIT_OP: OperationCostFixture = {
  providerId: 'prov_paid_market',
  operationId: 'get_orderbook_l3',
  version: '1.0.0',
  costClass: 'PAID_EXPLICIT',
  quotaModelId: 'REQUESTS_PER_PERIOD',
  estimatedQuotaUnits: 10,
  quotaResetPolicyId: 'DAILY_MIDNIGHT_UTC',
  batchCapability: null,
  minimumCandidateStage: 'RESEARCH',
  protectedReserveEligible: false,
  allowedInStrictFree: false,
  verificationExpiresAt: T_FUTURE,
};

export const UNKNOWN_COST_OP: OperationCostFixture = {
  providerId: 'prov_experimental',
  operationId: 'get_unpriced_signal',
  version: '1.0.0',
  costClass: 'UNKNOWN_COST',
  quotaModelId: 'REQUESTS_PER_PERIOD',
  estimatedQuotaUnits: 0,
  quotaResetPolicyId: 'NEVER',
  batchCapability: null,
  minimumCandidateStage: 'DISCOVERED',
  protectedReserveEligible: false,
  allowedInStrictFree: false,
  verificationExpiresAt: T_FUTURE,
};

export const AUTO_UPGRADE_OP: OperationCostFixture = {
  providerId: 'prov_cloud_aggregator',
  operationId: 'get_historical_trades',
  version: '1.0.0',
  costClass: 'FREE_QUOTA',
  quotaModelId: 'REQUESTS_PER_PERIOD',
  estimatedQuotaUnits: 5,
  quotaResetPolicyId: 'DAILY_MIDNIGHT_UTC',
  batchCapability: {
    maxBatchSize: 10,
    safeMaxUtilization: 0.8,
    keyFields: ['tokenAddress'],
    autoUpgrade: true,
  },
  minimumCandidateStage: 'DISCOVERED',
  protectedReserveEligible: false,
  allowedInStrictFree: true,
  verificationExpiresAt: T_FUTURE,
};

export const UNVERIFIED_EXPIRED_OP: OperationCostFixture = {
  providerId: 'prov_helius',
  operationId: 'get_raw_transaction',
  version: '1.0.0',
  costClass: 'FREE_QUOTA',
  quotaModelId: 'REQUESTS_PER_PERIOD',
  estimatedQuotaUnits: 2,
  quotaResetPolicyId: 'DAILY_MIDNIGHT_UTC',
  batchCapability: null,
  minimumCandidateStage: 'DISCOVERED',
  protectedReserveEligible: true,
  allowedInStrictFree: true,
  verificationExpiresAt: T_EXPIRED,
};

export const ALL_COST_OPERATION_FIXTURES: readonly OperationCostFixture[] = [
  FREE_UNMETERED_OP,
  FREE_QUOTA_OP,
  PAID_EXPLICIT_OP,
  UNKNOWN_COST_OP,
  AUTO_UPGRADE_OP,
  UNVERIFIED_EXPIRED_OP,
];

export async function seedCostOperationFixture(
  engine: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  fixture: OperationCostFixture = FREE_QUOTA_OP,
): Promise<void> {
  await engine.query(
    `INSERT INTO prov.prov_providers (provider_id, display_name, provider_group, disabled_by_default)
     VALUES ($1, $2, 'test-group', FALSE)
     ON CONFLICT (provider_id) DO NOTHING`,
    [fixture.providerId, fixture.providerId],
  );
  await engine.query(
    `INSERT INTO prov.prov_operations (
       provider_id, operation_id, version,
       capability_class, cost_class, supported_chains,
       input_schema_id, raw_output_schema_id, normalized_output_schema_id,
       quota_model_id, cache_policy_id, timeout_ms, retry_policy_id,
       declared_independence_group, license_policy_id,
       estimated_quota_units, quota_reset_policy_id,
       batch_capability, minimum_candidate_stage,
       protected_reserve_eligible, allowed_in_strict_free,
       verification_expires_at, current_state, health_status
     ) VALUES (
       $1, $2, $3,
       'READ_MARKET', $4, ARRAY['solana'],
       'in-schema', 'raw-schema', 'norm-schema',
       $5, 'cp', 1000, 'rp',
       'dig', 'lp',
       $6, $7,
       $8, $9,
       $10, $11,
       $12, 'ACTIVE', 'HEALTHY'
     ) ON CONFLICT (provider_id, operation_id, version) DO UPDATE SET
       cost_class = EXCLUDED.cost_class,
       quota_model_id = EXCLUDED.quota_model_id,
       estimated_quota_units = EXCLUDED.estimated_quota_units,
       quota_reset_policy_id = EXCLUDED.quota_reset_policy_id,
       batch_capability = EXCLUDED.batch_capability,
       minimum_candidate_stage = EXCLUDED.minimum_candidate_stage,
       protected_reserve_eligible = EXCLUDED.protected_reserve_eligible,
       allowed_in_strict_free = EXCLUDED.allowed_in_strict_free,
       verification_expires_at = EXCLUDED.verification_expires_at,
       current_state = 'ACTIVE'`,
    [
      fixture.providerId,
      fixture.operationId,
      fixture.version,
      fixture.costClass,
      fixture.quotaModelId,
      fixture.estimatedQuotaUnits,
      fixture.quotaResetPolicyId,
      fixture.batchCapability === null ? null : JSON.stringify(fixture.batchCapability),
      fixture.minimumCandidateStage,
      fixture.protectedReserveEligible,
      fixture.allowedInStrictFree,
      fixture.verificationExpiresAt,
    ],
  );
}

export async function seedCostQuotaBalance(
  engine: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  options: {
    providerId: string;
    quotaModelId?: string;
    periodWindowStart?: string;
    periodResetAt?: string;
    capLimit?: number;
    consumedReserved?: number;
    consumedCommitted?: number;
  },
): Promise<void> {
  const quotaModelId = options.quotaModelId ?? 'REQUESTS_PER_PERIOD';
  const periodWindowStart = options.periodWindowStart ?? '2026-08-01T00:00:00Z';
  const periodResetAt = options.periodResetAt ?? '2027-01-01T00:00:00Z';
  const capLimit = options.capLimit ?? 10000;
  const consumedReserved = options.consumedReserved ?? 0;
  const consumedCommitted = options.consumedCommitted ?? 0;

  await engine.query(
    `INSERT INTO cost.cost_quota_balances
       (provider_id, quota_model_id, period_window_start, period_reset_at, cap_limit, consumed_reserved, consumed_committed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (provider_id, quota_model_id, period_window_start) DO UPDATE SET
       cap_limit = EXCLUDED.cap_limit,
       consumed_reserved = EXCLUDED.consumed_reserved,
       consumed_committed = EXCLUDED.consumed_committed,
       period_reset_at = EXCLUDED.period_reset_at`,
    [
      options.providerId,
      quotaModelId,
      periodWindowStart,
      periodResetAt,
      capLimit,
      consumedReserved,
      consumedCommitted,
    ],
  );
}
