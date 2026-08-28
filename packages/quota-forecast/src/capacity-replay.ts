/** Deterministic 30-day expected/stress sustainable-capacity replay. */
import { createHash } from 'node:crypto';

export const CAPACITY_REPLAY_DIMENSIONS = [
  'providerCreditsRates',
  'streamedBytes',
  'modelTokens',
  'workflowSteps',
  'databaseBytes',
  'objectStoreBytes',
  'egressBytes',
  'retries',
  'notifications',
  'reserves',
] as const;
export type CapacityReplayDimension = (typeof CAPACITY_REPLAY_DIMENSIONS)[number];
export type CapacityVector = Readonly<Record<CapacityReplayDimension, number>>;

export const LOW_PRIORITY_DEGRADATION_ORDER = [
  'SOCIAL',
  'ANALOG',
  'WALLET_HISTORY',
  'EXPLORATION',
  'BROAD_SCAN_DEPTH',
] as const;
export const PROTECTED_REPLAY_WORKLOADS = [
  'COLLECTOR_CONTINUITY',
  'RISK_MONITORING',
  'ALERT_VERIFICATION',
  'MATURE_OUTCOME_COLLECTION',
  'INTERACTIVE_RESERVE',
] as const;

export interface CapacityReplayInput {
  readonly snapshotId: string;
  readonly dailyExpected: readonly CapacityVector[];
  readonly dailyStress?: readonly CapacityVector[];
  readonly stressMultiplier?: number;
  readonly verifiedCeilings: CapacityVector;
}

export interface CapacityReplayModeResult {
  readonly replayId: string;
  readonly snapshotId: string;
  readonly mode: 'expected' | 'stress';
  readonly totals: CapacityVector;
  readonly exceededCeilings: readonly CapacityReplayDimension[];
  readonly blockingFlag: boolean;
  readonly incidentId: string | null;
  readonly degradationOrder: typeof LOW_PRIORITY_DEGRADATION_ORDER;
}

function zeroVector(): Record<CapacityReplayDimension, number> {
  return Object.fromEntries(CAPACITY_REPLAY_DIMENSIONS.map((key) => [key, 0])) as Record<
    CapacityReplayDimension,
    number
  >;
}

function validateDay(day: CapacityVector): void {
  for (const dimension of CAPACITY_REPLAY_DIMENSIONS) {
    const value = day[dimension];
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`invalid replay value for ${dimension}`);
  }
}

function sum(days: readonly CapacityVector[], multiplier: number): CapacityVector {
  const totals = zeroVector();
  for (const day of days) {
    validateDay(day);
    for (const dimension of CAPACITY_REPLAY_DIMENSIONS)
      totals[dimension] += day[dimension] * multiplier;
  }
  return totals;
}

function runMode(
  input: CapacityReplayInput,
  mode: 'expected' | 'stress',
  days: readonly CapacityVector[],
  multiplier: number,
): CapacityReplayModeResult {
  if (days.length !== 30) throw new Error(`${mode} replay requires exactly 30 daily inputs`);
  const totals = sum(days, multiplier);
  const exceededCeilings = CAPACITY_REPLAY_DIMENSIONS.filter(
    (dimension) => totals[dimension] > input.verifiedCeilings[dimension],
  );
  const canonical = JSON.stringify([
    input.snapshotId,
    mode,
    CAPACITY_REPLAY_DIMENSIONS.map((dimension) => [
      dimension,
      totals[dimension],
      input.verifiedCeilings[dimension],
    ]),
  ]);
  const replayId = `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
  return {
    replayId,
    snapshotId: input.snapshotId,
    mode,
    totals,
    exceededCeilings,
    blockingFlag: exceededCeilings.length > 0,
    incidentId: exceededCeilings.length === 0 ? null : `capacity-replay:${replayId.slice(7, 23)}`,
    degradationOrder: LOW_PRIORITY_DEGRADATION_ORDER,
  };
}

export class CapacityReplay {
  run(input: CapacityReplayInput): readonly [CapacityReplayModeResult, CapacityReplayModeResult] {
    const multiplier = input.dailyStress === undefined ? (input.stressMultiplier ?? 1.5) : 1;
    if (!Number.isFinite(multiplier) || multiplier < 1)
      throw new Error('stress multiplier must be at least one');
    return [
      runMode(input, 'expected', input.dailyExpected, 1),
      runMode(input, 'stress', input.dailyStress ?? input.dailyExpected, multiplier),
    ];
  }
}
