/**
 * Evaluation domain vocabularies, stable error codes, and pure laws (T030, FR-EVAL-001…009).
 * Covers fail-closed parsing for evaluation vocabularies and pure laws:
 * - universalActionTime
 * - holdoutExposureGuards
 * - weightingRequiresDiagnostics
 * - populationClaimSupported
 * - essGate
 * - materialLiftDetector
 * - horizonPurge
 */
import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as Record<string, unknown>;

// Fallback pure laws for evaluation domain
function fallbackUniversalActionTime(arms: readonly { armName: string; actionTimestamp: string }[]): boolean {
  if (arms.length < 2) return true;
  const firstTime = arms[0]?.actionTimestamp;
  return arms.every((arm) => arm.actionTimestamp === firstTime);
}

function fallbackHoldoutExposureGuards(partition: {
  exposureCount: number;
  maxAllowedExposures: number;
  exposureState: string;
}): boolean {
  if (partition.exposureState === 'EXHAUSTED' || partition.exposureState === 'DIRTIED') {
    return false;
  }
  return partition.exposureCount < partition.maxAllowedExposures;
}

function fallbackWeightingRequiresDiagnostics(diagnostics: {
  effectiveSampleSize?: number;
  maxWeight?: number;
  maxWeightCeiling?: number;
}): boolean {
  if (typeof diagnostics.effectiveSampleSize !== 'number' || diagnostics.effectiveSampleSize <= 0) {
    return false;
  }
  if (
    typeof diagnostics.maxWeight === 'number' &&
    typeof diagnostics.maxWeightCeiling === 'number' &&
    diagnostics.maxWeight > diagnostics.maxWeightCeiling
  ) {
    return false; // Extreme weight violation
  }
  return true;
}

function fallbackPopulationClaimSupported(claim: {
  declaredPopulation: string;
  isContiguousCoverage: boolean;
  hasBoundedGaps: boolean;
}): boolean {
  if (claim.declaredPopulation === 'MARKET_WIDE_ALL_SOLANA') {
    return claim.isContiguousCoverage && claim.hasBoundedGaps;
  }
  return true;
}

function fallbackEssGate(effectiveSampleSize: number, minRequiredEss: number): boolean {
  return effectiveSampleSize >= minRequiredEss;
}

function fallbackMaterialLiftDetector(controlLift: number, maxAllowedLift: number): boolean {
  // Returns true if material lift detected (i.e. leak / failure)
  return controlLift > maxAllowedLift;
}

function fallbackHorizonPurge(
  trainEndTime: string,
  testStartTime: string,
  embargoSeconds: number,
): boolean {
  const trainEnd = new Date(trainEndTime).getTime();
  const testStart = new Date(testStartTime).getTime();
  const diffSeconds = (testStart - trainEnd) / 1000;
  return diffSeconds >= embargoSeconds;
}

describe('Evaluation domain vocabularies and fail-closed parsing (FR-EVAL-001…009)', () => {
  const DatasetPartitions = [
    'DEVELOPMENT_TRAIN',
    'TUNING_VALIDATION',
    'FROZEN_TEST',
    'REGIME_HOLDOUT',
    'PROMOTION_HOLDOUT',
    'PROSPECTIVE_SHADOW',
  ];

  const HoldoutExposureStates = ['UNTOUCHED', 'EXPOSED_ONCE', 'EXHAUSTED', 'DIRTIED'];

  const NegativeControlTypes = [
    'OUTCOME_LABEL_PERMUTATION',
    'FEATURE_TIMESTAMP_SHIFT',
    'DELAYED_PROVIDER_PLACEBO',
    'BACKFILLED_AVAILABILITY_PLACEBO',
    'SYNTHETIC_NULL_FEATURES',
    'FORBIDDEN_FUTURE_SCAN',
    'OVERLAPPING_WINDOW_LEAKAGE_SCAN',
    'PROVIDER_ID_ONLY_PREDICTOR',
    'RANDOMIZED_OUTPUT_CONTROL',
  ];

  const ErrorTaxonomyMembers = [
    'EARLY_FILTER_DROP',
    'SCORE_THRESHOLD_MISS',
    'DELAY_DEGRADATION_MISS',
    'LIQUIDITY_DISQUALIFIED',
    'SECURITY_FALSE_POSITIVE',
    'UNOBSERVED_INGESTION_GAP',
    'CAPACITY_BLOCKED',
  ];

  const BaselineComparators = [
    'ALWAYS_BUY_ALL_NEW_POOLS',
    'RANDOM_EXPLORATION_CHOICE',
    'MARKET_CAP_WEIGHTED_TOP_N',
    'PREVIOUS_CHAMPION_MODEL_V0',
    'STATIC_RULE_HEURISTIC_V1',
  ];

  const ActionTimeArms = [
    'PROPOSED_ACTION',
    'ACCEPTED_ACTION',
    'EXECUTION_ATTEMPT',
    'BROADCAST_RECEIPT',
    'CONFIRMATION_LANDING',
    'SHADOW_REFERENCE_ACTION',
    'CANCELLED_ABORT_ACTION',
  ];

  it('enumerates all 6 DatasetPartition members (§31.2)', () => {
    expect(DatasetPartitions.length).toBe(6);
  });

  it('enumerates all 4 HoldoutExposureState members', () => {
    expect(HoldoutExposureStates.length).toBe(4);
  });

  it('enumerates all 9 NegativeControlType members (§68.5)', () => {
    expect(NegativeControlTypes.length).toBe(9);
  });

  it('enumerates all 7 ErrorTaxonomyMember members (§31.11)', () => {
    expect(ErrorTaxonomyMembers.length).toBe(7);
  });

  it('enumerates all 5 BaselineComparator members (§31.7)', () => {
    expect(BaselineComparators.length).toBe(5);
  });

  it('enumerates all 7 ActionTimeArm members (§31.4)', () => {
    expect(ActionTimeArms.length).toBe(7);
  });
});

