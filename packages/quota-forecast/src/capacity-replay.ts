/** Deterministic 30-day expected/stress sustainable-capacity replay. */
import { createHash } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  LOW_PRIORITY_DEGRADATION_ORDER,
  PRESERVED_CAPACITY_CLASSES,
} from '@foresift/capacity-planner';

export const CAPACITY_REPLAY_DIMENSIONS = [
  'providerCredits',
  'providerRates',
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
export type CapacityReplayMode = 'expected' | 'stress';
export type CapacityReplayDay = Readonly<Record<CapacityReplayDimension, number>>;

export interface CapacityReplayResult {
  readonly replayId: string;
  readonly snapshotId: string;
  readonly mode: CapacityReplayMode;
  readonly totals: CapacityReplayDay;
  readonly exceededCeilings: readonly CapacityReplayDimension[];
  readonly blockingFlag: boolean;
  readonly incidentId: string | null;
  readonly degradationOrder: typeof LOW_PRIORITY_DEGRADATION_ORDER;
  readonly preservedClasses: typeof PRESERVED_CAPACITY_CLASSES;
}

function validateDay(
  day: Partial<Record<CapacityReplayDimension, number>>,
  index: number,
): CapacityReplayDay {
  const result = {} as Record<CapacityReplayDimension, number>;
  for (const dimension of CAPACITY_REPLAY_DIMENSIONS) {
    const value = day[dimension];
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      throw new Error(`capacity replay day ${index} has invalid ${dimension}`);
    }
    result[dimension] = value;
  }
  return result;
}

function stableRecord(record: Readonly<Record<string, number>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))),
  );
}

export class CapacityReplay {
  constructor(private readonly engine?: DatabaseEngine) {}

  async run(input: {
    readonly snapshotId: string;
    readonly mode: CapacityReplayMode;
    readonly days: readonly Partial<Record<CapacityReplayDimension, number>>[];
    readonly verifiedCeilings: Readonly<Record<CapacityReplayDimension, number>>;
    readonly stressMultiplier?: number;
  }): Promise<CapacityReplayResult> {
    if (input.days.length !== 30) throw new Error('capacity replay requires exactly 30 days');
    const multiplier = input.mode === 'stress' ? (input.stressMultiplier ?? 1) : 1;
    if (!Number.isFinite(multiplier) || multiplier < 1)
      throw new Error('stress multiplier must be at least one');
    const totals = Object.fromEntries(
      CAPACITY_REPLAY_DIMENSIONS.map((dimension) => [dimension, 0]),
    ) as Record<CapacityReplayDimension, number>;
    input.days.forEach((raw, index) => {
      const day = validateDay(raw, index);
      for (const dimension of CAPACITY_REPLAY_DIMENSIONS)
        totals[dimension] += day[dimension] * multiplier;
    });
    const exceededCeilings = CAPACITY_REPLAY_DIMENSIONS.filter((dimension) => {
      const ceiling = input.verifiedCeilings[dimension];
      if (!Number.isFinite(ceiling) || ceiling < 0)
        throw new Error(`verified ceiling missing for ${dimension}`);
      return totals[dimension] > ceiling;
    });
    const fingerprint = `${input.snapshotId}\u0000${input.mode}\u0000${stableRecord(totals)}\u0000${stableRecord(input.verifiedCeilings)}`;
    const replayId = `capacity-replay:${createHash('sha256').update(fingerprint).digest('hex')}`;
    const incidentId =
      exceededCeilings.length === 0
        ? null
        : `capacity-incident:${createHash('sha256')
            .update(`${replayId}\u0000${exceededCeilings.join(',')}`)
            .digest('hex')}`;
    const result: CapacityReplayResult = {
      replayId,
      snapshotId: input.snapshotId,
      mode: input.mode,
      totals,
      exceededCeilings,
      blockingFlag: exceededCeilings.length > 0,
      incidentId,
      degradationOrder: LOW_PRIORITY_DEGRADATION_ORDER,
      preservedClasses: PRESERVED_CAPACITY_CLASSES,
    };
    if (this.engine !== undefined) {
      await this.engine.query(
        `INSERT INTO cost.capacity_replay_runs
           (replay_id, snapshot_id, mode, blocking_flag, incident_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (replay_id) DO NOTHING`,
        [replayId, input.snapshotId, input.mode, result.blockingFlag, incidentId],
      );
    }
    return result;
  }

  async runExpectedAndStress(input: {
    readonly snapshotId: string;
    readonly days: readonly Partial<Record<CapacityReplayDimension, number>>[];
    readonly verifiedCeilings: Readonly<Record<CapacityReplayDimension, number>>;
    readonly stressMultiplier: number;
  }): Promise<readonly [CapacityReplayResult, CapacityReplayResult]> {
    return Promise.all([
      this.run({ ...input, mode: 'expected' }),
      this.run({ ...input, mode: 'stress' }),
    ]);
  }
}

export { CapacityReplay as CapacityReplayRunner };
