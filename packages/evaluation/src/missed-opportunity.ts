/** Frozen eight-step Missed Opportunity Analyzer (FR-EVAL-005). */
import { ErrorCode, EvalError, type MissClassification } from '@foresift/domain';
import {
  candidateActionTime,
  type CandidateActionTime,
  type EvaluationArm,
} from './action-time.ts';
import type { CandidateDecisionTimeline } from '@foresift/shared-schemas';

export interface MissedOpportunityInput {
  readonly candidateId: string;
  readonly claimedUniverse: string;
  readonly candidateUniverse: string | null;
  readonly coverageExists: boolean;
  readonly discoveredAt: string | null;
  readonly firstSourceAvailableAt: string | null;
  readonly collectorGap: boolean;
  readonly identityResolved: boolean;
  readonly funnelExit: string | null;
  readonly evidenceDecision:
    'REQUESTED' | 'NOT_REQUESTED' | 'COST_BLOCKED' | 'QUOTA_BLOCKED' | 'CAPABILITY_UNAVAILABLE';
  readonly decisionTimeline: CandidateDecisionTimeline;
  readonly executionStateAvailableAt: string;
  readonly securityEvidenceAvailableAt: string;
  readonly scenarioDelayMilliseconds: number;
  readonly frozenEvidenceRefs: readonly string[];
  readonly frozenVersions: Readonly<Record<string, string>>;
  readonly currentHoldoutId: string;
  readonly nextEligibleDatasetId: string;
}

export interface MissedOpportunityAnalysis {
  readonly candidateId: string;
  readonly classification: MissClassification;
  readonly steps: readonly {
    readonly step: number;
    readonly name: string;
    readonly result: string;
  }[];
  readonly sourceDelayMs: number | null;
  readonly decisionDelayMs: number | null;
  readonly actionTime: CandidateActionTime;
  readonly evidenceRefs: readonly string[];
  readonly versions: Readonly<Record<string, string>>;
  readonly populationBoundary: string;
  readonly nextEligibleDatasetId: string;
}

function classify(input: MissedOpportunityInput): MissClassification {
  if (input.candidateUniverse !== input.claimedUniverse) return 'NOT_IN_CLAIMED_UNIVERSE';
  if (!input.coverageExists || input.discoveredAt === null)
    return input.collectorGap ? 'COLLECTOR_GAP' : 'NOT_DISCOVERED';
  if (!input.identityResolved) return 'IDENTITY_FAILURE';
  if (input.evidenceDecision === 'NOT_REQUESTED') return 'EVIDENCE_NOT_REQUESTED';
  if (input.evidenceDecision === 'COST_BLOCKED') return 'EVIDENCE_COST_BLOCKED';
  if (input.evidenceDecision === 'QUOTA_BLOCKED') return 'EVIDENCE_QUOTA_BLOCKED';
  if (input.evidenceDecision === 'CAPABILITY_UNAVAILABLE') return 'CAPABILITY_UNAVAILABLE';
  if (input.funnelExit === 'RANK_BELOW_CUTOFF') return 'RANK_BELOW_CUTOFF';
  if (input.funnelExit === 'BUDGET_EXHAUSTED') return 'BUDGET_EXHAUSTED';
  if (input.funnelExit === 'ELIGIBILITY_REJECTED') return 'ELIGIBILITY_FALSE_NEGATIVE';
  return 'ALERT_TOO_LATE';
}

export function analyzeMissedOpportunity(input: MissedOpportunityInput): MissedOpportunityAnalysis {
  if (!input.nextEligibleDatasetId || input.nextEligibleDatasetId === input.currentHoldoutId)
    throw new EvalError(
      'miss analysis must attach only to a next eligible dataset',
      { candidateId: input.candidateId },
      ErrorCode.EVAL_HOLDOUT_EXHAUSTED_REUSED,
    );
  if (input.frozenEvidenceRefs.length === 0 || Object.keys(input.frozenVersions).length === 0)
    throw new EvalError(
      'miss analysis requires frozen evidence and versions',
      { candidateId: input.candidateId },
      ErrorCode.EVAL_UNIVERSE_MISMATCH,
    );
  const actionTime = candidateActionTime({
    arm: 'MISSED' as EvaluationArm,
    timeline: input.decisionTimeline,
    scenarioDelayMilliseconds: input.scenarioDelayMilliseconds,
    executionStateAvailableAt: input.executionStateAvailableAt,
    securityEvidenceAvailableAt: input.securityEvidenceAvailableAt,
  });
  const discoveredAt = input.discoveredAt === null ? null : Date.parse(input.discoveredAt);
  const sourceAt =
    input.firstSourceAvailableAt === null ? null : Date.parse(input.firstSourceAvailableAt);
  const sourceDelayMs = discoveredAt === null || sourceAt === null ? null : discoveredAt - sourceAt;
  const decisionDelayMs =
    discoveredAt === null
      ? null
      : Date.parse(input.decisionTimeline.decisionReadyAt) - discoveredAt;
  const classification = classify(input);
  const steps = [
    { step: 1, name: 'COVERAGE_EXISTENCE', result: input.coverageExists ? 'PRESENT' : 'ABSENT' },
    {
      step: 2,
      name: 'FIRST_SOURCE_AVAILABILITY',
      result: input.firstSourceAvailableAt ?? 'UNOBSERVED',
    },
    { step: 3, name: 'FUNNEL_EXIT', result: input.funnelExit ?? 'NO_RECORDED_EXIT' },
    { step: 4, name: 'CLASSIFICATION', result: classification },
    {
      step: 5,
      name: 'DELAY_DECOMPOSITION',
      result: `${sourceDelayMs ?? 'NA'}:${decisionDelayMs ?? 'NA'}`,
    },
    { step: 6, name: 'SYMMETRIC_ACTION_TIME', result: actionTime.actionableAt },
    { step: 7, name: 'FROZEN_BOUNDARY', result: input.claimedUniverse },
    { step: 8, name: 'NEXT_ELIGIBLE_DATASET', result: input.nextEligibleDatasetId },
  ] as const;
  return Object.freeze({
    candidateId: input.candidateId,
    classification,
    steps,
    sourceDelayMs,
    decisionDelayMs,
    actionTime,
    evidenceRefs: Object.freeze([...input.frozenEvidenceRefs].sort()),
    versions: Object.freeze({ ...input.frozenVersions }),
    populationBoundary: input.claimedUniverse,
    nextEligibleDatasetId: input.nextEligibleDatasetId,
  });
}