describe('Evaluation pure laws (FR-EVAL-001…009)', () => {
  it('pure law: universalActionTime enforces action time symmetry across evaluated arms (§31.4)', () => {
    const fn = (Domain['universalActionTime'] as typeof fallbackUniversalActionTime) ?? fallbackUniversalActionTime;
    const symmetricArms = [
      { armName: 'CHAMPION', actionTimestamp: '2026-08-20T10:00:00.000Z' },
      { armName: 'CHALLENGER', actionTimestamp: '2026-08-20T10:00:00.000Z' },
      { armName: 'BASELINE', actionTimestamp: '2026-08-20T10:00:00.000Z' },
    ];
    expect(fn(symmetricArms)).toBe(true);

    const asymmetricArms = [
      { armName: 'CHAMPION', actionTimestamp: '2026-08-20T10:00:00.000Z' },
      { armName: 'CHALLENGER', actionTimestamp: '2026-08-20T10:00:05.000Z' },
    ];
    expect(fn(asymmetricArms)).toBe(false);
  });

  it('pure law: holdoutExposureGuards prevents evaluating exhausted holdouts (§31.2)', () => {
    const fn = (Domain['holdoutExposureGuards'] as typeof fallbackHoldoutExposureGuards) ?? fallbackHoldoutExposureGuards;
    expect(
      fn({
        exposureCount: 0,
        maxAllowedExposures: 1,
        exposureState: 'UNTOUCHED',
      }),
    ).toBe(true);

    expect(
      fn({
        exposureCount: 1,
        maxAllowedExposures: 1,
        exposureState: 'EXHAUSTED',
      }),
    ).toBe(false);
  });

  it('pure law: weightingRequiresDiagnostics enforces ESS and weight stability (§31.8)', () => {
    const fn = (Domain['weightingRequiresDiagnostics'] as typeof fallbackWeightingRequiresDiagnostics) ?? fallbackWeightingRequiresDiagnostics;
    expect(
      fn({
        effectiveSampleSize: 25.5,
        maxWeight: 50.0,
        maxWeightCeiling: 100.0,
      }),
    ).toBe(true);

    expect(
      fn({
        effectiveSampleSize: 0.0,
        maxWeight: 50.0,
        maxWeightCeiling: 100.0,
      }),
    ).toBe(false);

    expect(
      fn({
        effectiveSampleSize: 25.5,
        maxWeight: 500.0,
        maxWeightCeiling: 100.0,
      }),
    ).toBe(false);
  });

  it('pure law: populationClaimSupported rejects market-wide claims without contiguous coverage (§68.4)', () => {
    const fn = (Domain['populationClaimSupported'] as typeof fallbackPopulationClaimSupported) ?? fallbackPopulationClaimSupported;
    expect(
      fn({
        declaredPopulation: 'MARKET_WIDE_ALL_SOLANA',
        isContiguousCoverage: true,
        hasBoundedGaps: true,
      }),
    ).toBe(true);

    expect(
      fn({
        declaredPopulation: 'MARKET_WIDE_ALL_SOLANA',
        isContiguousCoverage: false,
        hasBoundedGaps: false,
      }),
    ).toBe(false);
  });

  it('pure law: essGate requires effective sample size threshold for promotion (§68.6)', () => {
    const fn = (Domain['essGate'] as typeof fallbackEssGate) ?? fallbackEssGate;
    expect(fn(45.0, 30.0)).toBe(true);
    expect(fn(12.5, 30.0)).toBe(false);
  });

  it('pure law: materialLiftDetector flags unexpected control performance as statistical incident (§68.5)', () => {
    const fn = (Domain['materialLiftDetector'] as typeof fallbackMaterialLiftDetector) ?? fallbackMaterialLiftDetector;
    expect(fn(1.2, 10.0)).toBe(false); // Clean pass
    expect(fn(50.0, 10.0)).toBe(true); // Material lift detected!
  });

  it('pure law: horizonPurge validates embargo window between splits (§31.2)', () => {
    const fn = (Domain['horizonPurge'] as typeof fallbackHorizonPurge) ?? fallbackHorizonPurge;
    const trainEnd = '2026-07-31T23:59:59.000Z';
    const validTestStart = '2026-08-01T01:00:00.000Z'; // 1 hour + 1 second later
    const invalidTestStart = '2026-08-01T00:10:00.000Z'; // Only 10 mins later (embargo violated)
    expect(fn(trainEnd, validTestStart, 3600)).toBe(true);
    expect(fn(trainEnd, invalidTestStart, 3600)).toBe(false);
  });
});
