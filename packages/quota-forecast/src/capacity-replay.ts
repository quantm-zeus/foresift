import type { ForecastSnapshot } from '@foresift/shared-schemas';
import { PlanVerifier } from './plan-verifier.ts';

export const CAPACITY_REPLAY_DIMENSIONS = [
  'credits',
  'rates',
  'streamedBytes',
  'modelTokens',
  'workflowSteps',
  'databaseGrowthBytes',
  'objectGrowthBytes',
  'egressBytes',
  'retries',
  'notifications',
  'reserves',
] as const;
export type CapacityReplayDimension = (typeof CAPACITY_REPLAY_DIMENSIONS)[number];
export type ReplayMode = 'expected' | 'stress';
export interface SnapshotCapacityReplayInput {
  readonly snapshot: ForecastSnapshot;
  readonly mode: ReplayMode;
  readonly usage: Partial<Record<CapacityReplayDimension, number>>;
  readonly stressMultiplier?: number;
}
export interface CapacityReplayInput {
  readonly mode: 'EXPECTED' | 'STRESS';
  readonly planLimits: {
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
  };
  readonly observedUsage: {
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
  };
  readonly simulationDays: 30;
}
export interface CapacityReplayResult {
  readonly mode: ReplayMode;
  readonly days: 30;
  readonly projected: Readonly<Record<CapacityReplayDimension, number>>;
  readonly exceededCeilings: readonly CapacityReplayDimension[];
  readonly blockingFlag: boolean;
  readonly degradationOrder: readonly string[];
}
const DEGRADATION_ORDER = [
  'SOCIAL',
  'ANALOG',
  'WALLET_HISTORY',
  'EXPLORATION',
  'BROAD_SCAN',
] as const;

export function replayCapacity(
  input: SnapshotCapacityReplayInput,
  verifier: PlanVerifier = new PlanVerifier(),
): CapacityReplayResult {
  verifier.assertVerified(input.snapshot);
  const multiplier = input.mode === 'stress' ? (input.stressMultiplier ?? 1.5) : 1;
  if (!Number.isFinite(multiplier) || multiplier < 1)
    throw new Error('CAPACITY_REPLAY_MULTIPLIER_INVALID');
  const projected = {} as Record<CapacityReplayDimension, number>;
  const exceededCeilings: CapacityReplayDimension[] = [];
  for (const dimension of CAPACITY_REPLAY_DIMENSIONS) {
    const value = (input.usage[dimension] ?? 0) * multiplier;
    projected[dimension] = value;
    const ceiling = input.snapshot.planLimitsJson[dimension];
    if (ceiling === undefined || value > ceiling) exceededCeilings.push(dimension);
  }
  return {
    mode: input.mode,
    days: 30,
    projected,
    exceededCeilings,
    blockingFlag: exceededCeilings.length > 0,
    degradationOrder: DEGRADATION_ORDER,
  };
}

export interface ThirtyDayCapacityReplayResult {
  readonly activationBlocked: boolean;
  readonly exceededCeilings: readonly string[];
  readonly dimensionsEvaluated: readonly string[];
  readonly mode: 'EXPECTED' | 'STRESS';
}

export function run30DayCapacityReplay(input: CapacityReplayInput): ThirtyDayCapacityReplayResult {
  const pairs = [
    ['credits', input.observedUsage.creditsUsed, input.planLimits.creditsPerMonth],
    ['rates', 0, input.planLimits.rateLimitPerSec],
    ['streamedBytes', input.observedUsage.streamBytesUsed, input.planLimits.maxStreamBytesPerDay],
    ['modelTokens', input.observedUsage.modelTokensUsed, input.planLimits.maxModelTokensPerDay],
    [
      'workflowSteps',
      input.observedUsage.workflowStepsUsed,
      input.planLimits.maxWorkflowStepsPerDay,
    ],
    [
      'databaseGrowthBytes',
      input.observedUsage.dbGrowthBytesUsed,
      input.planLimits.maxDbGrowthBytesPerMonth,
    ],
    [
      'objectGrowthBytes',
      input.observedUsage.objectStorageBytesUsed,
      input.planLimits.maxObjectStorageBytesPerMonth,
    ],
    ['egressBytes', input.observedUsage.egressBytesUsed, input.planLimits.maxEgressBytesPerDay],
    ['retries', input.observedUsage.retriesUsed, input.planLimits.maxRetriesPerDay],
    [
      'notifications',
      input.observedUsage.notificationsUsed,
      input.planLimits.maxNotificationsPerDay,
    ],
    ['reserves', input.observedUsage.reserveUnitsUsed, input.planLimits.protectedReserveFloorUnits],
  ] as const;
  const exceededCeilings = pairs.filter(([, used, limit]) => used > limit).map(([name]) => name);
  return {
    activationBlocked: exceededCeilings.length > 0,
    exceededCeilings,
    dimensionsEvaluated: pairs.map(([name]) => name),
    mode: input.mode,
  };
}

export class CapacityReplay {
  constructor(private readonly verifier = new PlanVerifier()) {}
  run(input: SnapshotCapacityReplayInput): CapacityReplayResult {
    return replayCapacity(input, this.verifier);
  }
  runExpectedAndStress(
    input: Omit<SnapshotCapacityReplayInput, 'mode'>,
  ): readonly [CapacityReplayResult, CapacityReplayResult] {
    return [this.run({ ...input, mode: 'expected' }), this.run({ ...input, mode: 'stress' })];
  }
}
