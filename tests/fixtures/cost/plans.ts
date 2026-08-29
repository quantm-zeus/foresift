/**
 * Verified plan limits, observed usage, and forecast snapshot fixtures (FR-COST-006, FR-COST-009, AC-227, AC-229).
 */
import type { UtcTimestamp } from '@foresift/domain';

export interface PlanLimitsFixture {
  readonly creditsPerMonth: number;
  readonly rateLimitPerSec: number;
  readonly maxStreamBytesPerDay: number;
  readonly maxModelTokensPerDay: number;
  readonly maxWorkflowStepsPerDay: number;
  readonly maxDbGrowthBytesPerMonth: number;
  readonly maxObjectStorageBytesPerMonth: number;
  readonly maxEgressBytesPerDay: number;
  readonly maxRetriesPerDay: number;
  readonly maxNotificationsPerDay: number;
  readonly protectedReserveFloorUnits: number;
}

export interface ObservedUsageFixture {
  readonly creditsUsed: number;
  readonly streamBytesUsed: number;
  readonly modelTokensUsed: number;
  readonly workflowStepsUsed: number;
  readonly dbGrowthBytesUsed: number;
  readonly objectStorageBytesUsed: number;
  readonly egressBytesUsed: number;
  readonly retriesUsed: number;
  readonly notificationsUsed: number;
  readonly reserveUnitsUsed: number;
}

export interface ForecastSnapshotFixture {
  readonly snapshotId: string;
  readonly planVersionId: string;
  readonly verifiedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly planLimits: PlanLimitsFixture;
  readonly observedUsage: ObservedUsageFixture;
  readonly tolerancePercent: number;
}

export const VALID_PLAN_LIMITS: PlanLimitsFixture = {
  creditsPerMonth: 100_000,
  rateLimitPerSec: 50,
  maxStreamBytesPerDay: 500_000_000,
  maxModelTokensPerDay: 1_000_000,
  maxWorkflowStepsPerDay: 50_000,
  maxDbGrowthBytesPerMonth: 10_000_000_000,
  maxObjectStorageBytesPerMonth: 50_000_000_000,
  maxEgressBytesPerDay: 100_000_000,
  maxRetriesPerDay: 5_000,
  maxNotificationsPerDay: 1_000,
  protectedReserveFloorUnits: 5_000,
};

export const BASELINE_OBSERVED_USAGE: ObservedUsageFixture = {
  creditsUsed: 25_000,
  streamBytesUsed: 120_000_000,
  modelTokensUsed: 250_000,
  workflowStepsUsed: 12_000,
  dbGrowthBytesUsed: 2_000_000_000,
  objectStorageBytesUsed: 10_000_000_000,
  egressBytesUsed: 20_000_000,
  retriesUsed: 500,
  notificationsUsed: 150,
  reserveUnitsUsed: 500,
};

export const TOLERANCE_BREACH_OBSERVED_USAGE: ObservedUsageFixture = {
  creditsUsed: 80_000, // Expected was ~30_000; exceeds 15% tolerance
  streamBytesUsed: 400_000_000,
  modelTokensUsed: 850_000,
  workflowStepsUsed: 45_000,
  dbGrowthBytesUsed: 8_000_000_000,
  objectStorageBytesUsed: 40_000_000_000,
  egressBytesUsed: 80_000_000,
  retriesUsed: 4_000,
  notificationsUsed: 900,
  reserveUnitsUsed: 2_000,
};

export const CEILING_EXCEEDED_OBSERVED_USAGE: ObservedUsageFixture = {
  creditsUsed: 120_000, // Exceeds 100_000 ceiling!
  streamBytesUsed: 600_000_000,
  modelTokensUsed: 1_200_000,
  workflowStepsUsed: 60_000,
  dbGrowthBytesUsed: 12_000_000_000,
  objectStorageBytesUsed: 60_000_000_000,
  egressBytesUsed: 150_000_000,
  retriesUsed: 7_000,
  notificationsUsed: 1_500,
  reserveUnitsUsed: 6_000,
};

export const VERIFIED_FORECAST_SNAPSHOT: ForecastSnapshotFixture = {
  snapshotId: 'snap-verified-001',
  planVersionId: 'plan-v1',
  verifiedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  expiresAt: '2027-01-01T00:00:00Z' as UtcTimestamp,
  planLimits: VALID_PLAN_LIMITS,
  observedUsage: BASELINE_OBSERVED_USAGE,
  tolerancePercent: 15,
};

export const EXPIRED_FORECAST_SNAPSHOT: ForecastSnapshotFixture = {
  snapshotId: 'snap-expired-001',
  planVersionId: 'plan-v1-old',
  verifiedAt: '2025-01-01T00:00:00Z' as UtcTimestamp,
  expiresAt: '2026-01-01T00:00:00Z' as UtcTimestamp,
  planLimits: VALID_PLAN_LIMITS,
  observedUsage: BASELINE_OBSERVED_USAGE,
  tolerancePercent: 15,
};
