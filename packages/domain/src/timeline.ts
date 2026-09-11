import { compareTimestamps, utcTimestamp } from './timestamps.ts';

function compare(a: string, b: string): number {
  return compareTimestamps(utcTimestamp(a), utcTimestamp(b));
}

export function computeDeliveryEligibleAt(
  decisionReadyAt: string,
  policyDecidedAt: string,
): string {
  return compare(decisionReadyAt, policyDecidedAt) >= 0 ? decisionReadyAt : policyDecidedAt;
}

export interface DecisionTimelineLike {
  readonly decisionReadyAt: string;
  readonly policyDecidedAt: string;
  readonly workflowCompletedAt: string;
  readonly deliveryEligibleAt: string;
  readonly deliveredAt: string | null;
}

export function isTimelineMonotonic(input: DecisionTimelineLike): boolean {
  const expectedEligibleAt = computeDeliveryEligibleAt(
    input.decisionReadyAt,
    input.policyDecidedAt,
  );
  if (compare(input.decisionReadyAt, input.policyDecidedAt) > 0) return false;
  if (compare(input.policyDecidedAt, input.workflowCompletedAt) > 0) return false;
  if (compare(input.deliveryEligibleAt, expectedEligibleAt) !== 0) return false;
  return input.deliveredAt === null || compare(input.deliveredAt, input.workflowCompletedAt) >= 0;
}

export interface CounterfactualArmLike {
  readonly deliveredAt: string | null;
  readonly counterfactualDeliveryAt: string | null;
  readonly counterfactualVersion: number | string | null;
  readonly deliveryEligibleAt: string;
}

export function validateCounterfactualArm(input: CounterfactualArmLike): boolean {
  if (input.deliveredAt !== null) {
    return input.counterfactualDeliveryAt === null && input.counterfactualVersion === null;
  }
  const version = input.counterfactualVersion;
  const versioned =
    (typeof version === 'number' && Number.isInteger(version) && version > 0) ||
    (typeof version === 'string' && version.trim().length > 0);
  return (
    input.counterfactualDeliveryAt !== null &&
    versioned &&
    compare(input.counterfactualDeliveryAt, input.deliveryEligibleAt) >= 0
  );
}

export interface DecisionDeliveryTimelineLike extends DecisionTimelineLike, CounterfactualArmLike {}

/** Validate the complete delivered/non-delivered arm contract as one predicate. */
export function isDecisionDeliveryTimelineValid(input: DecisionDeliveryTimelineLike): boolean {
  return isTimelineMonotonic(input) && validateCounterfactualArm(input);
}

/**
 * AC-240 comparison substrate: a non-delivered arm may enter no earlier than
 * its valid, versioned counterfactual delivery instant.
 */
export function nonDeliveredArmMayEnterAt(input: CounterfactualArmLike, entryAt: string): boolean {
  return (
    input.deliveredAt === null &&
    validateCounterfactualArm(input) &&
    compare(entryAt, input.counterfactualDeliveryAt!) >= 0
  );
}
