/**
 * §13.8 evidence acquisition state vocabulary (FR-DATA-005, FR-DATA-003;
 * AC-242, AC-243).
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
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  RIGHTS_BLOCKED: 'RIGHTS_BLOCKED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  TIMED_OUT: 'TIMED_OUT',
  RETURNED: 'RETURNED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const;

export type AcquisitionState = (typeof AcquisitionState)[keyof typeof AcquisitionState];

export const ALL_ACQUISITION_STATES: readonly AcquisitionState[] = Object.values(AcquisitionState);

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

/** States where retrieval was attempted but produced nothing usable. */
const RETRIEVAL_FAILED_STATES: readonly AcquisitionState[] = [
  AcquisitionState.COST_BLOCKED,
  AcquisitionState.QUOTA_BLOCKED,
  AcquisitionState.CAPABILITY_UNAVAILABLE,
  AcquisitionState.RIGHTS_BLOCKED,
  AcquisitionState.PROVIDER_UNAVAILABLE,
  AcquisitionState.TIMED_OUT,
  AcquisitionState.INVALID_RESPONSE,
];

/** States where retrieval completed successfully enough to attach evidence. */
export const RETRIEVAL_SUCCEEDED_STATES: readonly AcquisitionState[] = [AcquisitionState.RETURNED];

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
  readonly state: AcquisitionState;
  readonly requestedAt?: string;
  readonly completedAt?: string;
  readonly assignmentProbability?: number;
  readonly estimatedDecisionImpact?: number;
  readonly estimatedInformationValue?: number;
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
