/**
 * Dataset partitions and holdout governance vectors (§31.2, FR-EVAL-001, FR-EVAL-002, AC-040, AC-042).
 * Covers:
 * - 6 canonical partitions
 * - Holdout exposure tracking states
 * - Purge and embargo time bounds
 * - Leakage grouping keys to prevent cross-partition contamination
 */

export const DATASET_PARTITIONS = [
  'DEVELOPMENT_TRAIN',
  'TUNING_VALIDATION',
  'FROZEN_TEST',
  'REGIME_HOLDOUT',
  'PROMOTION_HOLDOUT',
  'PROSPECTIVE_SHADOW',
] as const;

export type DatasetPartition = (typeof DATASET_PARTITIONS)[number];

export const HOLDOUT_EXPOSURE_STATES = [
  'UNTOUCHED',
  'EXPOSED_ONCE',
  'EXHAUSTED',
  'DIRTIED',
] as const;

export type HoldoutExposureState = (typeof HOLDOUT_EXPOSURE_STATES)[number];

export interface PartitionBoundary {
  partition: DatasetPartition;
  startTime: string;
  endTime: string;
  purgeStartTime: string;
  purgeEndTime: string;
  embargoSeconds: number;
  itemCount: number;
  exposureState: HoldoutExposureState;
  maxAllowedExposures: number;
  exposureCount: number;
  leakageGroupKeys: readonly string[];
}

export interface PartitionSplitManifest {
  manifestId: string;
  policyVersion: string;
  totalTimeRange: { start: string; end: string };
  partitions: readonly PartitionBoundary[];
  isContiguous: boolean;
  hasOverlappingWindows: boolean;
  embargoEnforced: boolean;
}

export const GOLDEN_DATASET_SPLITS: readonly PartitionSplitManifest[] = [
  {
    manifestId: 'split_q3_2026_canonical',
    policyVersion: '1.0.0',
    totalTimeRange: {
      start: '2026-06-01T00:00:00.000Z',
      end: '2026-08-31T23:59:59.999Z',
    },
    isContiguous: true,
    hasOverlappingWindows: false,
    embargoEnforced: true,
    partitions: [
      {
        partition: 'DEVELOPMENT_TRAIN',
        startTime: '2026-06-01T00:00:00.000Z',
        endTime: '2026-07-15T23:59:59.999Z',
        purgeStartTime: '2026-06-01T00:00:00.000Z',
        purgeEndTime: '2026-07-15T23:59:59.999Z',
        embargoSeconds: 3600,
        itemCount: 15000,
        exposureState: 'EXHAUSTED',
        maxAllowedExposures: 999999,
        exposureCount: 42,
        leakageGroupKeys: ['cluster_grp_train_01', 'cluster_grp_train_02', 'deployer_train_01'],
      },
      {
        partition: 'TUNING_VALIDATION',
        startTime: '2026-07-16T01:00:00.000Z', // 1h embargo buffer
        endTime: '2026-07-31T23:59:59.999Z',
        purgeStartTime: '2026-07-16T01:00:00.000Z',
        purgeEndTime: '2026-07-31T23:59:59.999Z',
        embargoSeconds: 3600,
        itemCount: 5000,
        exposureState: 'EXPOSED_ONCE',
        maxAllowedExposures: 10,
        exposureCount: 3,
        leakageGroupKeys: ['cluster_grp_val_01', 'deployer_val_01'],
      },
      {
        partition: 'FROZEN_TEST',
        startTime: '2026-08-01T01:00:00.000Z',
        endTime: '2026-08-15T23:59:59.999Z',
        purgeStartTime: '2026-08-01T01:00:00.000Z',
        purgeEndTime: '2026-08-15T23:59:59.999Z',
        embargoSeconds: 3600,
        itemCount: 4000,
        exposureState: 'UNTOUCHED',
        maxAllowedExposures: 3,
        exposureCount: 0,
        leakageGroupKeys: ['cluster_grp_test_01', 'deployer_test_01'],
      },
      {
        partition: 'REGIME_HOLDOUT',
        startTime: '2026-08-16T01:00:00.000Z',
        endTime: '2026-08-20T23:59:59.999Z',
        purgeStartTime: '2026-08-16T01:00:00.000Z',
        purgeEndTime: '2026-08-20T23:59:59.999Z',
        embargoSeconds: 3600,
        itemCount: 1500,
        exposureState: 'UNTOUCHED',
        maxAllowedExposures: 2,
        exposureCount: 0,
        leakageGroupKeys: ['cluster_grp_regime_01'],
      },
      {
        partition: 'PROMOTION_HOLDOUT',
        startTime: '2026-08-21T01:00:00.000Z',
        endTime: '2026-08-25T23:59:59.999Z',
        purgeStartTime: '2026-08-21T01:00:00.000Z',
        purgeEndTime: '2026-08-25T23:59:59.999Z',
        embargoSeconds: 7200, // 2h embargo
        itemCount: 1200,
        exposureState: 'UNTOUCHED',
        maxAllowedExposures: 1, // Single-use gate
        exposureCount: 0,
        leakageGroupKeys: ['cluster_grp_promo_01'],
      },
      {
        partition: 'PROSPECTIVE_SHADOW',
        startTime: '2026-08-26T00:00:00.000Z',
        endTime: '2026-08-31T23:59:59.999Z',
        purgeStartTime: '2026-08-26T00:00:00.000Z',
        purgeEndTime: '2026-08-31T23:59:59.999Z',
        embargoSeconds: 0,
        itemCount: 2000,
        exposureState: 'UNTOUCHED',
        maxAllowedExposures: 999999,
        exposureCount: 0,
        leakageGroupKeys: ['cluster_grp_shadow_01'],
      },
    ],
  },
];
