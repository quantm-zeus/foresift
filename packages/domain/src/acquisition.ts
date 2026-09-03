/**
 * §13.8 evidence acquisition state vocabulary (AC-242, AC-243; consumed by
 * FR-DATA-005 quality states and FR-DATA-003 availability semantics).
 *
 * Storage semantics that later layers rely on:
 * - `NOT_REQUESTED_BY_POLICY` is not provider missingness; it is never imputed
 *   as a negative feature value and never rendered as RETURNED_EMPTY or
 *   PROVIDER_UNAVAILABLE.
 * - Randomized probes store a nonzero assignment probability BEFORE retrieval.
 */
import { ErrorCode, ForesiftError } from './errors.ts';

/** The exact §13.8 acquisition-state vocabulary. */
export const AcquisitionState = {
  NOT_REQUESTED_BY_POLICY: 'NOT_REQUESTED_BY_POLICY',
  REQUESTED: 'REQUESTED',
  COST_BLOCKED: 'COST_BLOCKED',
  QUOTA_BLOCKED: 'QUOTA_BLOCKED',
  RIGHTS_BLOCKED: 'RIGHTS_BLOCKED',
  UNSUPPORTED: 'UNSUPPORTED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  FAILED: 'FAILED',
  RETURNED_EMPTY: 'RETURNED_EMPTY',
  RETURNED: 'RETURNED',
  /** @deprecated Use UNSUPPORTED; retained as a source-compatibility alias. */
  CAPABILITY_UNAVAILABLE: 'UNSUPPORTED',
  /** @deprecated Use FAILED with failureKind TIMED_OUT. */
  TIMED_OUT: 'FAILED',
  /** @deprecated Use FAILED with failureKind INVALID_RESPONSE. */
  INVALID_RESPONSE: 'FAILED',
} as const;

export type AcquisitionState = (typeof AcquisitionState)[keyof typeof AcquisitionState];

export const ALL_ACQUISITION_STATES: readonly AcquisitionState[] = [
  AcquisitionState.NOT_REQUESTED_BY_POLICY,
  AcquisitionState.REQUESTED,
  AcquisitionState.COST_BLOCKED,
  AcquisitionState.QUOTA_BLOCKED,
  AcquisitionState.RIGHTS_BLOCKED,
  AcquisitionState.UNSUPPORTED,
  AcquisitionState.PROVIDER_UNAVAILABLE,
  AcquisitionState.FAILED,
  AcquisitionState.RETURNED_EMPTY,
  AcquisitionState.RETURNED,
];

/** Fail-closed resolution of an external state string. */
export function acquisitionState(value: string): AcquisitionState {
  const state = (ALL_ACQUISITION_STATES as readonly string[]).includes(value)
    ? (value as AcquisitionState)
    : undefined;
  if (state === undefined) {
    throw new ForesiftError(ErrorCode.ACQUISITION_STATE_UNKNOWN, 'unknown acquisition state', {
      value,
    });
  }
  return state;
}

/** States in which no retrieval ever happened because policy chose not to ask. */
const NOT_RETRIEVED_BY_CHOICE: readonly AcquisitionState[] = [
  AcquisitionState.NOT_REQUESTED_BY_POLICY,
];

/**
 * States where no usable output was produced — covering BOTH sub-kinds:
 * pre-flight refusals decided by this system before dispatch
 * (COST_BLOCKED, QUOTA_BLOCKED, UNSUPPORTED, RIGHTS_BLOCKED are
 * self-imposed budget/rights/capacity choices, NOT provider failures) and
 * genuine attempted-retrieval failures (PROVIDER_UNAVAILABLE, FAILED).
 * RETURNED_EMPTY is a completed provider result, not a retrieval failure.
 * Rendering the first sub-kind as provider missingness is
 * exactly the confusion AC-242 guards against.
 */
export const RETRIEVAL_FAILED_STATES: readonly AcquisitionState[] = [
  AcquisitionState.COST_BLOCKED,
  AcquisitionState.QUOTA_BLOCKED,
  AcquisitionState.UNSUPPORTED,
  AcquisitionState.RIGHTS_BLOCKED,
  AcquisitionState.PROVIDER_UNAVAILABLE,
  AcquisitionState.FAILED,
];

/** States where retrieval completed successfully enough to attach evidence. */
export const RETRIEVAL_SUCCEEDED_STATES: readonly AcquisitionState[] = [
  AcquisitionState.RETURNED_EMPTY,
  AcquisitionState.RETURNED,
];

