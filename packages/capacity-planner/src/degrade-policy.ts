/** Deterministic breadth/depth degradation before protected quota (FR-COST-004). */
import { WorkloadClass } from '@foresift/domain';

export const DEPTH_DEGRADE_PRIORITY = [
  'SOCIAL',
  'ANALOG',
  'WALLET_HISTORY',
  'EXPLORATION',
  'BROAD_SCAN_DEPTH',
] as const;
export type DegradeDimension = (typeof DEPTH_DEGRADE_PRIORITY)[number];

export type DegradeAction =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'DEGRADE_BREADTH'; readonly candidateLimit: number }
  | { readonly kind: 'DEGRADE_DEPTH'; readonly dimension: DegradeDimension }
  | { readonly kind: 'SKIP_LOW_PRIORITY' }
  | { readonly kind: 'QUOTA_EXHAUSTED' };

export interface DegradePolicyInput {
  readonly workloadClass: WorkloadClass;
  readonly generalPoolExhausted: boolean;
  readonly candidateCount: number;
  readonly minimumCandidateCount?: number;
  readonly breadthAlreadyDegraded?: boolean;
  readonly degradedDimensions?: readonly DegradeDimension[];
  readonly frozenEvidence?: boolean;
  readonly criticalRiskMonitoring?: boolean;
}

export function broadScanDegradeDecision(input: DegradePolicyInput): DegradeAction {
  if (!input.generalPoolExhausted) return { kind: 'NONE' };
  if (input.frozenEvidence === true || input.criticalRiskMonitoring === true) {
    return { kind: 'QUOTA_EXHAUSTED' };
  }
  const isBroad =
    input.workloadClass === WorkloadClass.SCHEDULED_NORMAL ||
    input.workloadClass === WorkloadClass.EVALUATION_LOW ||
    input.workloadClass === WorkloadClass.BACKFILL_LOW;
  if (!isBroad) return { kind: 'QUOTA_EXHAUSTED' };
  const minimum = Math.max(1, input.minimumCandidateCount ?? 1);
  if (input.breadthAlreadyDegraded !== true && input.candidateCount > minimum) {
    return {
      kind: 'DEGRADE_BREADTH',
      candidateLimit: Math.max(minimum, Math.floor(input.candidateCount / 2)),
    };
  }
  const degraded = new Set(input.degradedDimensions ?? []);
  const dimension = DEPTH_DEGRADE_PRIORITY.find((item) => !degraded.has(item));
  if (dimension !== undefined) return { kind: 'DEGRADE_DEPTH', dimension };
  return input.workloadClass === WorkloadClass.SCHEDULED_NORMAL
    ? { kind: 'QUOTA_EXHAUSTED' }
    : { kind: 'SKIP_LOW_PRIORITY' };
}

export class DegradePolicy {
  decide(input: DegradePolicyInput): DegradeAction {
    return broadScanDegradeDecision(input);
  }
}
