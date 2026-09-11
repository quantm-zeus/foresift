/** Stratified high-resolution outcome sampling (FR-MAT-007). */
import { ClaimRestriction, ErrorCode, EvalError } from '@foresift/domain';

export const MAXIMUM_SAMPLING_WEIGHT = 20 as const;
const SCALE = 1_000_000_000_000n;

export interface SamplingDimensions {
  readonly rank: string;
  readonly rejectionReason: string;
  readonly source: string;
  readonly launchpad: string;
  readonly age: string;
  readonly regime: string;
  readonly profile: string;
  readonly coverage: string;
}

export interface SamplingAssignment {
  readonly assignmentId: string;
  readonly candidateId: string;
  readonly stratumId: string;
  readonly dimensions: SamplingDimensions;
  readonly inclusionProbability: number;
  readonly selected: boolean;
  readonly selectionTime: string;
  readonly selectionReason: string;
  readonly seedProvenance: string;
}

function present(value: string): boolean {
  return value.trim().length > 0;
}

/** Admission happens at selection time and refuses zero/unknown propensity. */
export function admitSamplingAssignment(input: SamplingAssignment): Readonly<SamplingAssignment> {
  const dimensionValues = Object.values(input.dimensions);
  if (
    !present(input.assignmentId) ||
    !present(input.candidateId) ||
    !present(input.stratumId) ||
    dimensionValues.length !== 8 ||
    dimensionValues.some((value) => !present(value)) ||
    !Number.isFinite(input.inclusionProbability) ||
    input.inclusionProbability <= 0 ||
    input.inclusionProbability > 1 ||
    !Number.isFinite(Date.parse(input.selectionTime)) ||
    !present(input.selectionReason) ||
    !present(input.seedProvenance) ||
    input.seedProvenance.startsWith('raw:')
  ) {
    throw new EvalError(
      'sampling assignment lacks prospective propensity or stratum provenance',
      { assignmentId: input.assignmentId },
      ErrorCode.EVAL_WEIGHTING_INVALID,
    );
  }
  return Object.freeze({ ...input, dimensions: Object.freeze({ ...input.dimensions }) });
}

function decimalToFixed(value: string): bigint {
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))
    throw new EvalError(
      'estimator value is not a canonical decimal',
      { value },
      ErrorCode.EVAL_WEIGHTING_INVALID,
    );
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const fixed = BigInt(whole) * SCALE + BigInt((fraction + '0'.repeat(12)).slice(0, 12));
  return negative ? -fixed : fixed;
}

function probabilityToFixed(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0 || value > 1)
    throw new EvalError(
      'inclusion probability must be in (0,1]',
      { value },
      ErrorCode.EVAL_WEIGHTING_INVALID,
    );
  return BigInt(Math.round(value * Number(SCALE)));
}

function fixedToDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(12, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export interface WeightedObservation {
  readonly candidateId: string;
  readonly value: string;
  readonly inclusionProbability: number;
  readonly selected: boolean;
  readonly stratumId: string;
}

export interface DesignWeightedEstimate {
  readonly horvitzThompsonTotal: string;
  readonly designWeightedMean: string | null;
  readonly estimatedPopulationSize: string;
  readonly selectedCount: number;
  readonly scale: 12;
}

/** Horvitz–Thompson contributions are evaluated with 12-place fixed point. */
export function designWeightedEstimator(
  observations: readonly WeightedObservation[],
): DesignWeightedEstimate {
  let weightedTotal = 0n;
  let populationTotal = 0n;
  let selectedCount = 0;
  for (const observation of observations) {
    if (!observation.selected) continue;
    selectedCount += 1;
    const probability = probabilityToFixed(observation.inclusionProbability);
    const value = decimalToFixed(observation.value);
    weightedTotal += (value * SCALE) / probability;
    populationTotal += (SCALE * SCALE) / probability;
  }
  const mean = populationTotal === 0n ? null : (weightedTotal * SCALE) / populationTotal;
  return Object.freeze({
    horvitzThompsonTotal: fixedToDecimal(weightedTotal),
    designWeightedMean: mean === null ? null : fixedToDecimal(mean),
    estimatedPopulationSize: fixedToDecimal(populationTotal),
    selectedCount,
    scale: 12,
  });
}

export const horvitzThompson = designWeightedEstimator;

export interface SamplingDiagnosticInput {
  readonly assignments: readonly Pick<
    SamplingAssignment,
    'selected' | 'inclusionProbability' | 'stratumId'
  >[];
  readonly eligibleStrata: readonly string[];
  readonly modelDiagnosticsValid: boolean;
  /** True when evaluation was built from selected rows without the full assignment frame. */
  readonly selectedOnly: boolean;
}

export interface SamplingDiagnostics {
  readonly positivity: boolean;
  readonly overlap: boolean;
  readonly weightStable: boolean;
  readonly modelDiagnosticsValid: boolean;
  readonly maximumWeight: number;
  readonly valid: boolean;
  readonly claimRestriction: ClaimRestriction;
}

export function samplingDiagnostics(input: SamplingDiagnosticInput): SamplingDiagnostics {
  const probabilities = input.assignments.map((assignment) => assignment.inclusionProbability);
  const positivity =
    probabilities.length > 0 &&
    probabilities.every(
      (probability) => Number.isFinite(probability) && probability > 0 && probability <= 1,
    );
  const selectedStrata = new Set(
    input.assignments
      .filter((assignment) => assignment.selected)
      .map((assignment) => assignment.stratumId),
  );
  const overlap =
    input.eligibleStrata.length > 0 &&
    input.eligibleStrata.every((stratum) => selectedStrata.has(stratum));
  const maximumWeight = positivity
    ? Math.max(...probabilities.map((probability) => 1 / probability))
    : Number.POSITIVE_INFINITY;
  const weightStable = maximumWeight <= MAXIMUM_SAMPLING_WEIGHT;
  const valid =
    positivity && overlap && weightStable && input.modelDiagnosticsValid && !input.selectedOnly;
  const claimRestriction = valid
    ? ClaimRestriction.DECLARED_UNIVERSE
    : positivity && overlap && weightStable
      ? ClaimRestriction.RESTRICT_TO_WEIGHTED_STRATA
      : ClaimRestriction.RESTRICT_TO_OBSERVED_SUBSET;
  return Object.freeze({
    positivity,
    overlap,
    weightStable,
    modelDiagnosticsValid: input.modelDiagnosticsValid,
    maximumWeight,
    valid,
    claimRestriction,
  });
}

export function samplingClaimRestriction(input: SamplingDiagnosticInput): ClaimRestriction {
  return samplingDiagnostics(input).claimRestriction;
}
