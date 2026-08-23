/**
 * Feature-value records with full provenance (FR-DATA-004, AC-244 substrate).
 *
 * Every stored feature value carries feature version, event time,
 * computation code version, and population/lineage provenance — the fields
 * later selection-adjustment and lift-claim checks consume.
 */
import { ErrorCode, FeatureError } from './errors.ts';
import type { UtcTimestamp } from './timestamps.ts';
import type { QualityCode } from './quality.ts';

declare const brand: unique symbol;
export type FeatureDefinitionId = string & { readonly [brand]: 'FeatureDefinitionId' };

/** Which store class a value lives in (§14.3 online / §14.4 offline). */
export const FeatureStoreClass = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
} as const;

export type FeatureStoreClass = (typeof FeatureStoreClass)[keyof typeof FeatureStoreClass];

/** A versioned feature definition. */
export interface FeatureDefinition {
  readonly id: FeatureDefinitionId;
  readonly name: string;
  readonly version: number;
  /** Description of units/scale for the value. */
  readonly unitSemantics: string;
}

/**
 * Population/lineage provenance of a feature value (AC-244): records WHICH
 * population produced it so selectively-deep-researched candidates cannot
 * back full-universe lift claims later.
 */
export interface PopulationProvenance {
  /**
   * How the subject population was selected for this value's computation
   * batch, e.g. FULL_UNIVERSE or DEEP_RESEARCH_SELECTED.
   */
  readonly populationKind:
    'FULL_UNIVERSE' | 'DEEP_RESEARCH_SELECTED' | 'CONTROL_GROUP' | 'EXPLORATION_ARM';
  /** Upstream evidence lineage references used by the computation. */
  readonly lineageRefs: readonly string[];
}

/** One stored feature value. Values are decimal strings at documented scale. */
export interface FeatureValue {
  readonly definitionId: FeatureDefinitionId;
  readonly featureVersion: number;
  /** Identity of the exact computation code that produced this value. */
  readonly computationCodeVersion: string;
  /** Subject of the feature (asset/candidate/pool identity key). */
  readonly subjectKey: string;
  /** Event time the value is about (never ingestion time). */
  readonly eventAt: UtcTimestamp;
  /** Decimal-string value at `DecimalValue.scale` fractional digits; absent when null-coded. */
  readonly value?: DecimalValue;
  /** Quality codes explaining any absence/imprecision — null alone is insufficient. */
  readonly qualityCodes: readonly QualityCode[];
  readonly populationProvenance: PopulationProvenance;
  readonly storeClass: FeatureStoreClass;
}

export interface DecimalValue {
  readonly decimalString: string;
  readonly scale: number;
}

/**
 * Substrate-level refusal used by lift/lift-claim queries (AC-244 negative):
 * a feature value lacking provenance fields can never back a full-universe
 * claim. Returns true when the record is usable as claim support.
 */
export function supportsPopulationClaim(value: FeatureValue): boolean {
  if (value.computationCodeVersion.length === 0 || value.featureVersion < 1) {
    throw new FeatureError(
      'feature value lacks code/version provenance required for claims',
      { definitionId: value.definitionId, subjectKey: value.subjectKey },
      ErrorCode.FEATURE_PROVENANCE_INCOMPLETE,
    );
  }
  if (value.populationProvenance.lineageRefs.length === 0) {
    return false;
  }
  return value.populationProvenance.populationKind === 'FULL_UNIVERSE';
}
