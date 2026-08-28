/** Translate planner outcomes into tool-core stage-12 backpressure verbs. */
import type { BackpressureDecision, BackpressurePolicy } from '@foresift/tool-core';

export type CapacityPlannerDecision =
  'RETURN_CACHE' | 'DEGRADE_BREADTH' | 'DEGRADE_DEPTH' | 'SKIP_LOW_PRIORITY' | 'QUOTA_EXHAUSTED';

export function mapBackpressureDecision(decision: CapacityPlannerDecision): BackpressureDecision {
  switch (decision) {
    case 'RETURN_CACHE':
      return { action: 'RETURN_CACHE' };
    case 'DEGRADE_BREADTH':
    case 'DEGRADE_DEPTH':
      return { action: 'DOWNGRADE_DEPTH' };
    case 'SKIP_LOW_PRIORITY':
      return { action: 'SKIP_LOW_PRIORITY' };
    case 'QUOTA_EXHAUSTED':
    default:
      return { action: 'QUOTA_EXHAUSTED' };
  }
}

function fromReason(reason: string): CapacityPlannerDecision {
  if (reason.startsWith('RETURN_CACHE')) return 'RETURN_CACHE';
  if (reason.startsWith('DEGRADE_BREADTH')) return 'DEGRADE_BREADTH';
  if (reason.startsWith('DEGRADE_DEPTH') || reason.startsWith('DOWNGRADE_DEPTH'))
    return 'DEGRADE_DEPTH';
  if (reason.startsWith('SKIP_LOW_PRIORITY')) return 'SKIP_LOW_PRIORITY';
  return 'QUOTA_EXHAUSTED';
}

/** Policy accepted directly by makeQuotaEstimateStage. */
export const capacityBackpressurePolicy: BackpressurePolicy = (refusal) =>
  mapBackpressureDecision(fromReason(refusal.reason));
