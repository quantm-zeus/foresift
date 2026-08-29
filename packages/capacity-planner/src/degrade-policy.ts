import { WorkloadClass, type WorkloadClass as WorkloadClassType } from '@foresift/domain';

export const LOW_PRIORITY_DEGRADE_ORDER = [
  'SOCIAL',
  'ANALOG',
  'WALLET_HISTORY',
  'EXPLORATION',
  'BROAD_SCAN',
] as const;
export type DegradeFamily = (typeof LOW_PRIORITY_DEGRADE_ORDER)[number];
export type DegradeStep =
  'REDUCE_BREADTH' | 'REDUCE_DEPTH' | 'RETURN_CACHE' | 'SKIP_LOW_PRIORITY' | 'QUOTA_EXHAUSTED';
export interface DegradeState {
  readonly breadthReduced?: boolean;
  readonly depthReduced?: boolean;
  readonly cacheAvailable?: boolean;
}

export function broadScanDegradeStrategy(state: DegradeState): DegradeStep {
  if (!state.breadthReduced) return 'REDUCE_BREADTH';
  if (!state.depthReduced) return 'REDUCE_DEPTH';
  if (state.cacheAvailable) return 'RETURN_CACHE';
  return 'SKIP_LOW_PRIORITY';
}

export function workloadPriority(workloadClass: WorkloadClassType): number {
  switch (workloadClass) {
    case WorkloadClass.RISK_MONITOR_HIGH:
      return 0;
    case WorkloadClass.INTERACTIVE_HIGH:
      return 1;
    case WorkloadClass.SCHEDULED_NORMAL:
      return 2;
    case WorkloadClass.EVALUATION_LOW:
      return 3;
    case WorkloadClass.BACKFILL_LOW:
      return 4;
  }
}

export function deterministicDegradeOrder<
  T extends { readonly family: DegradeFamily; readonly id: string },
>(workloads: readonly T[]): readonly T[] {
  return [...workloads].sort((a, b) => {
    const family =
      LOW_PRIORITY_DEGRADE_ORDER.indexOf(a.family) - LOW_PRIORITY_DEGRADE_ORDER.indexOf(b.family);
    return family === 0 ? a.id.localeCompare(b.id) : family;
  });
}

export class DegradePolicy {
  decide(state: DegradeState): DegradeStep {
    return broadScanDegradeStrategy(state);
  }
}

export interface DegradePolicyContext {
  readonly workloadClass: WorkloadClassType;
  readonly generalPoolRemaining: number;
  readonly hasNarrowedProjectionAvailable: boolean;
  readonly alreadyDowngraded: boolean;
  readonly cacheAvailable?: boolean;
}

export function getDegradationPriorityOrder(): readonly string[] {
  return ['social', 'analog', 'wallet_history', 'exploration', 'broad_scan_depth'];
}

export function evaluateDegradeAction(
  context: DegradePolicyContext,
): 'DOWNGRADE_DEPTH' | 'RETURN_CACHE' | 'SKIP_LOW_PRIORITY' | 'QUOTA_EXHAUSTED' {
  if (context.generalPoolRemaining > 0) return 'QUOTA_EXHAUSTED';
  if (context.hasNarrowedProjectionAvailable && !context.alreadyDowngraded) {
    return 'DOWNGRADE_DEPTH';
  }
  if (context.cacheAvailable) return 'RETURN_CACHE';
  return context.workloadClass === WorkloadClass.RISK_MONITOR_HIGH
    ? 'QUOTA_EXHAUSTED'
    : 'SKIP_LOW_PRIORITY';
}
