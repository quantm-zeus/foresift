import { ReserveClass } from '@foresift/domain';

export const STANDARD_RECHECK_INTERVAL_SECONDS = [300, 900, 1_800, 3_600] as const;

export interface RecheckBudget {
  readonly max_rechecks: number;
  readonly max_recheck_provider_calls: number;
  readonly max_recheck_model_cost: number;
  readonly next_check_at: string;
  readonly expires_at: string;
  readonly backoff_factor: number;
  readonly minimum_expected_information_gain: number;
}

export interface RecheckBudgetState extends RecheckBudget {
  readonly rechecks_used: number;
  readonly provider_calls_used: number;
  readonly model_cost_used: number;
  readonly starved_since: string | null;
}

export interface InformationValueInput {
  readonly estimatedDecisionImpact: number;
  readonly materialStateChangeProbability: number;
  readonly evidenceReliability: number;
  readonly incrementalIndependenceValue: number;
  readonly totalNormalizedResourceCost: number;
  readonly epsilon: number;
}

/** §62.7 allocation aid only. This type is intentionally absent from selection.ts. */
export interface AllocationAidInformationValue {
  readonly allocationAidOnly: true;
  readonly value: number;
}

export function informationValue(input: InformationValueInput): AllocationAidInformationValue {
  const probabilityFactors = [
    input.materialStateChangeProbability,
    input.evidenceReliability,
    input.incrementalIndependenceValue,
  ];
  if (
    !Number.isFinite(input.estimatedDecisionImpact) ||
    input.estimatedDecisionImpact < 0 ||
    probabilityFactors.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
    !Number.isFinite(input.totalNormalizedResourceCost) ||
    input.totalNormalizedResourceCost < 0 ||
    !Number.isFinite(input.epsilon) ||
    input.epsilon <= 0
  ) {
    throw new RangeError('invalid information-value inputs');
  }
  return {
    allocationAidOnly: true,
    value:
      (input.estimatedDecisionImpact *
        probabilityFactors.reduce((product, factor) => product * factor, 1)) /
      Math.max(input.totalNormalizedResourceCost, input.epsilon),
  };
}

export type RecheckDecisionKind =
  | 'RECHECK_NOW'
  | 'DEFER_BACKOFF'
  | 'STARVED_SKIP'
  | 'EXPIRED_STOP'
  | 'BUDGET_EXHAUSTED_STOP'
  | 'INFO_VALUE_BELOW_FLOOR_SKIP';

export interface RecheckRequest {
  readonly candidateId: string;
  readonly profileVersion: string;
  readonly decidedAt: string;
  readonly requestedProviderCalls: number;
  readonly requestedModelCost: number;
  readonly intervalSeconds: number;
  readonly starvationLimitSeconds: number;
  readonly allocationAid: AllocationAidInformationValue;
  readonly capacityAvailable: boolean;
}

export interface RecheckDecision {
  readonly candidateId: string;
  readonly profileVersion: string;
  readonly decidedAt: string;
  readonly decision: RecheckDecisionKind;
  readonly reason: string;
  readonly informationValue: number;
  readonly providerCallsCosted: number;
  readonly modelCostCosted: number;
  readonly protectedReserveClass: typeof ReserveClass.SCHEDULED_CANDIDATE_VERIFICATION;
  readonly nextBudgetState: RecheckBudgetState;
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith('Z'))
    throw new RangeError(`${field} must be an ISO-8601 Z timestamp`);
  return parsed;
}

export function validateRecheckBudget(state: RecheckBudgetState): RecheckBudgetState {
  const integerFields = [
    state.max_rechecks,
    state.max_recheck_provider_calls,
    state.rechecks_used,
    state.provider_calls_used,
  ];
  if (integerFields.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new RangeError('recheck counts must be non-negative integers');
  }
  if (
    !Number.isFinite(state.max_recheck_model_cost) ||
    state.max_recheck_model_cost < 0 ||
    !Number.isFinite(state.model_cost_used) ||
    state.model_cost_used < 0 ||
    !Number.isFinite(state.backoff_factor) ||
    state.backoff_factor <= 1 ||
    !Number.isFinite(state.minimum_expected_information_gain) ||
    state.minimum_expected_information_gain < 0
  ) {
    throw new RangeError('invalid recheck budget');
  }
  if (
    timestamp(state.expires_at, 'expires_at') <= timestamp(state.next_check_at, 'next_check_at')
  ) {
    throw new Error('RECHECK_EXPIRY_MUST_FOLLOW_NEXT_CHECK');
  }
  if (state.starved_since !== null) timestamp(state.starved_since, 'starved_since');
  if (
    state.rechecks_used > state.max_rechecks ||
    state.provider_calls_used > state.max_recheck_provider_calls ||
    state.model_cost_used > state.max_recheck_model_cost
  ) {
    throw new Error('RECHECK_BUDGET_STATE_OVERRUN');
  }
  return state;
}

