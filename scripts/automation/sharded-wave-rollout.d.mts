// Type declarations for the sharded-wave rollout router (V4 §18,
// sharded-wave-rollout.mjs).

export type RolloutMode = 'OFF' | 'CANARY' | 'PRODUCTION';

export interface ShardedWaveRollout {
  readonly mode: RolloutMode;
  readonly canaryPackages: readonly string[];
}

export declare const SHARDED_WAVE_ROLLOUT: ShardedWaveRollout;

export declare function shardedWaveAdmits(packageId: string, rollout?: ShardedWaveRollout): boolean;
