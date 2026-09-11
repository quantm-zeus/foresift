import {
  TradabilityVerdict,
  tradabilityVerdict,
  type TradabilityVerdict as Tradability,
} from '@foresift/domain';

export const LIFECYCLE_STATES = [
  'DISCOVERED',
  'QUALIFIED',
  'EMERGING',
  'CONFIRMED',
  'MONITORING',
  'DECAYING',
  'REJECTED',
  'ARCHIVED',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export interface LifecycleDefault {
  readonly state: LifecycleState;
  readonly entryIntent: string;
  readonly defaultAction: string;
}

export const LIFECYCLE_DEFAULTS: readonly LifecycleDefault[] = Object.freeze([
  {
    state: 'DISCOVERED',
    entryIntent: 'Appeared in a discovery source',
    defaultAction: 'Resolve identity and cheap metadata',
  },
  {
    state: 'QUALIFIED',
    entryIntent: 'Passed eligibility and critical-risk gates',
    defaultAction: 'Start selected snapshots/features',
  },
  {
    state: 'EMERGING',
    entryIntent: 'Multi-window signal improvement without excessive extension',
    defaultAction: 'Adaptive rechecks and limited agent research',
  },
  {
    state: 'CONFIRMED',
    entryIntent: 'Persistent independent evidence and validation pass',
    defaultAction: 'Eligible for alert policy',
  },
  {
    state: 'MONITORING',
    entryIntent: 'Alerted or explicitly watched',
    defaultAction: 'Monitor thesis validity and deterioration',
  },
  {
    state: 'DECAYING',
    entryIntent: 'Signal weakens or risk rises',
    defaultAction: 'Reduce cadence, consider downgrade warning',
  },
  {
    state: 'REJECTED',
    entryIntent: 'Invalid, unsafe, manipulated, or failed thesis',
    defaultAction: 'Stop deep research; retain outcome metadata',
  },
  {
    state: 'ARCHIVED',
    entryIntent: 'Expired retention/monitoring horizon',
    defaultAction: 'Aggregate and retain evaluation summary',
  },
]);

const ALLOWED_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  DISCOVERED: ['QUALIFIED', 'REJECTED', 'ARCHIVED'],
  QUALIFIED: ['EMERGING', 'REJECTED', 'ARCHIVED'],
  EMERGING: ['QUALIFIED', 'CONFIRMED', 'DECAYING', 'REJECTED', 'ARCHIVED'],
  CONFIRMED: ['MONITORING', 'DECAYING', 'REJECTED', 'ARCHIVED'],
  MONITORING: ['DECAYING', 'REJECTED', 'ARCHIVED'],
  DECAYING: ['EMERGING', 'MONITORING', 'REJECTED', 'ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  ARCHIVED: [],
};

export interface HysteresisRule {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly direction: 'PROMOTION' | 'DEMOTION' | 'TERMINAL';
  readonly persistenceThreshold: number | null;
  readonly comparator: 'GTE' | 'LT' | 'NONE';
  readonly consecutiveWindows: number;
  readonly minimumDwellSeconds: number;
}

export interface LifecyclePolicy {
  readonly policyVersion: string;
  readonly profileVersion: string;
  readonly rules: readonly HysteresisRule[];
}

export interface ThesisInvalidationThresholds {
  readonly maximumLiquidityDrawdown: number;
  readonly maximumTopHolderConcentrationRise: number;
  readonly maximumPriceExtension: number;
}

export interface ThesisInvalidationFacts {
  readonly liquidityDrawdown: number | null;
  readonly topHolderConcentrationRise: number | null;
  readonly developerWalletTransfers: boolean;
  readonly independentCohortExits: boolean;
  readonly manipulationRiskHigh: boolean;
  readonly sponsoredSocialConcentration: boolean;
  readonly priceExtension: number | null;
}

export const THESIS_INVALIDATION_CONDITIONS = [
  'LIQUIDITY_DRAWDOWN',
  'TOP_HOLDER_CONCENTRATION_RISE',
  'DEVELOPER_WALLET_TRANSFERS',
  'INDEPENDENT_COHORT_EXITS',
  'MANIPULATION_RISK_HIGH',
  'SPONSORED_SOCIAL_CONCENTRATION',
  'PRICE_EXTENSION_ELIMINATES_RISK_REWARD',
] as const;
export type ThesisInvalidationCondition = (typeof THESIS_INVALIDATION_CONDITIONS)[number];

export interface LifecycleTransitionRequest {
  readonly candidateId: string;
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly reason: string;
  readonly persistence: number | null;
  readonly consecutiveWindows: number;
  readonly dwellSeconds: number;
  readonly tradabilityVerdict: Tradability | null;
  readonly diagnosticSignalLabels: readonly string[];
  readonly invalidationConditions: readonly ThesisInvalidationCondition[];
  readonly transitionedAt: string;
}

export interface LifecycleTransitionRecord extends LifecycleTransitionRequest {
  readonly policyVersion: string;
  readonly profileVersion: string;
  readonly entryIntent: string;
  readonly defaultAction: string;
}

export function defaultLifecyclePolicy(
  policyVersion: string,
  profileVersion: string,
): LifecyclePolicy {
  return {
    policyVersion,
    profileVersion,
    rules: [
      {
        from: 'QUALIFIED',
        to: 'EMERGING',
        direction: 'PROMOTION',
        persistenceThreshold: 0.7,
        comparator: 'GTE',
        consecutiveWindows: 1,
        minimumDwellSeconds: 0,
      },
      {
        from: 'EMERGING',
        to: 'QUALIFIED',
        direction: 'DEMOTION',
        persistenceThreshold: 0.45,
        comparator: 'LT',
        consecutiveWindows: 2,
        minimumDwellSeconds: 0,
      },
    ],
  };
}

export function evaluateThesisInvalidation(
  facts: ThesisInvalidationFacts,
  thresholds: ThesisInvalidationThresholds,
): readonly ThesisInvalidationCondition[] {
  if (
    [
      thresholds.maximumLiquidityDrawdown,
      thresholds.maximumTopHolderConcentrationRise,
      thresholds.maximumPriceExtension,
    ].some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new RangeError('thesis-invalidation thresholds must be non-negative');
  }
  const conditions: ThesisInvalidationCondition[] = [];
  if (
    facts.liquidityDrawdown !== null &&
    facts.liquidityDrawdown > thresholds.maximumLiquidityDrawdown
  ) {
    conditions.push('LIQUIDITY_DRAWDOWN');
  }
  if (
    facts.topHolderConcentrationRise !== null &&
    facts.topHolderConcentrationRise > thresholds.maximumTopHolderConcentrationRise
  ) {
    conditions.push('TOP_HOLDER_CONCENTRATION_RISE');
  }
  if (facts.developerWalletTransfers) conditions.push('DEVELOPER_WALLET_TRANSFERS');
  if (facts.independentCohortExits) conditions.push('INDEPENDENT_COHORT_EXITS');
  if (facts.manipulationRiskHigh) conditions.push('MANIPULATION_RISK_HIGH');
  if (facts.sponsoredSocialConcentration) conditions.push('SPONSORED_SOCIAL_CONCENTRATION');
  if (facts.priceExtension !== null && facts.priceExtension > thresholds.maximumPriceExtension) {
    conditions.push('PRICE_EXTENSION_ELIMINATES_RISK_REWARD');
  }
  return conditions;
}

function validateRule(rule: HysteresisRule): void {
  if (
    !Number.isInteger(rule.consecutiveWindows) ||
    rule.consecutiveWindows < 1 ||
    !Number.isFinite(rule.minimumDwellSeconds) ||
    rule.minimumDwellSeconds < 0
  ) {
    throw new Error('INVALID_HYSTERESIS_RULE');
  }
  if (
    rule.comparator !== 'NONE' &&
    (rule.persistenceThreshold === null ||
      !Number.isFinite(rule.persistenceThreshold) ||
      rule.persistenceThreshold < 0 ||
      rule.persistenceThreshold > 1)
  ) {
    throw new Error('INVALID_HYSTERESIS_THRESHOLD');
  }
}

/**
 * Pure transition seam. A refused transition throws a stable reason code and
 * never mutates diagnostic signal labels.
 */
export function transitionLifecycle(
  request: LifecycleTransitionRequest,
  policy: LifecyclePolicy,
): LifecycleTransitionRecord {
  if (policy.policyVersion.trim() === '' || policy.profileVersion.trim() === '') {
    throw new Error('LIFECYCLE_POLICY_VERSION_REQUIRED');
  }
  if (!ALLOWED_TRANSITIONS[request.from].includes(request.to)) {
    throw new Error('LIFECYCLE_TRANSITION_NOT_ALLOWED');
  }
  if (request.candidateId.trim() === '' || request.reason.trim() === '') {
    throw new Error('LIFECYCLE_TRANSITION_REASON_REQUIRED');
  }
  if (
    !Number.isInteger(request.consecutiveWindows) ||
    request.consecutiveWindows < 0 ||
    !Number.isFinite(request.dwellSeconds) ||
    request.dwellSeconds < 0
  ) {
    throw new Error('INVALID_TRANSITION_OBSERVATION');
  }
  const rule = policy.rules.find(
    (candidate) => candidate.from === request.from && candidate.to === request.to,
  );
  if (rule) {
    validateRule(rule);
    if (request.dwellSeconds < rule.minimumDwellSeconds) throw new Error('MINIMUM_DWELL_NOT_MET');
    if (request.consecutiveWindows < rule.consecutiveWindows) {
      throw new Error('CONSECUTIVE_WINDOWS_NOT_MET');
    }
    if (rule.comparator !== 'NONE') {
      if (request.persistence === null || !Number.isFinite(request.persistence)) {
        throw new Error('PERSISTENCE_REQUIRED');
      }
      if (
        (rule.comparator === 'GTE' &&
          request.persistence < (rule.persistenceThreshold as number)) ||
        (rule.comparator === 'LT' && request.persistence >= (rule.persistenceThreshold as number))
      ) {
        throw new Error('HYSTERESIS_THRESHOLD_NOT_MET');
      }
    }
  }
  if (
    request.to === 'CONFIRMED' &&
    (request.tradabilityVerdict === null ||
      tradabilityVerdict(request.tradabilityVerdict) !== TradabilityVerdict.TRADABLE)
  ) {
    throw new Error('CONFIRMED_REQUIRES_TRADABLE');
  }
  if (
    (request.to === 'CONFIRMED' || request.to === 'MONITORING') &&
    request.invalidationConditions.length === 0
  ) {
    throw new Error('THESIS_INVALIDATION_CONDITIONS_REQUIRED');
  }
  if (
    !Number.isFinite(Date.parse(request.transitionedAt)) ||
    !request.transitionedAt.endsWith('Z')
  ) {
    throw new Error('TRANSITION_TIMESTAMP_INVALID');
  }
  const lifecycleDefault = LIFECYCLE_DEFAULTS.find((entry) => entry.state === request.to);
  if (!lifecycleDefault) throw new Error('UNKNOWN_LIFECYCLE_STATE');
  return {
    ...request,
    diagnosticSignalLabels: [...request.diagnosticSignalLabels],
    invalidationConditions: [...request.invalidationConditions],
    policyVersion: policy.policyVersion,
    profileVersion: policy.profileVersion,
    entryIntent: lifecycleDefault.entryIntent,
    defaultAction: lifecycleDefault.defaultAction,
  };
}
