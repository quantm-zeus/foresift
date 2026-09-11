export const DIVERSITY_DEFAULTS: DiversityLimits = Object.freeze({
  narrative: 2,
  developerCluster: 1,
  fundingCluster: 1,
  launchpad: 3,
});

export type DiversityDimension = keyof DiversityLimits;

export interface DiversityLimits {
  readonly narrative: number;
  readonly developerCluster: number;
  readonly fundingCluster: number;
  readonly launchpad: number;
}

export interface DiversityCandidate {
  readonly candidateId: string;
  readonly narrative: string | null;
  readonly developerCluster: string | null;
  readonly fundingCluster: string | null;
  readonly launchpad: string | null;
}

export interface DiversityConstraintRecord {
  readonly candidateId: string;
  readonly dimension: DiversityDimension;
  readonly dimensionValue: string | null;
  readonly configuredLimit: number;
  readonly admitted: boolean;
  readonly code:
    'CONSTRAINT_APPLIED' | 'CONSTRAINT_LIMIT_REACHED' | 'CONSTRAINT_DIMENSION_UNAVAILABLE';
}

export interface DiversityResult {
  readonly selectedCandidateIds: readonly string[];
  readonly excludedCandidateIds: readonly string[];
  readonly records: readonly DiversityConstraintRecord[];
}

/** Applies limits in caller-supplied deterministic rank order. */
export function applyDiversityConstraints(
  rankedCandidates: readonly DiversityCandidate[],
  limits: DiversityLimits = DIVERSITY_DEFAULTS,
): DiversityResult {
  const dimensions = Object.keys(DIVERSITY_DEFAULTS) as DiversityDimension[];
  for (const dimension of dimensions) {
    if (!Number.isInteger(limits[dimension]) || limits[dimension] < 0) {
      throw new RangeError(`diversity limit ${dimension} must be a non-negative integer`);
    }
  }
  if (
    new Set(rankedCandidates.map((candidate) => candidate.candidateId)).size !==
    rankedCandidates.length
  ) {
    throw new Error('DIVERSITY_CANDIDATE_DUPLICATE');
  }

  const counts = new Map<string, number>();
  const records: DiversityConstraintRecord[] = [];
  const selectedCandidateIds: string[] = [];
  const excludedCandidateIds: string[] = [];
  for (const candidate of rankedCandidates) {
    let admitted = true;
    const candidateRecords: DiversityConstraintRecord[] = [];
    for (const dimension of dimensions) {
      const value = candidate[dimension];
      if (value === null) {
        candidateRecords.push({
          candidateId: candidate.candidateId,
          dimension,
          dimensionValue: null,
          configuredLimit: limits[dimension],
          admitted: true,
          code: 'CONSTRAINT_DIMENSION_UNAVAILABLE',
        });
        continue;
      }
      const key = `${dimension}:${value}`;
      const withinLimit = (counts.get(key) ?? 0) < limits[dimension];
      admitted &&= withinLimit;
      candidateRecords.push({
        candidateId: candidate.candidateId,
        dimension,
        dimensionValue: value,
        configuredLimit: limits[dimension],
        admitted: withinLimit,
        code: withinLimit ? 'CONSTRAINT_APPLIED' : 'CONSTRAINT_LIMIT_REACHED',
      });
    }
    records.push(...candidateRecords);
    if (admitted) {
      selectedCandidateIds.push(candidate.candidateId);
      for (const record of candidateRecords) {
        if (record.dimensionValue !== null) {
          const key = `${record.dimension}:${record.dimensionValue}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    } else {
      excludedCandidateIds.push(candidate.candidateId);
    }
  }
  return { selectedCandidateIds, excludedCandidateIds, records };
}
