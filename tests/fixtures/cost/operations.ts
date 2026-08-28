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
  allowedInStrictFree: false,
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
