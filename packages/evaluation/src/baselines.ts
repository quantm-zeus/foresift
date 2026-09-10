/** Strongest eligible simple-baseline selection and comparison (FR-EVAL-004). */
import { ErrorCode, EvalError, type BaselineKind } from '@foresift/domain';

export interface BaselineResult {
  readonly baselineKind: BaselineKind;
  readonly metricValue: number;
  readonly eligible: boolean;
  readonly simple: boolean;
  readonly weak: boolean;
  readonly strengthPriority: number;
  readonly candidateUniverseHash: string;
  readonly observationCutoff: string;
  readonly actionTimeSemanticsHash: string;
  readonly frozen: boolean;
}

export interface BaselineComparison {
  readonly comparator: BaselineResult;
  readonly candidateMetricValue: number;
  readonly lift: number;
  readonly weakBaselineRefused: false;
}

export function selectStrongestEligibleSimpleBaseline(
  baselines: readonly BaselineResult[],
): BaselineResult {
  const eligible = baselines.filter((baseline) =>
    baseline.eligible && baseline.simple && !baseline.weak && baseline.frozen,
  );
  const selected = [...eligible].sort((left, right) =>
    right.strengthPriority - left.strengthPriority ||
    left.baselineKind.localeCompare(right.baselineKind),
  )[0];
  if (!selected)
    throw new EvalError('no strong eligible simple baseline exists', {}, ErrorCode.EVAL_UNIVERSE_MISMATCH);
  return selected;
}

export function compareAgainstBaseline(input: {
  readonly candidateMetricValue: number;
  readonly candidateUniverseHash: string;
  readonly observationCutoff: string;
  readonly actionTimeSemanticsHash: string;
  readonly baselines: readonly BaselineResult[];
}): BaselineComparison {
  const comparator = selectStrongestEligibleSimpleBaseline(input.baselines);
  if (comparator.candidateUniverseHash !== input.candidateUniverseHash ||
      comparator.observationCutoff !== input.observationCutoff ||
      comparator.actionTimeSemanticsHash !== input.actionTimeSemanticsHash)
    throw new EvalError('baseline universe, cutoff, or action-time semantics differ', { baselineKind: comparator.baselineKind }, ErrorCode.EVAL_UNIVERSE_MISMATCH);
  return Object.freeze({
    comparator,
    candidateMetricValue: input.candidateMetricValue,
    lift: input.candidateMetricValue - comparator.metricValue,
    weakBaselineRefused: false,
  });
}
