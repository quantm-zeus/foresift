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
export interface CapacityReplayInput {
  readonly snapshot: ForecastSnapshot;
  readonly mode: ReplayMode;
  readonly usage: Partial<Record<CapacityReplayDimension, number>>;
  readonly stressMultiplier?: number;
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
  input: CapacityReplayInput,
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

export class CapacityReplay {
  constructor(private readonly verifier = new PlanVerifier()) {}
  run(input: CapacityReplayInput): CapacityReplayResult {
    return replayCapacity(input, this.verifier);
  }
  runExpectedAndStress(
    input: Omit<CapacityReplayInput, 'mode'>,
  ): readonly [CapacityReplayResult, CapacityReplayResult] {
    return [this.run({ ...input, mode: 'expected' }), this.run({ ...input, mode: 'stress' })];
  }
}