export const AcquisitionFailureKind = {
  TIMED_OUT: 'TIMED_OUT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const;

export type AcquisitionFailureKind =
  (typeof AcquisitionFailureKind)[keyof typeof AcquisitionFailureKind];

export const ALL_ACQUISITION_FAILURE_KINDS: readonly AcquisitionFailureKind[] =
  Object.values(AcquisitionFailureKind);

export function acquisitionFailureKind(value: string): AcquisitionFailureKind {
  if (!(ALL_ACQUISITION_FAILURE_KINDS as readonly string[]).includes(value)) {
    throw new ForesiftError(
      ErrorCode.ACQUISITION_FAILURE_KIND_UNKNOWN,
      'unknown acquisition failure kind',
      { value },
    );
  }
  return value as AcquisitionFailureKind;
}

export type LegacyAcquisitionState =
  'CAPABILITY_UNAVAILABLE' | 'TIMED_OUT' | 'INVALID_RESPONSE' | AcquisitionState;

export interface ReconciledAcquisitionMember {
  readonly state: AcquisitionState;
  readonly failureKind: AcquisitionFailureKind | null;
}

/**
 * Lossless ADR-1 mapping. Callers migrating stored members must use this
 * helper rather than changing only the state column: the two retired failure
 * members carry their former diagnostic meaning into `failureKind`.
 */
export function reconcileLegacyAcquisitionMember(
  value: LegacyAcquisitionState,
): ReconciledAcquisitionMember {
  switch (value) {
    case 'CAPABILITY_UNAVAILABLE':
      return { state: AcquisitionState.UNSUPPORTED, failureKind: null };
    case 'TIMED_OUT':
      return {
        state: AcquisitionState.FAILED,
        failureKind: AcquisitionFailureKind.TIMED_OUT,
      };
    case 'INVALID_RESPONSE':
      return {
        state: AcquisitionState.FAILED,
        failureKind: AcquisitionFailureKind.INVALID_RESPONSE,
      };
    default:
      return { state: acquisitionState(value), failureKind: null };
  }
}

/** Explicit member-level migration required by the reconciled G1 vocabulary. */
export function mapLegacyAcquisitionState(value: LegacyAcquisitionState): AcquisitionState {
  return reconcileLegacyAcquisitionMember(value).state;
}

/** Return the failure-kind channel produced by the ADR-1 member mapping. */
export function mapLegacyAcquisitionFailureKind(
  value: LegacyAcquisitionState,
): AcquisitionFailureKind | null {
  return reconcileLegacyAcquisitionMember(value).failureKind;
}

/** True iff the family was never requested by policy (AC-242 semantics). */
export function acquisitionIsNotRequestedByPolicy(state: AcquisitionState): boolean {
  return NOT_RETRIEVED_BY_CHOICE.includes(state);
}

/** True iff retrieval was attempted but failed/blocked before usable output. */
export function isRetrievalFailure(state: AcquisitionState): boolean {
  return RETRIEVAL_FAILED_STATES.includes(state);
}

/** True iff the record represents an outcome-matured terminal decision. */
export function isTerminalAcquisition(state: AcquisitionState): boolean {
  return (
    state === AcquisitionState.NOT_REQUESTED_BY_POLICY ||
    RETRIEVAL_FAILED_STATES.includes(state) ||
    state === AcquisitionState.RETURNED_EMPTY ||
    state === AcquisitionState.RETURNED
  );
}

/**
 * §13.8 record as stored. Optional fields are genuinely optional per the PRD
 * interface; the write-before-retrieval ordering (AC-243) constrains WHEN they
 * may be present, enforced by the persistence contract:
 * - a randomized probe (`randomizedProbe: true`) must persist
 *   `assignmentProbability > 0` and seed provenance before any retrieval;
 * - `completedAt` requires prior `requestedAt` + assignment fields.
 */
export interface EvidenceAcquisitionDecision {
  readonly id: string;
  readonly candidateId: string;
  readonly evidenceFamily: string;
  readonly policyVersion: string;
  readonly state: AcquisitionState;
  readonly candidateStateAtRequest?: string;
  readonly requestedFields?: readonly string[];
  readonly expectedValueOfInformation?: number;
  readonly estimatedCost?: AcquisitionCost;
  readonly actualCost?: AcquisitionCost;
  readonly failureKind?: AcquisitionFailureKind | null;
  readonly acquisitionSeed?: string;
  readonly requestedAt?: string;
  readonly completedAt?: string;
  readonly assignmentProbability?: number;
  readonly estimatedDecisionImpact?: number;
  readonly estimatedInformationValue?: number;
  readonly actualDecisionChanged?: boolean;
  readonly evidenceIds: readonly string[];
}

export interface AcquisitionCost {
  readonly amount: string;
  readonly token: string;
}

/** Deterministic probe-assignment fields persisted before retrieval (AC-243). */
export interface ProbeAssignment {
  /** Eligibility stratum the candidate was assigned to before retrieval. */
  readonly eligibilityStratum: string;
  /** Strictly between 0 and 1; zero-probability assignments are refusals. */
  readonly assignmentProbability: number;
  /** Provenance of the random seed (algorithm + material reference), never the raw secret. */
  readonly seedProvenance: string;
  /** When the selection happened. */
  readonly selectionAt: string;
  /** Requested field list fixed at selection time. */
  readonly requestedFields: readonly string[];
}
