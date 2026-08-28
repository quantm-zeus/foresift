/** Maps capacity decisions to tool-core stage-12 backpressure verbs. */
import type { BackpressureDecision, BackpressurePolicy } from '@foresift/tool-core';

export type CapacityDecisionVerb =
  'RETURN_CACHE' | 'DOWNGRADE_DEPTH' | 'SKIP_LOW_PRIORITY' | 'QUOTA_EXHAUSTED';

export interface CapacityBackpressureInput {
  readonly reason: string;
  readonly cacheAvailable?: boolean;
  readonly depthCanDegrade?: boolean;
  readonly lowPriority?: boolean;
}

export function mapBackpressureDecision(input: CapacityBackpressureInput): BackpressureDecision {
  if (input.cacheAvailable === true || /RETURN_CACHE|CACHE_AVAILABLE/.test(input.reason)) {
    return { action: 'RETURN_CACHE' };
  }
  if (input.depthCanDegrade === true || /DEGRADE_DEPTH|DOWNGRADE_DEPTH/.test(input.reason)) {
    return { action: 'DOWNGRADE_DEPTH' };
  }
  if (input.lowPriority === true || /SKIP_LOW_PRIORITY|LOW_PRIORITY/.test(input.reason)) {
    return { action: 'SKIP_LOW_PRIORITY' };
  }
  return { action: 'QUOTA_EXHAUSTED' };
}

/** Drop-in policy for makeQuotaEstimateStage; unknown refusals remain deny-closed. */
export const capacityBackpressurePolicy: BackpressurePolicy = (refusal) =>
  mapBackpressureDecision({ reason: refusal.reason });

export { capacityBackpressurePolicy as defaultCapacityBackpressurePolicy };
export const backpressureMapper = mapBackpressureDecision;
