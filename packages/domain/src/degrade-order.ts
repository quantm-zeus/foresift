/**
 * Degradation order policy (PRD §62.8; FR-COST-015, AC-228, plan ADR-4).
 *
 * The canonical DEFAULT_POLICY_V1 sequence orders degradation steps from least to
 * most critical. Resolution is pure and deterministic: the next step is always the
 * first step of the (versioned) order not yet active. The two PROTECTED_STEPS are
 * terminal — resolution never escapes to paid operations and never skips them.
 */
import type { DegradationStep } from './capacity.ts';

/** Canonical §62.8 degradation order for policy version v1 (11 steps, exact order). */
export const DEFAULT_POLICY_V1: readonly DegradationStep[] = [
  'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
  'REDUCE_SOCIAL_NARRATIVE_DEPTH',
  'REDUCE_WALLET_HISTORY_DEPTH',
  'REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT',
  'EXTEND_LOW_PRIORITY_RECHECK_INTERVAL',
  'REDUCE_CHEAP_MONITOR_BREADTH',
  'PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR',
  'USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT',
  'STOP_NEW_OPPORTUNITY_RESEARCH',
  'PRESERVE_CRITICAL_OBLIGATIONS',
  'RETURN_PARTIAL_INSUFFICIENT_DATA',
] as const;

/** Terminal steps preserving critical obligations and honest partial returns. */
export const PROTECTED_STEPS: readonly DegradationStep[] = [
  'PRESERVE_CRITICAL_OBLIGATIONS',
  'RETURN_PARTIAL_INSUFFICIENT_DATA',
] as const;

export function isProtectedStep(step: DegradationStep): boolean {
  return (PROTECTED_STEPS as readonly string[]).includes(step);
}

export interface DegradationState {
  activeSteps: DegradationStep[];
  currentPressure: string;
}

/**
 * Resolve the next degradation step from a versioned order and the current state.
 * Returns the first step of `order` not present in `state.activeSteps`; when every
 * step is active the terminal `RETURN_PARTIAL_INSUFFICIENT_DATA` is returned, so a
 * resolved step is always a protected step at exhaustion — never a paid fallback.
 */
export function resolveDegradation(
  order: readonly DegradationStep[],
  state: DegradationState,
): DegradationStep {
  const active = new Set(state.activeSteps);
  for (const step of order) {
    if (!active.has(step)) return step;
  }
  return 'RETURN_PARTIAL_INSUFFICIENT_DATA';
}
