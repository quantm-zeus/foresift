import type { BackpressureDecision, BackpressurePolicy } from '@foresift/tool-core';

export type PlannerDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly action:
        | 'RETURN_CACHE'
        | 'REDUCE_DEPTH'
        | 'REDUCE_BREADTH'
        | 'SKIP_LOW_PRIORITY'
        | 'QUOTA_EXHAUSTED';
      readonly reason: string;
    };

export function mapPlannerDecision(decision: PlannerDecision): BackpressureDecision {
  if (decision.allowed) return { action: 'QUOTA_EXHAUSTED' };
  switch (decision.action) {
    case 'RETURN_CACHE':
      return { action: 'RETURN_CACHE' };
    case 'REDUCE_DEPTH':
    case 'REDUCE_BREADTH':
      return { action: 'DOWNGRADE_DEPTH' };
    case 'SKIP_LOW_PRIORITY':
      return { action: 'SKIP_LOW_PRIORITY' };
    case 'QUOTA_EXHAUSTED':
      return { action: 'QUOTA_EXHAUSTED' };
  }
}

export const capacityBackpressurePolicy: BackpressurePolicy = (refusal) => {
  const reason = refusal.reason;
  if (reason.startsWith('RETURN_CACHE')) return { action: 'RETURN_CACHE' };
  if (reason.startsWith('REDUCE_DEPTH') || reason.startsWith('REDUCE_BREADTH'))
    return { action: 'DOWNGRADE_DEPTH' };
  if (reason.startsWith('SKIP_LOW_PRIORITY')) return { action: 'SKIP_LOW_PRIORITY' };
  return { action: 'QUOTA_EXHAUSTED' };
};
