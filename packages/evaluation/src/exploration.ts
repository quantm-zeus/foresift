/** Exploration/control retention for outcome-only evaluation (FR-EVAL-006). */
import { ErrorCode, EvalError } from '@foresift/domain';
import type { CandidateDecisionTimeline } from '@foresift/shared-schemas';
import { candidateActionTime, EvaluationArm, type CandidateActionTime } from './action-time.ts';

export interface ExplorationAudit {
  readonly auditId: string;
  readonly candidateId: string;
  readonly selectionArm: 'RANDOM_EXPLORATION' | 'CONTROL' | 'OUTCOME_OBSERVATION_ONLY';
  readonly selectionProbability: number;
  readonly cutoffReason: string;
  readonly selectedAt: string;
  readonly outcomeOnly: boolean;
  readonly externallyAlerted: boolean;
}

export interface RetainedExplorationCase {
  readonly audit: ExplorationAudit;
  readonly retainedForOutcomeAnalysis: true;
  readonly actionTime: CandidateActionTime;
}

export function retainExplorationCase(input: {
  readonly audit: ExplorationAudit;
  readonly timeline: CandidateDecisionTimeline;
  readonly executionStateAvailableAt: string;
  readonly securityEvidenceAvailableAt: string;
  readonly scenarioDelayMilliseconds: number;
}): RetainedExplorationCase {
  const { audit } = input;
  if (
    !Number.isFinite(audit.selectionProbability) ||
    audit.selectionProbability <= 0 ||
    audit.selectionProbability > 1 ||
    !audit.cutoffReason ||
    !Number.isFinite(Date.parse(audit.selectedAt))
  )
    throw new EvalError(
      'exploration assignment lacks probability or cutoff provenance',
      { auditId: audit.auditId },
      ErrorCode.EVAL_WEIGHTING_INVALID,
    );
  if (audit.outcomeOnly && audit.externallyAlerted)
    throw new EvalError(
      'outcome-only controls cannot cause external alerts',
      { auditId: audit.auditId },
      ErrorCode.EVAL_ACTION_TIME_ASYMMETRY,
    );
  const arm =
    audit.selectionArm === 'CONTROL'
      ? EvaluationArm.CONTROL
      : audit.selectionArm === 'OUTCOME_OBSERVATION_ONLY'
        ? EvaluationArm.IGNORED
        : EvaluationArm.WATCHED;
  const actionTime = candidateActionTime({
    arm,
    timeline: input.timeline,
    scenarioDelayMilliseconds: input.scenarioDelayMilliseconds,
    executionStateAvailableAt: input.executionStateAvailableAt,
    securityEvidenceAvailableAt: input.securityEvidenceAvailableAt,
  });
  return Object.freeze({
    audit: Object.freeze({ ...audit }),
    retainedForOutcomeAnalysis: true,
    actionTime,
  });
}

export function retainExplorationSample(
  input: readonly Parameters<typeof retainExplorationCase>[0][],
): readonly RetainedExplorationCase[] {
  return Object.freeze(input.map(retainExplorationCase));
}
