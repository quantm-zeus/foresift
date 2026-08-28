/**
 * Shared cost, quota, and capacity fixture definitions (FR-COST-001..010).
 * Exposes provider operation snapshots, batch inputs, forecast plans,
 * paid policies, and resource budgets.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

export interface ProviderOperationSnapshot {
  providerId: string;
  operationId: string;
  version: string;
  costClass: 'FREE_UNMETERED' | 'FREE_QUOTA' | 'PAID_EXPLICIT' | 'UNKNOWN_COST' | 'DISABLED';
  quotaUnitCost: number;
  resetPolicyId: string;
  batchCapability: {
    maxBatchSize: number;
    safeMaxUtilization: number;
    keyFields: string[];
  } | null;
  minimumCandidateStage: string | null;
  protectedReserveEligible: boolean;
  allowedInStrictFree: boolean;
  paidFallbackAllowed: boolean;
  planId: string;
  verificationExpiresAt: string;
}

export interface BatchInputsFixture {
  compatibleBatches: Array<{
    batchId: string;
    providerId: string;
    operationId: string;
    maxBatchSize: number;
    items: Array<Record<string, unknown>>;
    expectedUtilization: number;
    expectedReservationCount: number;
  }>;
  incompatibleBatches: Array<{
    batchId: string;
    reason: string;
    providerId?: string;
    operationId?: string;
    maxBatchSize?: number;
    items: Array<Record<string, unknown>>;
    expectedReservationCount: number;
  }>;
}

export interface ForecastPlansFixture {
  verifiedPlans: Array<{
    planId: string;
    providerId: string;
    planLimits: Record<string, number>;
    verifiedAt: string;
    verificationExpiresAt: string;
    status: string;
  }>;
  observedUsageSamples: Array<{
    providerId: string;
    windowStart: string;
    windowEnd: string;
    creditsUsed: number;
    forecastEstimated: number;
    toleranceThreshold: number;
    withinTolerance: boolean;
    incidentRaised?: boolean;
  }>;
  capacityReplay30Days: {
    expectedLoad: Record<string, number>;
    stressLoad: Record<string, number>;
    verifiedCeilings: Record<string, number>;
  };
}

export interface PaidPoliciesFixture {
  policies: Array<{
    policyId: string;
    providerId: string;
    approvedBudgetUsd: number;
    approver: string;
    createdAt: string;
    activatedAt: string | null;
    expiresAt: string;
    reAuthDueAt: string;
    supersededBy: string | null;
    status: 'INACTIVE' | 'ACTIVE' | 'EXPIRED' | 'SUPERSEDED';
  }>;
}

export interface ResourceBudgetsFixture {
  budgets: Array<{
    dimension: string;
    cap: number;
    used: number;
    forecastUsed: number;
    degradeBehavior: string;
  }>;
}

export function loadProviderOperationSnapshots(): ProviderOperationSnapshot[] {
  const content = readFileSync(join(DIR, 'provider-operation-snapshots.json'), 'utf8');
  return (JSON.parse(content) as { operations: ProviderOperationSnapshot[] }).operations;
}

export function loadBatchInputs(): BatchInputsFixture {
  const content = readFileSync(join(DIR, 'batch-inputs.json'), 'utf8');
  return JSON.parse(content) as BatchInputsFixture;
}

export function loadForecastPlans(): ForecastPlansFixture {
  const content = readFileSync(join(DIR, 'forecast-plans.json'), 'utf8');
  return JSON.parse(content) as ForecastPlansFixture;
}

export function loadPaidPolicies(): PaidPoliciesFixture {
  const content = readFileSync(join(DIR, 'paid-policies.json'), 'utf8');
  return JSON.parse(content) as PaidPoliciesFixture;
}

export function loadResourceBudgets(): ResourceBudgetsFixture {
  const content = readFileSync(join(DIR, 'resource-budgets.json'), 'utf8');
  return JSON.parse(content) as ResourceBudgetsFixture;
}