function decision(
  request: RecheckRequest,
  state: RecheckBudgetState,
  kind: RecheckDecisionKind,
  reason: string,
  nextBudgetState: RecheckBudgetState = state,
  providerCallsCosted = 0,
  modelCostCosted = 0,
): RecheckDecision {
  return {
    candidateId: request.candidateId,
    profileVersion: request.profileVersion,
    decidedAt: request.decidedAt,
    decision: kind,
    reason,
    informationValue: request.allocationAid.value,
    providerCallsCosted,
    modelCostCosted,
    protectedReserveClass: ReserveClass.SCHEDULED_CANDIDATE_VERIFICATION,
    nextBudgetState,
  };
}

/** Pure finite-budget scheduler: `decidedAt` is supplied, never read from a clock. */
export function decideRecheck(
  budget: RecheckBudgetState,
  request: RecheckRequest,
): RecheckDecision {
  const state = validateRecheckBudget(budget);
  const now = timestamp(request.decidedAt, 'decidedAt');
  const expires = timestamp(state.expires_at, 'expires_at');
  const next = timestamp(state.next_check_at, 'next_check_at');
  if (
    request.candidateId.trim() === '' ||
    request.profileVersion.trim() === '' ||
    !Number.isInteger(request.requestedProviderCalls) ||
    request.requestedProviderCalls < 0 ||
    !Number.isFinite(request.requestedModelCost) ||
    request.requestedModelCost < 0 ||
    !Number.isInteger(request.intervalSeconds) ||
    request.intervalSeconds <= 0 ||
    !Number.isInteger(request.starvationLimitSeconds) ||
    request.starvationLimitSeconds < 0 ||
    !Number.isFinite(request.allocationAid.value) ||
    request.allocationAid.value < 0
  ) {
    throw new RangeError('invalid recheck request');
  }
  if (now >= expires)
    return decision(request, state, 'EXPIRED_STOP', 'candidate recheck budget expired');
  if (
    state.rechecks_used >= state.max_rechecks ||
    state.provider_calls_used + request.requestedProviderCalls > state.max_recheck_provider_calls ||
    state.model_cost_used + request.requestedModelCost > state.max_recheck_model_cost
  ) {
    return decision(request, state, 'BUDGET_EXHAUSTED_STOP', 'finite recheck budget exhausted');
  }
  if (request.allocationAid.value < state.minimum_expected_information_gain) {
    return decision(
      request,
      state,
      'INFO_VALUE_BELOW_FLOOR_SKIP',
      'information value below configured minimum',
    );
  }
  if (state.starved_since !== null) {
    const starvedFor = (now - timestamp(state.starved_since, 'starved_since')) / 1_000;
    if (starvedFor >= request.starvationLimitSeconds) {
      return decision(request, state, 'STARVED_SKIP', 'starvation limit reached; recheck stopped');
    }
  }
  if (now < next || !request.capacityAvailable) {
    const starvedSince = request.capacityAvailable
      ? state.starved_since
      : (state.starved_since ?? request.decidedAt);
    const delayedSeconds = Math.round(
      request.intervalSeconds * state.backoff_factor ** state.rechecks_used,
    );
    const backedOffAt = new Date(Math.min(expires - 1, now + delayedSeconds * 1_000)).toISOString();
    return decision(
      request,
      state,
      'DEFER_BACKOFF',
      request.capacityAvailable ? 'next check is not due' : 'capacity unavailable; backoff applied',
      {
        ...state,
        next_check_at: backedOffAt,
        starved_since: starvedSince,
      },
    );
  }
  const nextRechecksUsed = state.rechecks_used + 1;
  const delayedSeconds = Math.round(
    request.intervalSeconds * state.backoff_factor ** nextRechecksUsed,
  );
  const nextCheckAt = new Date(Math.min(expires - 1, now + delayedSeconds * 1_000)).toISOString();
  const nextState: RecheckBudgetState = {
    ...state,
    rechecks_used: nextRechecksUsed,
    provider_calls_used: state.provider_calls_used + request.requestedProviderCalls,
    model_cost_used: state.model_cost_used + request.requestedModelCost,
    next_check_at: nextCheckAt,
    starved_since: null,
  };
  return decision(
    request,
    state,
    'RECHECK_NOW',
    'due, informative, admitted, and within finite budget',
    nextState,
    request.requestedProviderCalls,
    request.requestedModelCost,
  );
}
