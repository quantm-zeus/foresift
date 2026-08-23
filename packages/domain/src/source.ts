/**
 * Source identity, upstream lineage, and independence groups (FR-DATA-006,
 * §11.7, ADR-052, INV-008: provider count is not source independence).
 */
import { ErrorCode, ForesiftError } from './errors.ts';

declare const brand: unique symbol;
export type SourceIdentityId = string & { readonly [brand]: 'SourceIdentityId' };

/**
 * A source identity distinguishes brand/provider × operation × upstream
 * lineage key × endpoint/region × collection method. Two providers sharing an
 * upstream lineage are NOT independent (INV-008).
 */
export interface SourceIdentity {
  readonly id: SourceIdentityId;
  /** Brand/provider of the fronting service. */
  readonly brandProvider: string;
  /** The specific operation requested. */
  readonly operation: string;
  /**
   * Declared upstream lineage key — the ultimate data origin this source
   * resells/re-serves. Distinct brand/providers with the same key collapse
   * into one independence group.
   */
  readonly upstreamLineageKey: string;
  readonly endpointRegion: string;
  readonly collectionMethod: CollectionMethod;
}

export const CollectionMethod = {
  POLLING_API: 'POLLING_API',
  AUTHORIZED_PUSH: 'AUTHORIZED_PUSH',
  FIRST_PARTY_COLLECTOR: 'FIRST_PARTY_COLLECTOR',
  MANUAL_IMPORT: 'MANUAL_IMPORT',
} as const;

export type CollectionMethod = (typeof CollectionMethod)[keyof typeof CollectionMethod];

/** Independence group whose members share one upstream lineage. */
export interface IndependenceGroup {
  readonly id: string;
  readonly upstreamLineageKey: string;
}

export interface SourceGroupMembership {
  readonly groupId: string;
  readonly sourceIdentityId: SourceIdentityId;
}

/** How a dependence edge's inputs were obtained relative to a replay time. */
export const DependenceLabel = {
  /**
   * Inputs were all available at the edge's available_at — usable in replay
   * as evidence about that time.
   */
  AVAILABLE_AT_THE_TIME: 'AVAILABLE_AT_THE_TIME',
  /**
   * Computed later from data not available then — diagnostic only; can never
   * alter frozen historical counts (AC-247).
   */
  DIAGNOSTIC_RETROSPECTIVE: 'DIAGNOSTIC_RETROSPECTIVE',
} as const;

export type DependenceLabel = (typeof DependenceLabel)[keyof typeof DependenceLabel];

/** Observed correlation inputs for a pairwise empirical-dependence edge. */
export interface DependenceObservationInputs {
  /** Correlation of value/error timing across the pair, in [-1, 1]. */
  readonly valueErrorTimingCorrelation: number;
  /** Overlap fraction of observed outages, in [0, 1]. */
  readonly outageOverlap: number;
  /** Fraction of first-seen behaviors within bounded lag, in [0, 1]. */
  readonly firstSeenLagAgreement: number;
  /** Payload/fingerprint similarity, in [0, 1]. */
  readonly fingerprintSimilarity: number;
}

/** Pairwise empirical-dependence edge (ADR-052). */
export interface SourceDependenceEdge {
  readonly sourceA: SourceIdentityId;
  readonly sourceB: SourceIdentityId;
  /** The declared lineage relationship assumed when interpreting inputs. */
  readonly sharedUpstreamLineageKeys: readonly string[];
  readonly inputs: DependenceObservationInputs;
  readonly label: DependenceLabel;
  /** Earliest time this edge estimate was available to the system. */
  readonly availableAt: string;
}

/** Thresholds at or above which a pair receives reduced independence credit (AC-245). */
export interface DependenceThresholds {
  readonly correlation: number;
  readonly outageOverlap: number;
  readonly firstSeenLagAgreement: number;
  readonly fingerprintSimilarity: number;
}

export const DEFAULT_DEPENDENCE_THRESHOLDS: DependenceThresholds = {
  correlation: 0.8,
  outageOverlap: 0.5,
  firstSeenLagAgreement: 0.7,
  fingerprintSimilarity: 0.9,
};

function inRange(value: number, name: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ForesiftError(
      ErrorCode.SOURCE_DEPENDENCE_INPUT_INVALID,
      `dependence input ${name} out of range`,
      { name, value },
    );
  }
}

/** Validate correlation inputs; refuse NaN/out-of-range rather than coercing. */
export function assertDependenceInputs(inputs: DependenceObservationInputs): void {
  inRange(inputs.valueErrorTimingCorrelation, 'valueErrorTimingCorrelation', -1, 1);
  inRange(inputs.outageOverlap, 'outageOverlap', 0, 1);
  inRange(inputs.firstSeenLagAgreement, 'firstSeenLagAgreement', 0, 1);
  inRange(inputs.fingerprintSimilarity, 'fingerprintSimilarity', 0, 1);
}

/**
 * Whether stored inputs justify recording REDUCED empirical independence
 * despite distinct provider ids (AC-245): strongly correlated timing/values,
 * outages, or fingerprints each suffice.
 */
export function inputsJustifyReducedIndependence(
  inputs: DependenceObservationInputs,
  thresholds: DependenceThresholds = DEFAULT_DEPENDENCE_THRESHOLDS,
): boolean {
  return (
    inputs.valueErrorTimingCorrelation >= thresholds.correlation ||
    inputs.outageOverlap >= thresholds.outageOverlap ||
    inputs.firstSeenLagAgreement >= thresholds.firstSeenLagAgreement ||
    inputs.fingerprintSimilarity >= thresholds.fingerprintSimilarity
  );
}
