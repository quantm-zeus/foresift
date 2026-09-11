/** Candidate decision/action timeline persistence (FR-DATA-009, Appendix P). */
import {
  ErrorCode,
  ForesiftError,
  compareTimestamps,
  computeDeliveryEligibleAt,
  isTimelineMonotonic,
  utcTimestamp,
  validateCounterfactualArm,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

export interface CandidateDecisionTimelineInput {
  readonly candidateId: string;
  readonly policyVersion: string;
  readonly decisionReadyAt: UtcTimestamp;
  readonly policyDecidedAt: UtcTimestamp;
  readonly workflowCompletedAt: UtcTimestamp;
  /** May be omitted; the repository derives the universal max() boundary. */
  readonly deliveryEligibleAt?: UtcTimestamp;
  readonly deliveredAt?: UtcTimestamp | null;
  readonly counterfactualDeliveryAt?: UtcTimestamp | null;
  readonly counterfactualDeliveryVersion?: string | number | null;
  /** Compatibility spelling used by the domain predicate. */
  readonly counterfactualVersion?: string | number | null;
  /** Entry/action time for a comparison arm, when evaluated immediately. */
  readonly entryAt?: UtcTimestamp;
  readonly validUntil: UtcTimestamp;
  readonly expiredAt?: UtcTimestamp | null;
}

export async function recordCandidateDecisionTimeline(
  engine: DatabaseEngine,
  input: CandidateDecisionTimelineInput,
): Promise<void> {
  const eligibleText = computeDeliveryEligibleAt(input.decisionReadyAt, input.policyDecidedAt);
  const deliveryEligibleAt = utcTimestamp(eligibleText);
  if (
    input.deliveryEligibleAt !== undefined &&
    compareTimestamps(input.deliveryEligibleAt, deliveryEligibleAt) !== 0
  ) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'deliveryEligibleAt must equal max(decisionReadyAt, policyDecidedAt)',
      { candidateId: input.candidateId },
    );
  }
  const deliveredAt = input.deliveredAt ?? null;
  const counterfactualDeliveryAt = input.counterfactualDeliveryAt ?? null;
  const version = input.counterfactualDeliveryVersion ?? input.counterfactualVersion ?? null;
  if (
    !isTimelineMonotonic({
      decisionReadyAt: input.decisionReadyAt,
      policyDecidedAt: input.policyDecidedAt,
      workflowCompletedAt: input.workflowCompletedAt,
      deliveryEligibleAt,
      deliveredAt,
    }) ||
    !validateCounterfactualArm({
      deliveredAt,
      counterfactualDeliveryAt,
      counterfactualVersion: version,
      deliveryEligibleAt,
    })
  ) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'candidate decision timeline is non-monotonic or delivery arm is asymmetric',
      { candidateId: input.candidateId },
    );
  }
  if (
    deliveredAt === null &&
    input.entryAt !== undefined &&
    counterfactualDeliveryAt !== null &&
    compareTimestamps(input.entryAt, counterfactualDeliveryAt) < 0
  ) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'non-delivered arm cannot enter before counterfactual delivery',
      { candidateId: input.candidateId },
    );
  }
  const actionAt = deliveredAt ?? counterfactualDeliveryAt;
  if (actionAt === null || compareTimestamps(input.validUntil, actionAt) < 0) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'timeline action must occur within its validity window',
      { candidateId: input.candidateId },
    );
  }
  if (input.expiredAt != null && compareTimestamps(input.expiredAt, input.validUntil) < 0) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'expiration cannot precede validUntil',
      { candidateId: input.candidateId },
    );
  }
  await engine.query(
    `INSERT INTO candidate_decision_timelines (
       candidate_id, policy_version, decision_ready_at, policy_decided_at,
       workflow_completed_at, delivery_eligible_at, delivered_at,
       counterfactual_delivery_version, counterfactual_delivery_at,
       valid_until, expired_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.candidateId,
      input.policyVersion,
      input.decisionReadyAt,
      input.policyDecidedAt,
      input.workflowCompletedAt,
      deliveryEligibleAt,
      deliveredAt,
      version === null ? null : String(version),
      counterfactualDeliveryAt,
      input.validUntil,
      input.expiredAt ?? null,
    ],
  );
}

export const appendCandidateDecisionTimeline = recordCandidateDecisionTimeline;
