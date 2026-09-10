/** Universal action-time semantics over proven decision timelines (§31.4). */
import { ErrorCode, EvalError, universalActionTime } from '@foresift/domain';
import type { CandidateDecisionTimeline } from '@foresift/shared-schemas';

export const EvaluationArm = {
  ALERTED: 'ALERTED',
  WATCHED: 'WATCHED',
  IGNORED: 'IGNORED',
  REJECTED: 'REJECTED',
  BELOW_CUTOFF: 'BELOW_CUTOFF',
  CHALLENGER: 'CHALLENGER',
  CONTROL: 'CONTROL',
  MISSED: 'MISSED',
} as const;
export type EvaluationArm = (typeof EvaluationArm)[keyof typeof EvaluationArm];

export interface CandidateActionTimeInput {
  readonly arm: EvaluationArm;
  readonly timeline: CandidateDecisionTimeline;
  readonly scenarioDelayMilliseconds?: number;
  readonly scenarioDelaySeconds?: number;
  readonly executionStateAvailableAt: string;
  readonly securityEvidenceAvailableAt: string;
  readonly requiredStateAvailableAt?: readonly string[];
}

export interface CandidateActionTime {
  readonly arm: EvaluationArm;
  readonly deliveryAt: string;
  readonly actionableAt: string;
  readonly counterfactual: boolean;
}

/** The arm is metadata only: it never changes the formula or timestamp inputs. */
export function candidateActionTime(input: CandidateActionTimeInput): CandidateActionTime {
  const counterfactual = input.timeline.deliveredAt === null;
  const deliveryAt = input.timeline.deliveredAt ?? input.timeline.counterfactualDeliveryAt;
  if (deliveryAt === null)
    throw new EvalError('non-delivered arm requires counterfactual delivery', { candidateId: input.timeline.candidateId }, ErrorCode.EVAL_ACTION_TIME_ASYMMETRY);
  const actionableAt = universalActionTime({
    decisionReadyAt: input.timeline.decisionReadyAt,
    policyDecidedAt: input.timeline.policyDecidedAt,
    deliveryAt,
    ...(input.scenarioDelayMilliseconds === undefined ? {} : { scenarioDelayMilliseconds: input.scenarioDelayMilliseconds }),
    ...(input.scenarioDelaySeconds === undefined ? {} : { scenarioDelaySeconds: input.scenarioDelaySeconds }),
    executionStateAvailableAt: input.executionStateAvailableAt,
    securityEvidenceAvailableAt: input.securityEvidenceAvailableAt,
    ...(input.requiredStateAvailableAt === undefined ? {} : { requiredStateAvailableAt: input.requiredStateAvailableAt }),
  });
  return Object.freeze({ arm: input.arm, deliveryAt, actionableAt, counterfactual });
}

export function assertSymmetricActionTimes(results: readonly CandidateActionTime[]): void {
  const byDelivery = new Map<string, string>();
  for (const result of results) {
    const prior = byDelivery.get(result.deliveryAt);
    if (prior !== undefined && prior !== result.actionableAt)
      throw new EvalError('identical delivery inputs produced asymmetric action time', { deliveryAt: result.deliveryAt }, ErrorCode.EVAL_ACTION_TIME_ASYMMETRY);
    byDelivery.set(result.deliveryAt, result.actionableAt);
  }
}
