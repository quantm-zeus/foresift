/** Structural two-plane label separation (§68.9 / FR-MAT-006). */
import {
  ErrorCode,
  MatError,
  OutcomeLabelFamily,
  type OutcomeLabelFamily as LabelFamily,
} from '@foresift/domain';

export const OBJECTIVE_LABEL_FAMILIES = [
  OutcomeLabelFamily.OBJECTIVE_SIGNAL_OUTCOME,
  OutcomeLabelFamily.OBJECTIVE_TRADABLE_OUTCOME,
  OutcomeLabelFamily.OBJECTIVE_PORTFOLIO_UTILITY,
] as const;
export type ObjectiveLabelFamily = (typeof OBJECTIVE_LABEL_FAMILIES)[number];

export const SUBJECTIVE_LABEL_FAMILIES = [
  OutcomeLabelFamily.SUBJECTIVE_USER_UTILITY,
  OutcomeLabelFamily.HUMAN_EXPERT_JUDGMENT,
] as const;
export type SubjectiveLabelFamily = (typeof SUBJECTIVE_LABEL_FAMILIES)[number];

export interface ObjectiveLabelRecord<T = unknown> {
  readonly plane: 'OBJECTIVE';
  readonly family: ObjectiveLabelFamily;
  readonly candidateId: string;
  readonly value: T;
}

export interface SubjectiveUtilityRecord<T = unknown> {
  readonly plane: 'SUBJECTIVE';
  readonly family: SubjectiveLabelFamily;
  readonly candidateId: string;
  readonly subjectId: string;
  readonly value: T;
}

export interface ObjectiveQueryPlan {
  readonly plane: 'OBJECTIVE';
  readonly labelFamilies: readonly ObjectiveLabelFamily[];
  readonly joins: readonly { readonly plane: 'OBJECTIVE'; readonly source: string }[];
}

function isSubjective(family: LabelFamily): family is SubjectiveLabelFamily {
  return (SUBJECTIVE_LABEL_FAMILIES as readonly LabelFamily[]).includes(family);
}

/** Runtime boundary for dynamically constructed plans; typed callers cannot express this join. */
export function assertObjectiveQueryPlan(input: {
  readonly labelFamilies: readonly LabelFamily[];
  readonly joins?: readonly { readonly plane: 'OBJECTIVE' | 'SUBJECTIVE'; readonly source: string }[];
}): ObjectiveQueryPlan {
  if (input.labelFamilies.some(isSubjective) || input.joins?.some((join) => join.plane === 'SUBJECTIVE'))
    throw new MatError(
      'objective metric paths cannot join subjective records',
      {},
      ErrorCode.MAT_SUBJECTIVE_JOIN_REFUSED,
    );
  return Object.freeze({
    plane: 'OBJECTIVE',
    labelFamilies: [...input.labelFamilies] as ObjectiveLabelFamily[],
    joins: (input.joins ?? []).map((join) => ({ plane: 'OBJECTIVE' as const, source: join.source })),
  });
}

export function objectiveLabel<T>(
  candidateId: string,
  family: ObjectiveLabelFamily,
  value: T,
): ObjectiveLabelRecord<T> {
  return Object.freeze({ plane: 'OBJECTIVE', candidateId, family, value });
}

export function subjectiveUtility<T>(
  candidateId: string,
  subjectId: string,
  family: SubjectiveLabelFamily,
  value: T,
): SubjectiveUtilityRecord<T> {
  return Object.freeze({ plane: 'SUBJECTIVE', candidateId, subjectId, family, value });
}

/** Objective aggregation accepts no subjective record type by construction. */
export function objectiveValues<T>(records: readonly ObjectiveLabelRecord<T>[]): readonly T[] {
  return records.map((record) => record.value);
}
