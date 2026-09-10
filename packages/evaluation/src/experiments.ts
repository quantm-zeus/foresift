/** Pre-registration, multiplicity, power, and sequential rules (FR-EVAL-009). */
import { ErrorCode, EvalError, HoldoutExposure, type MultipleTestingFamily } from '@foresift/domain';

export interface RegisteredExperiment {
  readonly experimentId: string;
  readonly hypothesis: string;
  readonly family: MultipleTestingFamily;
  readonly registeredAt: string;
  readonly resultsAvailableAt: string | null;
  readonly sequentialRuleId: string;
  readonly holdoutExposure: HoldoutExposure;
}

export function registerExperiment(input: RegisteredExperiment): Readonly<RegisteredExperiment> {
  if (!input.hypothesis || !input.sequentialRuleId ||
      (input.resultsAvailableAt !== null && Date.parse(input.registeredAt) >= Date.parse(input.resultsAvailableAt)))
    throw new EvalError('experiment must be registered before results', { experimentId: input.experimentId }, ErrorCode.EVAL_HOLDOUT_EXHAUSTED_REUSED);
  return Object.freeze({ ...input });
}

export interface HypothesisResult {
  readonly hypothesisId: string;
  readonly pValue: number;
  readonly observedEffect: number;
}

export function adjustMultipleTests(
  results: readonly HypothesisResult[],
  family: MultipleTestingFamily,
): readonly (HypothesisResult & { readonly adjustedPValue: number; readonly winnersCurseRisk: boolean })[] {
  const ordered = [...results].sort((left, right) => left.pValue - right.pValue || left.hypothesisId.localeCompare(right.hypothesisId));
  const count = ordered.length;
  const adjusted = ordered.map((result, index) => {
    let adjustedPValue: number;
    if (family === 'BENJAMINI_HOCHBERG' || family === 'FALSE_DISCOVERY_RATE')
      adjustedPValue = result.pValue * count / (index + 1);
    else if (family === 'HOLM') adjustedPValue = result.pValue * (count - index);
    else adjustedPValue = result.pValue * count;
    return {
      ...result,
      adjustedPValue: Math.min(1, adjustedPValue),
      winnersCurseRisk: index === 0 && count > 1 && Math.abs(result.observedEffect) === Math.max(...ordered.map((item) => Math.abs(item.observedEffect))),
    };
  });
  // BH/Holm adjusted values must be monotone in sorted p-value order.
  let prior = 0;
  return Object.freeze(adjusted.map((result) => {
    prior = Math.max(prior, result.adjustedPValue);
    return Object.freeze({ ...result, adjustedPValue: prior });
  }));
}

export interface PowerPrecisionPlan {
  readonly version: string;
  readonly minimumMatureCases: number;
  readonly minimumSuccesses: number;
  readonly minimumFailures: number;
  readonly minimumRugs: number;
  readonly minimumClusterEss: number;
  readonly minimumCalendarBlocks: number;
  readonly requiredRegimes: readonly string[];
  readonly maximumIntervalWidth: number;
  readonly minimumDetectableUtility: number;
}

export function validatePowerPrecisionPlan(plan: PowerPrecisionPlan): Readonly<PowerPrecisionPlan> {
  const counts = [plan.minimumMatureCases, plan.minimumSuccesses, plan.minimumFailures,
    plan.minimumRugs, plan.minimumClusterEss, plan.minimumCalendarBlocks];
  if (!plan.version || counts.some((value) => !Number.isFinite(value) || value <= 0) ||
      plan.requiredRegimes.length === 0 || plan.maximumIntervalWidth <= 0 ||
      plan.minimumDetectableUtility <= 0)
    throw new EvalError('power plan must specify every precision dimension', { version: plan.version }, ErrorCode.EVAL_ESS_BELOW_GATE);
  return Object.freeze({ ...plan, requiredRegimes: Object.freeze([...plan.requiredRegimes]) });
}

export function holdoutMaySupportPromotion(exposure: HoldoutExposure): boolean {
  return exposure === HoldoutExposure.UNEXPOSED;
}
