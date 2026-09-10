/** Side-effect-free, budget-equalized champion/challenger comparison (FR-EVAL-007). */
import { ErrorCode, EvalError } from '@foresift/domain';

export interface ComparisonArm {
  readonly version: string;
  readonly candidateStreamHash: string;
  readonly availabilityBoundary: string;
  readonly budgetUnits: number;
  readonly metricValue: number;
  readonly externalSideEffects: number;
}

export interface ChampionChallengerResult {
  readonly champion: ComparisonArm;
  readonly challenger: ComparisonArm;
  readonly modelRemovedBaselineMetric: number;
  readonly lift: number;
  readonly promotionConstraints: readonly string[];
  readonly promotionEligible: boolean;
}

export function compareChampionChallenger(input: {
  readonly champion: ComparisonArm;
  readonly challenger: ComparisonArm;
  readonly modelRemovedBaselineMetric: number;
  readonly minimumLift: number;
  readonly promotionConstraints: readonly string[];
}): ChampionChallengerResult {
  if (input.champion.candidateStreamHash !== input.challenger.candidateStreamHash ||
      input.champion.availabilityBoundary !== input.challenger.availabilityBoundary)
    throw new EvalError('comparison arms do not share a frozen candidate stream', {}, ErrorCode.EVAL_UNIVERSE_MISMATCH);
  if (input.champion.budgetUnits !== input.challenger.budgetUnits)
    throw new EvalError('comparison budgets are not equalized', {}, ErrorCode.EVAL_UNIVERSE_MISMATCH);
  if (input.challenger.externalSideEffects !== 0)
    throw new EvalError('challenger external side effects are forbidden', {}, ErrorCode.EVAL_NETWORK_ACCESS_DENIED);
  if (input.promotionConstraints.length === 0)
    throw new EvalError('promotion constraints must be recorded', {}, ErrorCode.EVAL_UNIVERSE_MISMATCH);
  const lift = input.challenger.metricValue - input.champion.metricValue;
  return Object.freeze({
    champion: input.champion,
    challenger: input.challenger,
    modelRemovedBaselineMetric: input.modelRemovedBaselineMetric,
    lift,
    promotionConstraints: Object.freeze([...input.promotionConstraints]),
    promotionEligible: lift >= input.minimumLift &&
      input.challenger.metricValue > input.modelRemovedBaselineMetric,
  });
}
