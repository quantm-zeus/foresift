import { QualityCode, type QualityCode as Quality } from '@foresift/domain';

export type MissingBucketHandling = 'SKIP' | 'CARRY_FORWARD' | 'RESET';

export interface RobustBaselineProfile {
  readonly featureId: string;
  readonly featureVersion: number;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly baselineWindowBuckets: number;
  readonly minimumBaselineSamples: number;
  readonly epsilon: number;
  readonly fastAlpha: number;
  readonly slowAlpha: number;
  readonly robustZThreshold: number;
  readonly ewmaDeltaThreshold: number;
  readonly consecutiveBucketsRequired: number;
  readonly minimumAbsoluteActivity: number;
  readonly minimumEconomicEventCoverage: number;
  readonly driftAllowance: number;
  readonly cusumDecisionThreshold: number;
  readonly requireCusum: boolean;
  readonly missingBucketHandling: MissingBucketHandling;
}

export const DEFAULT_ROBUST_BASELINE_PROFILE: RobustBaselineProfile = {
  featureId: 'robust_activity_change_point',
  featureVersion: 1,
  profileId: 'default',
  profileVersion: 1,
  baselineWindowBuckets: 72,
  minimumBaselineSamples: 12,
  epsilon: 1e-9,
  fastAlpha: 0.5,
  slowAlpha: 0.1,
  robustZThreshold: 3,
  ewmaDeltaThreshold: 2,
  consecutiveBucketsRequired: 2,
  minimumAbsoluteActivity: 1,
  minimumEconomicEventCoverage: 0.8,
  driftAllowance: 0.5,
  cusumDecisionThreshold: 5,
  requireCusum: false,
  missingBucketHandling: 'SKIP',
};

function positiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${field} must be positive`);
}

function unit(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must lie in [0,1]`);
  }
}

