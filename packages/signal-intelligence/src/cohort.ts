import { QualityCode, type QualityCode as Quality } from '@foresift/domain';

/** §19.9 order is data, not caller preference. */
export const COHORT_FALLBACK_LEVELS = [
  'EXACT_COHORT',
  'REMOVE_NARRATIVE',
  'REMOVE_REGIME',
  'WIDEN_MARKET_CAP_BAND',
  'WIDEN_AGE_BAND',
  'CHAIN_LAUNCHPAD',
  'OWN_HISTORY_ANOMALY',
] as const;
export type CohortFallbackLevel = (typeof COHORT_FALLBACK_LEVELS)[number];

export interface CohortDimensions {
  readonly chain?: string | null;
  readonly launchpad?: string | null;
  readonly assetAgeBand?: string | null;
  readonly marketCapBand?: string | null;
  readonly liquidityBand?: string | null;
  readonly narrative?: string | null;
  readonly marketRegime?: string | null;
}

export interface CohortObservation extends CohortDimensions {
  readonly observationId: string;
  readonly value: number;
  readonly ownHistory?: boolean;
}

export interface CohortResolution {
  readonly fallbackLevel: CohortFallbackLevel;
  readonly cohort: readonly CohortObservation[];
  readonly cohortSize: number;
  readonly effectiveSampleSize: number;
  readonly missingDimensions: readonly (keyof CohortDimensions)[];
}

const DIMENSIONS: readonly (keyof CohortDimensions)[] = [
  'chain',
  'launchpad',
  'assetAgeBand',
  'marketCapBand',
  'liquidityBand',
  'narrative',
  'marketRegime',
];

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && a === b;
}

function includedDimensions(level: CohortFallbackLevel): readonly (keyof CohortDimensions)[] {
  switch (level) {
    case 'EXACT_COHORT':
      return DIMENSIONS;
    case 'REMOVE_NARRATIVE':
      return DIMENSIONS.filter((dimension) => dimension !== 'narrative');
    case 'REMOVE_REGIME':
      return DIMENSIONS.filter(
        (dimension) => dimension !== 'narrative' && dimension !== 'marketRegime',
      );
    case 'WIDEN_MARKET_CAP_BAND':
      return DIMENSIONS.filter(
        (dimension) =>
          dimension !== 'narrative' &&
          dimension !== 'marketRegime' &&
          dimension !== 'marketCapBand',
      );
    case 'WIDEN_AGE_BAND':
      return ['chain', 'launchpad', 'liquidityBand'];
    case 'CHAIN_LAUNCHPAD':
      return ['chain', 'launchpad'];
    case 'OWN_HISTORY_ANOMALY':
      return [];
  }
}

function deterministic(observations: readonly CohortObservation[]): readonly CohortObservation[] {
  return [...observations].sort((a, b) => a.observationId.localeCompare(b.observationId));
}

/** Selects the first sufficient cohort in the fixed normative fallback hierarchy. */
export function resolveCohortFallback(
  target: CohortDimensions,
  observations: readonly CohortObservation[],
  minimumCohortSize: number,
): CohortResolution {
  if (!Number.isInteger(minimumCohortSize) || minimumCohortSize < 1) {
    throw new RangeError('minimumCohortSize must be a positive integer');
  }
  if (observations.some((observation) => !Number.isFinite(observation.value))) {
    throw new RangeError('cohort values must be finite');
  }
  const missingDimensions = DIMENSIONS.filter((dimension) => target[dimension] == null);
  let last: readonly CohortObservation[] = [];
  for (const level of COHORT_FALLBACK_LEVELS) {
    const cohort = deterministic(
      level === 'OWN_HISTORY_ANOMALY'
        ? observations.filter((observation) => observation.ownHistory === true)
        : observations.filter((observation) =>
            includedDimensions(level).every((dimension) =>
              same(observation[dimension], target[dimension]),
            ),
          ),
    );
    last = cohort;
    if (cohort.length >= minimumCohortSize || level === 'OWN_HISTORY_ANOMALY') {
      return {
        fallbackLevel: level,
        cohort,
        cohortSize: cohort.length,
        effectiveSampleSize: cohort.length,
        missingDimensions,
      };
    }
  }
  return {
    fallbackLevel: 'OWN_HISTORY_ANOMALY',
    cohort: last,
    cohortSize: last.length,
    effectiveSampleSize: last.length,
    missingDimensions,
  };
}

export interface CohortComparison extends CohortResolution {
  readonly ownHistoryAnomaly: number | null;
  readonly peerPercentile: number | null;
  readonly sampleSize: number;
  readonly lowSampleWarning: boolean;
  readonly qualityCodes: readonly Quality[];
}

/** Mid-rank percentile keeps ties deterministic and the result bounded in [0,1]. */
export function peerPercentile(value: number, peers: readonly number[]): number | null {
  if (!Number.isFinite(value) || peers.some((peer) => !Number.isFinite(peer))) {
    throw new RangeError('percentile values must be finite');
  }
  if (peers.length === 0) return null;
  const below = peers.filter((peer) => peer < value).length;
  const equal = peers.filter((peer) => peer === value).length;
  return (below + equal * 0.5) / peers.length;
}

export function compareWithCohort(input: {
  readonly value: number;
  readonly ownHistoryCenter?: number | null;
  readonly target: CohortDimensions;
  readonly observations: readonly CohortObservation[];
  readonly minimumCohortSize: number;
}): CohortComparison {
  const resolution = resolveCohortFallback(
    input.target,
    input.observations,
    input.minimumCohortSize,
  );
  const percentile = peerPercentile(
    input.value,
    resolution.cohort.map((observation) => observation.value),
  );
  const lowSampleWarning = resolution.cohortSize < input.minimumCohortSize;
  const degraded = resolution.missingDimensions.length > 0;
  const qualityCodes: Quality[] = [];
  if (lowSampleWarning) qualityCodes.push(QualityCode.LOW_SAMPLE);
  if (degraded) qualityCodes.push(QualityCode.MISSING_PROVIDER);
  if (qualityCodes.length === 0) qualityCodes.push(QualityCode.VALID);
  return {
    ...resolution,
    ownHistoryAnomaly: input.ownHistoryCenter == null ? null : input.value - input.ownHistoryCenter,
    peerPercentile: percentile,
    sampleSize: resolution.cohortSize,
    lowSampleWarning,
    qualityCodes,
  };
}
