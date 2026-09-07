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

// ---------------------------------------------------------------------------
// G0 low-priority families → §62.8 full-order step indices (plan ADR-4)
// ---------------------------------------------------------------------------
import {
  DegradationStep as DegradationStepVocabulary,
  type DegradationStep,
} from '@foresift/domain';

/**
 * Map each G0 LOW_PRIORITY_DEGRADE_ORDER family onto the step indices of the
 * full versioned §62.8 order (1-based, as seeded in
 * cost.degradation_order_steps). The mapping is the ADR-4 "single
 * consumption path" law: the G0 family helper stays authoritative for family
 * priority (SOCIAL/ANALOG/WALLET_HISTORY/EXPLORATION/BROAD_SCAN), while its
 * reductions are expressed as indices INTO the canonical order — never a
 * second private ordering. A family absent from the order maps to no index.
 */
const FAMILY_STEP_NAMES: Record<DegradeFamily, DegradationStep | null> = {
  // "reduce optional social/narrative depth"
  SOCIAL: DegradationStepVocabulary.REDUCE_SOCIAL_NARRATIVE_DEPTH,
  // "skip notebook/analog/counterfactual enrichment" — the first §62.8 step
  ANALOG: DegradationStepVocabulary.SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL,
  // "reduce full wallet-history depth"
  WALLET_HISTORY: DegradationStepVocabulary.REDUCE_WALLET_HISTORY_DEPTH,
  // "pause source/pattern exploration above the protected floor"
  EXPLORATION: DegradationStepVocabulary.PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR,
  // broad-scan depth reduction is carried by cheap-monitor breadth reduction
  BROAD_SCAN: DegradationStepVocabulary.REDUCE_CHEAP_MONITOR_BREADTH,
};

/**
 * Map a G0 degrade family onto its 1-based step index within the given full
 * §62.8 order. Returns null when the order carries no step for the family
 * (a foreign order version may legitimately omit it) — never a guess.
 */
export function familyStepIndex(
  family: DegradeFamily,
  order: readonly DegradationStep[],
): number | null {
  const stepName = FAMILY_STEP_NAMES[family];
  if (stepName === null) return null;
  const index = order.indexOf(stepName);
  return index === -1 ? null : index + 1;
}

/**
 * Map every G0 low-priority family onto the full order's step indices, in
 * LOW_PRIORITY_DEGRADE_ORDER priority sequence. Families without a step in
 * `order` are omitted — the mapping never invents an index.
 */
export function familyStepIndices(
  order: readonly DegradationStep[],
): readonly { family: DegradeFamily; stepIndex: number }[] {
  const mapped: { family: DegradeFamily; stepIndex: number }[] = [];
  for (const family of LOW_PRIORITY_DEGRADE_ORDER) {
    const stepIndex = familyStepIndex(family, order);
    if (stepIndex !== null) mapped.push({ family, stepIndex });
  }
  return mapped;
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