export function assertRobustBaselineProfile(profile: RobustBaselineProfile): void {
  if (profile.featureId.trim() === '' || profile.profileId.trim() === '') {
    throw new RangeError('featureId and profileId are required');
  }
  positiveInteger(profile.featureVersion, 'featureVersion');
  positiveInteger(profile.profileVersion, 'profileVersion');
  positiveInteger(profile.baselineWindowBuckets, 'baselineWindowBuckets');
  positiveInteger(profile.minimumBaselineSamples, 'minimumBaselineSamples');
  if (profile.minimumBaselineSamples > profile.baselineWindowBuckets) {
    throw new RangeError('minimumBaselineSamples cannot exceed baselineWindowBuckets');
  }
  if (!Number.isFinite(profile.epsilon) || profile.epsilon <= 0) {
    throw new RangeError('epsilon must be finite and positive');
  }
  unit(profile.fastAlpha, 'fastAlpha');
  unit(profile.slowAlpha, 'slowAlpha');
  if (profile.fastAlpha <= profile.slowAlpha) {
    throw new RangeError('fastAlpha must exceed slowAlpha');
  }
  for (const [field, value] of [
    ['robustZThreshold', profile.robustZThreshold],
    ['ewmaDeltaThreshold', profile.ewmaDeltaThreshold],
    ['minimumAbsoluteActivity', profile.minimumAbsoluteActivity],
    ['driftAllowance', profile.driftAllowance],
    ['cusumDecisionThreshold', profile.cusumDecisionThreshold],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${field} must be non-negative`);
  }
  positiveInteger(profile.consecutiveBucketsRequired, 'consecutiveBucketsRequired');
  unit(profile.minimumEconomicEventCoverage, 'minimumEconomicEventCoverage');
  if (!['SKIP', 'CARRY_FORWARD', 'RESET'].includes(profile.missingBucketHandling)) {
    throw new RangeError('unknown missingBucketHandling');
  }
}

export function median(values: readonly number[]): number {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new RangeError('median requires finite observations');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function medianAbsoluteDeviation(
  values: readonly number[],
  center = median(values),
): number {
  if (!Number.isFinite(center)) throw new RangeError('center must be finite');
  return median(values.map((value) => Math.abs(value - center)));
}

export interface RobustLocationScale {
  readonly center: number;
  readonly scale: number;
  readonly sampleSize: number;
}

export function robustLocationScale(
  values: readonly number[],
  epsilon: number,
): RobustLocationScale {
  if (!Number.isFinite(epsilon) || epsilon <= 0) throw new RangeError('epsilon must be positive');
  const center = median(values);
  return {
    center,
    scale: Math.max(1.4826 * medianAbsoluteDeviation(values, center), epsilon),
    sampleSize: values.length,
  };
}

export function activityTransform(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('activity must be finite');
  return Math.log1p(Math.max(value, 0));
}

export function oneSidedCusum(previous: number, robustZ: number, driftAllowance: number): number {
  if (
    ![previous, robustZ, driftAllowance].every(Number.isFinite) ||
    previous < 0 ||
    driftAllowance < 0
  ) {
    throw new RangeError('invalid CUSUM input');
  }
  return Math.max(0, previous + robustZ - driftAllowance);
}

export interface ActivityBucket {
  readonly bucketId: string;
  readonly value: number | null;
  readonly economicEventCoverage: number;
}

export interface RobustBaselinePoint {
  readonly bucketId: string;
  readonly transformedValue: number | null;
  readonly robustCenter: number | null;
  readonly robustScale: number | null;
  readonly robustZ: number | null;
  readonly ewmaFast: number | null;
  readonly ewmaSlow: number | null;
  readonly ewmaDelta: number | null;
  readonly cusum: number;
  readonly cusumChangeDetected: boolean;
  readonly emergenceCandidate: boolean;
  readonly changeDetected: boolean;
  readonly consecutiveCandidateBuckets: number;
  readonly baselineSampleSize: number;
  readonly qualityCodes: readonly Quality[];
}

interface DetectorState {
  readonly fast: number | null;
  readonly slow: number | null;
  readonly cusum: number;
  readonly consecutive: number;
  readonly lastTransformed: number | null;
}

function missingPoint(
  bucket: ActivityBucket,
  profile: RobustBaselineProfile,
  state: DetectorState,
): { readonly point: RobustBaselinePoint; readonly state: DetectorState } {
  const reset = profile.missingBucketHandling === 'RESET';
  const carry = profile.missingBucketHandling === 'CARRY_FORWARD' ? state.lastTransformed : null;
  const nextState: DetectorState = reset
    ? { fast: null, slow: null, cusum: 0, consecutive: 0, lastTransformed: null }
    : { ...state, consecutive: 0 };
  return {
    point: {
      bucketId: bucket.bucketId,
      transformedValue: carry,
      robustCenter: null,
      robustScale: null,
      robustZ: null,
      ewmaFast: nextState.fast,
      ewmaSlow: nextState.slow,
      ewmaDelta: null,
      cusum: nextState.cusum,
      cusumChangeDetected: false,
      emergenceCandidate: false,
      changeDetected: false,
      consecutiveCandidateBuckets: 0,
      baselineSampleSize: 0,
      qualityCodes: [QualityCode.LOW_SAMPLE],
    },
    state: nextState,
  };
}

function calculatePoint(
  bucket: ActivityBucket,
  baseline: readonly number[],
  profile: RobustBaselineProfile,
  state: DetectorState,
): { readonly point: RobustBaselinePoint; readonly state: DetectorState } {
  unit(bucket.economicEventCoverage, 'economicEventCoverage');
  if (bucket.value === null) return missingPoint(bucket, profile, state);
  if (!Number.isFinite(bucket.value))
    throw new RangeError('bucket activity must be finite or null');
  const transformedValue = activityTransform(bucket.value);
  const fast =
    state.fast === null
      ? transformedValue
      : profile.fastAlpha * transformedValue + (1 - profile.fastAlpha) * state.fast;
  const slow =
    state.slow === null
      ? transformedValue
      : profile.slowAlpha * transformedValue + (1 - profile.slowAlpha) * state.slow;
  const enoughBaseline = baseline.length >= profile.minimumBaselineSamples;
  const location = enoughBaseline ? robustLocationScale(baseline, profile.epsilon) : null;
  const robustZ = location === null ? null : (transformedValue - location.center) / location.scale;
  const ewmaDelta = location === null ? null : (fast - slow) / location.scale;
  const cusum = robustZ === null ? 0 : oneSidedCusum(state.cusum, robustZ, profile.driftAllowance);
  const coverageSufficient = bucket.economicEventCoverage >= profile.minimumEconomicEventCoverage;
  const emergenceCandidate =
    enoughBaseline &&
    coverageSufficient &&
    bucket.value >= profile.minimumAbsoluteActivity &&
    robustZ !== null &&
    robustZ >= profile.robustZThreshold &&
    ewmaDelta !== null &&
    ewmaDelta >= profile.ewmaDeltaThreshold;
  const consecutive = emergenceCandidate ? state.consecutive + 1 : 0;
  const cusumChangeDetected =
    enoughBaseline && coverageSufficient && cusum >= profile.cusumDecisionThreshold;
  const changeDetected =
    consecutive >= profile.consecutiveBucketsRequired &&
    (!profile.requireCusum || cusumChangeDetected);
  const qualityCodes: Quality[] = [];
  if (!enoughBaseline) qualityCodes.push(QualityCode.LOW_SAMPLE);
  if (!coverageSufficient) qualityCodes.push(QualityCode.PARTIAL);
  if (qualityCodes.length === 0) qualityCodes.push(QualityCode.VALID);
  return {
    point: {
      bucketId: bucket.bucketId,
      transformedValue,
      robustCenter: location?.center ?? null,
      robustScale: location?.scale ?? null,
      robustZ,
      ewmaFast: fast,
      ewmaSlow: slow,
      ewmaDelta,
      cusum,
      cusumChangeDetected,
      emergenceCandidate,
      changeDetected,
      consecutiveCandidateBuckets: consecutive,
      baselineSampleSize: baseline.length,
      qualityCodes,
    },
    state: { fast, slow, cusum, consecutive, lastTransformed: transformedValue },
  };
}

/**
 * Runs buckets in caller-supplied event order. Each baseline uses populated
 * buckets strictly before the current bucket, preventing look-ahead leakage.
 */
export function computeRobustBaseline(
  buckets: readonly ActivityBucket[],
  profile: RobustBaselineProfile = DEFAULT_ROBUST_BASELINE_PROFILE,
): readonly RobustBaselinePoint[] {
  assertRobustBaselineProfile(profile);
  if (new Set(buckets.map((bucket) => bucket.bucketId)).size !== buckets.length) {
    throw new RangeError('bucketId values must be unique');
  }
  let state: DetectorState = {
    fast: null,
    slow: null,
    cusum: 0,
    consecutive: 0,
    lastTransformed: null,
  };
  const populated: number[] = [];
  const output: RobustBaselinePoint[] = [];
  for (const bucket of buckets) {
    const baseline = populated.slice(-profile.baselineWindowBuckets);
    const calculated = calculatePoint(bucket, baseline, profile, state);
    output.push(calculated.point);
    state = calculated.state;
    if (bucket.value !== null) populated.push(activityTransform(bucket.value));
  }
  return output;
}

export const robustActivityBaseline = computeRobustBaseline;
