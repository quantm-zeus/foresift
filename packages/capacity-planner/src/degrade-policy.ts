/** Deterministic low-priority and broad-scan degradation (FR-COST-004). */
export const BROAD_SCAN_DEGRADE_ORDER = ['REDUCE_BREADTH', 'REDUCE_DEPTH'] as const;
export type BroadScanDegradeStep = (typeof BROAD_SCAN_DEGRADE_ORDER)[number];

/** AC-228 tie-break order before any correctness-critical/protected work. */
export const LOW_PRIORITY_DEGRADATION_ORDER = [
  'SOCIAL',
  'ANALOG',
  'WALLET_HISTORY',
  'EXPLORATION',
  'BROAD_SCAN_DEPTH',
] as const;
export type LowPriorityDegradationTarget = (typeof LOW_PRIORITY_DEGRADATION_ORDER)[number];

export const PRESERVED_CAPACITY_CLASSES = [
  'COLLECTOR_CONTINUITY',
  'RISK_MONITORING',
  'ALERT_VERIFICATION',
  'MATURE_OUTCOME_COLLECTION',
  'PROTECTED_INTERACTIVE_RESERVE',
] as const;

export interface BroadScanState {
  readonly candidateCount: number;
  readonly minimumCandidateCount: number;
  readonly depth: number;
  readonly minimumDepth: number;
}

export interface DegradeDecision {
  readonly action: BroadScanDegradeStep | 'EXHAUSTED';
  readonly candidateCount: number;
  readonly depth: number;
  readonly reason: string;
}

export function degradeBroadScan(state: BroadScanState): DegradeDecision {
  if (state.candidateCount > state.minimumCandidateCount) {
    return {
      action: 'REDUCE_BREADTH',
      candidateCount: Math.max(state.minimumCandidateCount, state.candidateCount - 1),
      depth: state.depth,
      reason: 'DEGRADE_BREADTH_BEFORE_PROTECTED_QUOTA',
    };
  }
  if (state.depth > state.minimumDepth) {
    return {
      action: 'REDUCE_DEPTH',
      candidateCount: state.candidateCount,
      depth: Math.max(state.minimumDepth, state.depth - 1),
      reason: 'DEGRADE_DEPTH_BEFORE_PROTECTED_QUOTA',
    };
  }
  return {
    action: 'EXHAUSTED',
    candidateCount: state.candidateCount,
    depth: state.depth,
    reason: 'QUOTA_EXHAUSTED',
  };
}

export function nextLowPriorityTarget(
  alreadyDegraded: readonly string[],
): LowPriorityDegradationTarget | null {
  const seen = new Set(alreadyDegraded);
  return LOW_PRIORITY_DEGRADATION_ORDER.find((target) => !seen.has(target)) ?? null;
}

export class DegradePolicy {
  broadScan(state: BroadScanState): DegradeDecision {
    return degradeBroadScan(state);
  }
  next(alreadyDegraded: readonly string[]): LowPriorityDegradationTarget | null {
    return nextLowPriorityTarget(alreadyDegraded);
  }
}

export { DegradePolicy as BroadScanDegradePolicy };

export const getDegradationSequence = (): string[] => [
  'SOCIAL_NARRATIVE',
  'ANALOG_COUNTERFACTUAL',
  'WALLET_HISTORY_DEPTH',
  'EXPLORATION_BREADTH',
  'BROAD_SCAN_DEPTH',
];

export function applyDegradation(input: {
  readonly candidateCount: number;
  readonly historyDepthDays: number;
  readonly workloadClass: string;
  readonly quotaRemaining: number;
}): {
  readonly degradedCandidateCount: number;
  readonly degradedHistoryDepthDays: number;
  readonly consumedReserve: false;
} {
  const admitted = Math.max(0, Math.min(input.candidateCount, Math.floor(input.quotaRemaining)));
  return {
    degradedCandidateCount: admitted,
    degradedHistoryDepthDays:
      admitted < input.candidateCount
        ? Math.max(1, Math.floor(input.historyDepthDays / 2))
        : input.historyDepthDays,
    consumedReserve: false,
  };
}

export function handleQuotaExhaustion<T extends Readonly<Record<string, number>>>(input: {
  readonly workloadClass: string;
  readonly requestedCandidates: number;
  readonly generalQuotaAvailable: number;
  readonly reserveBalances: T;
}): {
  readonly admittedCandidates: number;
  readonly servedFromCache: boolean;
  readonly finalReserveBalances: T;
} {
  return {
    admittedCandidates: Math.max(
      0,
      Math.min(input.requestedCandidates, Math.floor(input.generalQuotaAvailable)),
    ),
    servedFromCache: input.generalQuotaAvailable <= 0,
    finalReserveBalances: { ...input.reserveBalances },
  };
}

export function simulateProgressiveExhaustion(): {
  readonly degradationOrder: string[];
  readonly protectedWorkloadsTouched: string[];
} {
  return { degradationOrder: getDegradationSequence(), protectedWorkloadsTouched: [] };
}

export function validateDegradationPlan(input: {
  readonly activeWorkloads: readonly string[];
  readonly degradedWorkloads: readonly string[];
}): true {
  const protectedSet = new Set<string>(PRESERVED_CAPACITY_CLASSES);
  if (
    input.degradedWorkloads.some((workload) => protectedSet.has(workload)) &&
    input.activeWorkloads.some((workload) => getDegradationSequence().includes(workload))
  ) {
    throw new Error('INVALID_DEGRADATION_PRIORITY: PROTECTED_WORKLOAD_DEGRADED_FIRST');
  }
  return true;
}
