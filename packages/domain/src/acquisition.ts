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
  /** @deprecated Reconciled into UNSUPPORTED. */
  CAPABILITY_UNAVAILABLE: 'UNSUPPORTED',
  /** @deprecated Reconciled into FAILED. */
  TIMED_OUT: 'FAILED',
  /** @deprecated Reconciled into FAILED. */
  INVALID_RESPONSE: 'FAILED',
} as const;

export type AcquisitionState = (typeof AcquisitionState)[keyof typeof AcquisitionState];

export const ALL_ACQUISITION_STATES: readonly AcquisitionState[] = [
  'NOT_REQUESTED_BY_POLICY',
  'REQUESTED',
  'COST_BLOCKED',
  'QUOTA_BLOCKED',
  'RIGHTS_BLOCKED',
  'UNSUPPORTED',
  'PROVIDER_UNAVAILABLE',
  'FAILED',
  'RETURNED_EMPTY',
  'RETURNED',
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
 * genuine attempted-retrieval failures (PROVIDER_UNAVAILABLE, FAILED,
 * RETURNED_EMPTY). Rendering the first sub-kind as provider missingness is
 * exactly the confusion AC-242 guards against.
 */
const RETRIEVAL_FAILED_STATES: readonly AcquisitionState[] = [
  AcquisitionState.COST_BLOCKED,
  AcquisitionState.QUOTA_BLOCKED,
  AcquisitionState.UNSUPPORTED,
  AcquisitionState.RIGHTS_BLOCKED,
  AcquisitionState.PROVIDER_UNAVAILABLE,
  AcquisitionState.FAILED,
  AcquisitionState.RETURNED_EMPTY,
];

/** States where retrieval completed successfully enough to attach evidence. */
export const RETRIEVAL_SUCCEEDED_STATES: readonly AcquisitionState[] = [AcquisitionState.RETURNED];

export const AcquisitionFailureKind = {
  COST_LIMIT: 'COST_LIMIT',
  QUOTA_LIMIT: 'QUOTA_LIMIT',
  RIGHTS_POLICY: 'RIGHTS_POLICY',
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  REQUEST_FAILED: 'REQUEST_FAILED',
  EMPTY_RESULT: 'EMPTY_RESULT',
} as const;

export type AcquisitionFailureKind =
  (typeof AcquisitionFailureKind)[keyof typeof AcquisitionFailureKind];

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
  readonly candidateStateAtRequest?: Readonly<Record<string, unknown>>;
  readonly state: AcquisitionState;
  readonly requestedFields?: readonly string[];
  readonly requestedAt?: string;
  readonly completedAt?: string;
  readonly assignmentProbability?: number;
  readonly estimatedDecisionImpact?: number;
  readonly estimatedInformationValue?: number;
  readonly estimatedCost?: number;
  readonly actualCost?: number;
  readonly seedProvenance?: string;
  readonly failureKind?: AcquisitionFailureKind;
  readonly actualDecisionChanged?: boolean;
  readonly evidenceIds: readonly string[];
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
