/** Prospective probe propensity and selection-bias diagnostics (§68.10). */
import { ClaimRestriction, ErrorCode, EvalError } from '@foresift/domain';
import { MAXIMUM_SAMPLING_WEIGHT } from '@foresift/outcome-maturity';

export interface ProbeAssignment {
  readonly candidateId: string;
  readonly stratumId: string;
  readonly assignmentProbability: number;
  readonly assignedAt: string;
  readonly retrievalStartedAt: string;
  readonly outcomeMaturedAt: string | null;
  readonly selected: boolean;
}

export interface SelectionBiasDiagnosis {
  readonly propensityValid: boolean;
  readonly positivity: boolean;
  readonly overlap: boolean;
  readonly weightStable: boolean;
  readonly maximumWeight: number;
  readonly claimRestriction: ClaimRestriction;
}

export function diagnoseSelectionBias(input: {
  readonly assignments: readonly ProbeAssignment[];
  readonly eligibleStrata: readonly string[];
}): SelectionBiasDiagnosis {
  if (input.assignments.length === 0)
    throw new EvalError('probe assignments are required', {}, ErrorCode.EVAL_WEIGHTING_INVALID);
  const propensityValid = input.assignments.every((assignment) => {
    const assigned = Date.parse(assignment.assignedAt);
    const retrieval = Date.parse(assignment.retrievalStartedAt);
    const maturity = assignment.outcomeMaturedAt === null ? Number.POSITIVE_INFINITY : Date.parse(assignment.outcomeMaturedAt);
    return Number.isFinite(assigned) && Number.isFinite(retrieval) && assigned <= retrieval && assigned < maturity &&
      Number.isFinite(assignment.assignmentProbability) && assignment.assignmentProbability > 0 && assignment.assignmentProbability <= 1;
  });
  const positivity = propensityValid;
  const selectedStrata = new Set(input.assignments.filter((assignment) => assignment.selected).map((assignment) => assignment.stratumId));
  const overlap = input.eligibleStrata.length > 0 && input.eligibleStrata.every((stratum) => selectedStrata.has(stratum));
  const maximumWeight = positivity
    ? Math.max(...input.assignments.map((assignment) => 1 / assignment.assignmentProbability))
    : Number.POSITIVE_INFINITY;
  const weightStable = maximumWeight <= MAXIMUM_SAMPLING_WEIGHT;
  const claimRestriction = propensityValid && positivity && overlap && weightStable
    ? ClaimRestriction.DECLARED_UNIVERSE
    : positivity && overlap && weightStable
      ? ClaimRestriction.RESTRICT_TO_WEIGHTED_STRATA
      : ClaimRestriction.RESTRICT_TO_OBSERVED_SUBSET;
  return Object.freeze({ propensityValid, positivity, overlap, weightStable, maximumWeight, claimRestriction });
}
