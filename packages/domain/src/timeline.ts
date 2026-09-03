/** Candidate decision-time truth (FR-DATA-009, AC-240). */
import { ErrorCode, ForesiftError } from './errors.ts';
import { compareTimestamps, type UtcTimestamp } from './timestamps.ts';

export interface DeliveredDecisionTimeline {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly decisionReadyAt: UtcTimestamp;
  readonly policyDecidedAt: UtcTimestamp;
  readonly workflowCompletedAt: UtcTimestamp;
  readonly deliveryEligibleAt: UtcTimestamp;
  readonly deliveredAt: UtcTimestamp;
  readonly counterfactualDeliveryAt?: never;
  readonly counterfactualDeliveryVersion?: never;
  readonly comparisonEntryAt?: never;
}

export interface NonDeliveredDecisionTimeline {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly decisionReadyAt: UtcTimestamp;
  readonly policyDecidedAt: UtcTimestamp;
  readonly workflowCompletedAt: UtcTimestamp;
  readonly deliveryEligibleAt: UtcTimestamp;
  readonly deliveredAt: null;
  readonly counterfactualDeliveryAt: UtcTimestamp;
  readonly counterfactualDeliveryVersion: string;
  readonly comparisonEntryAt: UtcTimestamp;
}

export type CandidateDecisionTimeline =
  | DeliveredDecisionTimeline
  | NonDeliveredDecisionTimeline;

/** Enforce the one universal monotonic chain before persistence. */
export function assertDecisionTimeline(input: CandidateDecisionTimeline): void {
  const chain = [
    input.decisionReadyAt,
    input.policyDecidedAt,
    input.workflowCompletedAt,
    input.deliveryEligibleAt,
  ];
  for (let i = 1; i < chain.length; i += 1) {
    if (compareTimestamps(chain[i]!, chain[i - 1]!) < 0) {
      throw new ForesiftError(
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
        'candidate decision timeline is not monotonic',
        { decisionId: input.decisionId },
      );
    }
  }
  if (input.deliveredAt !== null) {
    if (compareTimestamps(input.deliveredAt, input.deliveryEligibleAt) < 0) {
      throw new ForesiftError(
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
        'delivery precedes delivery eligibility',
        { decisionId: input.decisionId },
      );
    }
    return;
  }
  if (input.counterfactualDeliveryVersion.trim().length === 0) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'non-delivered arm requires a versioned counterfactual delivery time',
      { decisionId: input.decisionId },
    );
  }
  if (compareTimestamps(input.counterfactualDeliveryAt, input.deliveryEligibleAt) < 0) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'counterfactual delivery precedes delivery eligibility',
      { decisionId: input.decisionId },
    );
  }
  if (compareTimestamps(input.comparisonEntryAt, input.counterfactualDeliveryAt) < 0) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'non-delivered arm cannot enter before counterfactual delivery',
      { decisionId: input.decisionId },
    );
  }
}
