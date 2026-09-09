/**
 * Discovery coverage vocabularies and pure laws (T001, FR-DISC-006…014).
 *
 * The nine closed §63.12 vocabularies live in `errors.ts` (landed with the
 * DISC_* error-code block — they are shared with schemas, persistence, and
 * telemetry through `@foresift/domain`'s entrypoint). This module is the
 * domain home for the *behavioral* half of the discovery contract:
 *
 *  - fail-closed `parse*` functions per vocabulary (unknown member ⇒
 *    `DiscError` with the stable `DISC_*_UNKNOWN` code, never a silent
 *    default — PRD vocabulary law);
 *  - the §63.2/§63.6/§63.7/§63.12-derived classification objects the
 *    colocated suites pin (`DiscoverySourceClass`, `CoveragePopulationClass`,
 *    `CheapMonitorDecision`, `CheapMonitorState`, `UniverseEntryReason`,
 *    `PopulationConstraintKind`, `PopulationConstraintEffect`,
 *    `RecallClaimBasis`, `ChainAccessMode`);
 *  - the four pure laws:
 *      `recallClaimBasisAdmissible`        (FR-DISC-010)
 *      `selfRecallRefused`                 (FR-DISC-010)
 *      `constraintBlocksPublication`       (FR-DISC-013)
 *      `fullMarketLanguageSubstantiated`   (FR-DISC-014)
 *
 * Pure, deterministic, zero I/O — every decision here is readable straight
 * from the arguments, mirroring the rest of the domain package.
 */
import {
  ALL_DISC_CHAIN_ACCESS_PURPOSES,
  ALL_DISC_CLAIM_BASES,
  ALL_DISC_CONSTRAINT_EFFECTS,
  ALL_DISC_CONSTRAINT_KINDS,
  ALL_DISC_ENTRY_REASONS,
  ALL_DISC_LATENESS_BASES,
  ALL_DISC_MANIPULATION_POLICIES,
  ALL_DISC_RECALL_VERDICTS,
  ALL_DISC_RIGHTS_BASES,
  DiscError,
  ErrorCode,
} from './errors.ts';

/** The string-literal union of a §63.12 discovery entry reason. */
type DiscEntryReasonValue = (typeof ALL_DISC_ENTRY_REASONS)[number];

// Re-exported so consumers can import the full discovery vocabulary surface
// from this module without reaching into errors.ts internals.
export {
  ALL_DISC_CHAIN_ACCESS_PURPOSES,
  ALL_DISC_CLAIM_BASES,
  ALL_DISC_CONSTRAINT_EFFECTS,
  ALL_DISC_CONSTRAINT_KINDS,
  ALL_DISC_ENTRY_REASONS,
  ALL_DISC_LATENESS_BASES,
  ALL_DISC_MANIPULATION_POLICIES,
  ALL_DISC_RECALL_VERDICTS,
  ALL_DISC_RIGHTS_BASES,
} from './errors.ts';
export {
  DiscChainAccessPurpose,
  DiscClaimBasis,
  DiscConstraintEffect,
  DiscConstraintKind,
  DiscEntryReason,
  DiscLatenessBasis,
  DiscManipulationPolicy,
  DiscRecallVerdict,
  DiscRightsBasis,
} from './errors.ts';

// ── §63.2 source classes ─────────────────────────────────────────────────────

/** Closed classification of every discovery source (PRD §63.2). */
export const DiscoverySourceClass = {
  FIRST_PARTY_SUPPORTED_PROGRAM_EVENT: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  FREE_AGGREGATE_DISCOVERY: 'FREE_AGGREGATE_DISCOVERY',
  AUTHORIZED_LAUNCH_FEED: 'AUTHORIZED_LAUNCH_FEED',
  USER_WATCHLIST_OR_MCP: 'USER_WATCHLIST_OR_MCP',
  AUTHORIZED_SOCIAL_AGGREGATE: 'AUTHORIZED_SOCIAL_AGGREGATE',
  SELECTIVE_CHAIN_VERIFICATION: 'SELECTIVE_CHAIN_VERIFICATION',
  RETROSPECTIVE_UNIVERSE_ENUMERATION: 'RETROSPECTIVE_UNIVERSE_ENUMERATION',
  STRATIFIED_UNIVERSE_SAMPLE: 'STRATIFIED_UNIVERSE_SAMPLE',
} as const;
export type DiscoverySourceClass = (typeof DiscoverySourceClass)[keyof typeof DiscoverySourceClass];
export const ALL_DISCOVERY_SOURCE_CLASSES: readonly DiscoverySourceClass[] =
  Object.values(DiscoverySourceClass);

// ── §63.7 coverage populations ───────────────────────────────────────────────

/** Closed classification of every coverage/recall population (PRD §63.7). */
export const CoveragePopulationClass = {
  SUPPORTED_PROGRAM_UNIVERSE: 'SUPPORTED_PROGRAM_UNIVERSE',
  PROSPECTIVELY_OBSERVED_UNIVERSE: 'PROSPECTIVELY_OBSERVED_UNIVERSE',
  AGGREGATE_PROVIDER_UNIVERSE: 'AGGREGATE_PROVIDER_UNIVERSE',
  AUTHORIZED_LAUNCH_UNIVERSE: 'AUTHORIZED_LAUNCH_UNIVERSE',
  STRATIFIED_SAMPLED_UNIVERSE: 'STRATIFIED_SAMPLED_UNIVERSE',
  CURRENTLY_OBSERVED_SUBSET_ONLY: 'CURRENTLY_OBSERVED_SUBSET_ONLY',
} as const;
export type CoveragePopulationClass =
  (typeof CoveragePopulationClass)[keyof typeof CoveragePopulationClass];
export const ALL_COVERAGE_POPULATION_CLASSES: readonly CoveragePopulationClass[] =
  Object.values(CoveragePopulationClass);

// ── §63.6 cheap monitoring ───────────────────────────────────────────────────

/** Batch-worker assignment for a cheap-monitor candidate (PRD §63.6). */
export const CheapMonitorDecision = {
  REJECT_CHEAP: 'REJECT_CHEAP',
  MONITOR_CHEAP: 'MONITOR_CHEAP',
  PROMOTE_TO_VERIFY: 'PROMOTE_TO_VERIFY',
} as const;
export type CheapMonitorDecision = (typeof CheapMonitorDecision)[keyof typeof CheapMonitorDecision];
export const ALL_CHEAP_MONITOR_DECISIONS: readonly CheapMonitorDecision[] =
  Object.values(CheapMonitorDecision);

/** Cheap-monitor row lifecycle states (PRD §63.6 finite checks/expiry). */
export const CheapMonitorState = {
  NEW: 'NEW',
  MONITORING_CHEAP: 'MONITORING_CHEAP',
  PROMOTED_TO_VERIFY: 'PROMOTED_TO_VERIFY',
  REJECTED_CHEAP: 'REJECTED_CHEAP',
  EXPIRED_CHEAP: 'EXPIRED_CHEAP',
} as const;
export type CheapMonitorState = (typeof CheapMonitorState)[keyof typeof CheapMonitorState];
export const ALL_CHEAP_MONITOR_STATES: readonly CheapMonitorState[] =
  Object.values(CheapMonitorState);

// ── §63.5 universe entry provenance ──────────────────────────────────────────

/** How an asset entered the discovery universe (PRD §63.5 first-seen record). */
export const UniverseEntryReason = {
  BONDING_CURVE_INITIALIZE: 'BONDING_CURVE_INITIALIZE',
  LIQUIDITY_POOL_CREATE: 'LIQUIDITY_POOL_CREATE',
  TOKEN_MIGRATION: 'TOKEN_MIGRATION',
  AGGREGATE_DISCOVERY_FEED: 'AGGREGATE_DISCOVERY_FEED',
  AUTHORIZED_LAUNCHPAD_STREAM: 'AUTHORIZED_LAUNCHPAD_STREAM',
  USER_WATCHLIST_REGISTRATION: 'USER_WATCHLIST_REGISTRATION',
  SELECTIVE_CHAIN_BACKFILL: 'SELECTIVE_CHAIN_BACKFILL',
  RETROSPECTIVE_RECONSTRUCTION: 'RETROSPECTIVE_RECONSTRUCTION',
} as const;
export type UniverseEntryReason = (typeof UniverseEntryReason)[keyof typeof UniverseEntryReason];
export const ALL_UNIVERSE_ENTRY_REASONS: readonly UniverseEntryReason[] =
  Object.values(UniverseEntryReason);

// ── §63.12 population constraints ────────────────────────────────────────────

/** Root cause of a population constraint (PRD §63.12 coverage failure behavior). */
export const PopulationConstraintKind = {
  COLLECTOR_GAP: 'COLLECTOR_GAP',
  DECODER_PAUSE: 'DECODER_PAUSE',
  PROGRAM_VERSION_UNVERIFIED: 'PROGRAM_VERSION_UNVERIFIED',
  PROVIDER_HEALTH_UNAVAILABLE: 'PROVIDER_HEALTH_UNAVAILABLE',
} as const;
export type PopulationConstraintKind =
  (typeof PopulationConstraintKind)[keyof typeof PopulationConstraintKind];
export const ALL_POPULATION_CONSTRAINT_KINDS: readonly PopulationConstraintKind[] =
  Object.values(PopulationConstraintKind);

/** Effect a constraint has on claims (PRD §63.12). */
export const PopulationConstraintEffect = {
  CONSTRAIN_POPULATION: 'CONSTRAIN_POPULATION',
  BLOCKS_CONFIRMED_ALERTS: 'BLOCKS_CONFIRMED_ALERTS',
  RECORD_INCIDENT_ONLY: 'RECORD_INCIDENT_ONLY',
  DEGRADE_CAPABILITY: 'DEGRADE_CAPABILITY',
} as const;
export type PopulationConstraintEffect =
  (typeof PopulationConstraintEffect)[keyof typeof PopulationConstraintEffect];
export const ALL_POPULATION_CONSTRAINT_EFFECTS: readonly PopulationConstraintEffect[] =
  Object.values(PopulationConstraintEffect);

// ── §63.9 recall claim bases ─────────────────────────────────────────────────

/** The only bases from which an independent recall claim may be made (PRD §63.9). */
export const RecallClaimBasis = {
  INDEPENDENT_FIRST_PARTY_OBSERVATION: 'INDEPENDENT_FIRST_PARTY_OBSERVATION',
  INDEPENDENT_PROVIDER_LINEAGE: 'INDEPENDENT_PROVIDER_LINEAGE',
  KNOWN_INCLUSION_PROBABILITY_SAMPLE: 'KNOWN_INCLUSION_PROBABILITY_SAMPLE',
} as const;
export type RecallClaimBasis = (typeof RecallClaimBasis)[keyof typeof RecallClaimBasis];
export const ALL_RECALL_CLAIM_BASES: readonly RecallClaimBasis[] = Object.values(RecallClaimBasis);

// ── chain access modes (FR-DISC-008) ─────────────────────────────────────────

/** Bounded chain-access declaration modes; broad ingestion is never admitted. */
export const ChainAccessMode = {
  SELECTIVE_VERIFICATION: 'SELECTIVE_VERIFICATION',
  BOUNDED_BACKFILL: 'BOUNDED_BACKFILL',
  HISTORICAL_SAMPLE: 'HISTORICAL_SAMPLE',
  UNAUTHORIZED_BROAD_INGESTION: 'UNAUTHORIZED_BROAD_INGESTION',
} as const;
export type ChainAccessMode = (typeof ChainAccessMode)[keyof typeof ChainAccessMode];
export const ALL_CHAIN_ACCESS_MODES: readonly ChainAccessMode[] = Object.values(ChainAccessMode);

// ── fail-closed parsing (vocabulary law) ─────────────────────────────────────

/**
 * Parse `value` against a closed vocabulary; unknown members throw the given
 * stable `DISC_*_UNKNOWN` code. Never returns a silent default.
 */
function parseVocabulary<V extends string>(
  value: unknown,
  vocabulary: readonly V[],
  code: ErrorCode,
  label: string,
): V {
  if (typeof value === 'string' && (vocabulary as readonly string[]).includes(value)) {
    return value as V;
  }
  const detail: { value: string | number | boolean | null } =
    typeof value === 'string' ? { value } : { value: null };
  throw new DiscError(`${label}: ${String(value)}`, detail, code);
}

/** Fail-closed parse of a §63.12 discovery entry reason. */
export function parseDiscEntryReason(value: unknown): DiscEntryReasonValue {
  return parseVocabulary(
    value,
    ALL_DISC_ENTRY_REASONS,
    ErrorCode.DISC_ENTRY_REASON_UNKNOWN,
    'DISC_ENTRY_REASON_UNKNOWN',
  );
}

/** Fail-closed parse of a rights basis. */
export function parseDiscRightsBasis(value: unknown): (typeof ALL_DISC_RIGHTS_BASES)[number] {
  return parseVocabulary(
    value,
    ALL_DISC_RIGHTS_BASES,
    ErrorCode.DISC_RIGHTS_BASIS_UNKNOWN,
    'DISC_RIGHTS_BASIS_UNKNOWN',
  );
}

/** Fail-closed parse of a manipulation policy. */
export function parseDiscManipulationPolicy(
  value: unknown,
): (typeof ALL_DISC_MANIPULATION_POLICIES)[number] {
  return parseVocabulary(
    value,
    ALL_DISC_MANIPULATION_POLICIES,
    ErrorCode.DISC_MANIPULATION_POLICY_UNKNOWN,
    'DISC_MANIPULATION_POLICY_UNKNOWN',
  );
}

/** Fail-closed parse of a claim basis. */
export function parseDiscClaimBasis(value: unknown): (typeof ALL_DISC_CLAIM_BASES)[number] {
  return parseVocabulary(
    value,
    ALL_DISC_CLAIM_BASES,
    ErrorCode.DISC_CLAIM_BASIS_UNKNOWN,
    'DISC_CLAIM_BASIS_UNKNOWN',
  );
}

/** Fail-closed parse of a canonical constraint kind. */
export function parseDiscConstraintKind(
  value: unknown,
): (typeof ALL_DISC_CONSTRAINT_KINDS)[number] {
  return parseVocabulary(
    value,
    ALL_DISC_CONSTRAINT_KINDS,
    ErrorCode.DISC_CONSTRAINT_KIND_UNKNOWN,
    'DISC_CONSTRAINT_KIND_UNKNOWN',
  );
}

/** Fail-closed parse of a canonical constraint effect. */
export function parseDiscConstraintEffect(
  value: unknown,
): (typeof ALL_DISC_CONSTRAINT_EFFECTS)[number] {
  return parseVocabulary(
    value,
    ALL_DISC_CONSTRAINT_EFFECTS,
    ErrorCode.DISC_CONSTRAINT_EFFECT_UNKNOWN,
    'DISC_CONSTRAINT_EFFECT_UNKNOWN',
  );
}

/** Fail-closed parse of a chain-access purpose. */
export function parseDiscChainAccessPurpose(
  value: unknown,
): (typeof ALL_DISC_CHAIN_ACCESS_PURPOSES)[number] {
  return parseVocabulary(
    value,
    ALL_DISC_CHAIN_ACCESS_PURPOSES,
    ErrorCode.DISC_CHAIN_ACCESS_PURPOSE_UNKNOWN,
    'DISC_CHAIN_ACCESS_PURPOSE_UNKNOWN',
  );
}

/** Fail-closed parse of a recall verdict. */
export function parseDiscRecallVerdict(value: unknown): (typeof ALL_DISC_RECALL_VERDICTS)[number] {
  return parseVocabulary(
    value,
    ALL_DISC_RECALL_VERDICTS,
    ErrorCode.DISC_RECALL_VERDICT_UNKNOWN,
    'DISC_RECALL_VERDICT_UNKNOWN',
  );
}

/** Fail-closed parse of a lateness basis. */
export function parseDiscLatenessBasis(value: unknown): (typeof ALL_DISC_LATENESS_BASES)[number] {
  return parseVocabulary(
    value,
    ALL_DISC_LATENESS_BASES,
    ErrorCode.DISC_LATENESS_BASIS_UNKNOWN,
    'DISC_LATENESS_BASIS_UNKNOWN',
  );
}

/** Fail-closed parse of a §63.2 source class. */
export function parseDiscoverySourceClass(value: unknown): DiscoverySourceClass {
  return parseVocabulary(
    value,
    ALL_DISCOVERY_SOURCE_CLASSES,
    ErrorCode.DISC_ENTRY_REASON_UNKNOWN,
    'DISCOVERY_SOURCE_CLASS_UNKNOWN',
  );
}

/** Fail-closed parse of a §63.7 coverage population class. */
export function parseCoveragePopulationClass(value: unknown): CoveragePopulationClass {
  return parseVocabulary(
    value,
    ALL_COVERAGE_POPULATION_CLASSES,
    ErrorCode.DISC_ENTRY_REASON_UNKNOWN,
    'COVERAGE_POPULATION_CLASS_UNKNOWN',
  );
}

/** Fail-closed parse of a §63.6 cheap-monitor decision. */
export function parseCheapMonitorDecision(value: unknown): CheapMonitorDecision {
  return parseVocabulary(
    value,
    ALL_CHEAP_MONITOR_DECISIONS,
    ErrorCode.DISC_ENTRY_REASON_UNKNOWN,
    'CHEAP_MONITOR_DECISION_UNKNOWN',
  );
}

/** Fail-closed parse of a cheap-monitor state. */
export function parseCheapMonitorState(value: unknown): CheapMonitorState {
  return parseVocabulary(
    value,
    ALL_CHEAP_MONITOR_STATES,
    ErrorCode.DISC_ENTRY_REASON_UNKNOWN,
    'CHEAP_MONITOR_STATE_UNKNOWN',
  );
}

/** Fail-closed parse of a §63.5 universe entry reason. */
export function parseUniverseEntryReason(value: unknown): UniverseEntryReason {
  return parseVocabulary(
    value,
    ALL_UNIVERSE_ENTRY_REASONS,
    ErrorCode.DISC_ENTRY_REASON_UNKNOWN,
    'UNIVERSE_ENTRY_REASON_UNKNOWN',
  );
}

/** Fail-closed parse of a population-constraint kind. */
export function parsePopulationConstraintKind(value: unknown): PopulationConstraintKind {
  return parseVocabulary(
    value,
    ALL_POPULATION_CONSTRAINT_KINDS,
    ErrorCode.DISC_CONSTRAINT_KIND_UNKNOWN,
    'POPULATION_CONSTRAINT_KIND_UNKNOWN',
  );
}

/** Fail-closed parse of a population-constraint effect. */
export function parsePopulationConstraintEffect(value: unknown): PopulationConstraintEffect {
  return parseVocabulary(
    value,
    ALL_POPULATION_CONSTRAINT_EFFECTS,
    ErrorCode.DISC_CONSTRAINT_EFFECT_UNKNOWN,
    'POPULATION_CONSTRAINT_EFFECT_UNKNOWN',
  );
}

/** Fail-closed parse of a recall claim basis. */
export function parseRecallClaimBasis(value: unknown): RecallClaimBasis {
  return parseVocabulary(
    value,
    ALL_RECALL_CLAIM_BASES,
    ErrorCode.DISC_CLAIM_BASIS_UNKNOWN,
    'RECALL_CLAIM_BASIS_UNKNOWN',
  );
}

/** Fail-closed parse of a chain-access mode. */
export function parseChainAccessMode(value: unknown): ChainAccessMode {
  return parseVocabulary(
    value,
    ALL_CHAIN_ACCESS_MODES,
    ErrorCode.DISC_CONSTRAINT_KIND_UNKNOWN,
    'CHAIN_ACCESS_MODE_UNKNOWN',
  );
}

// ── the four pure laws ───────────────────────────────────────────────────────

/** Claim bases `recallClaimBasisAdmissible` accepts (FR-DISC-010). */
const ADMISSIBLE_CLAIM_BASES: readonly string[] = [
  RecallClaimBasis.INDEPENDENT_FIRST_PARTY_OBSERVATION,
  RecallClaimBasis.INDEPENDENT_PROVIDER_LINEAGE,
  RecallClaimBasis.KNOWN_INCLUSION_PROBABILITY_SAMPLE,
];

/**
 * FR-DISC-010 — a claim basis is admissible only when first-party
 * observation is independent, provider lineage is independent per the
 * proven dependence resolution, or inclusion probabilities are valid
 * (nonzero, within [0,1], covering the sampled strata). Any other value —
 * including non-strings, self-evaluated universes, unverified aggregator
 * estimates, and heuristic guesses — is inadmissible.
 */
export function recallClaimBasisAdmissible(basis: unknown): boolean {
  return typeof basis === 'string' && ADMISSIBLE_CLAIM_BASES.includes(basis);
}

/**
 * FR-DISC-010 — an evaluated source inside the generating universe's source
 * set can never produce an independent recall claim. An empty baseline
 * universe refuses too: with no independently observed baseline there is no
 * universe against which recall could be independent.
 */
export function selfRecallRefused(
  evaluatedSourceId: string,
  baselineUniverseSourceIds: readonly string[],
): boolean {
  if (baselineUniverseSourceIds.length === 0) return true;
  return baselineUniverseSourceIds.includes(evaluatedSourceId);
}

/**
 * FR-DISC-013 — a standing unresolved constraint blocks publication when its
 * effect blocks confirmed alerts or narrows the population, or when the
 * constraint itself declares `blocksPublication`. Incident-only records do
 * not block.
 */
export function constraintBlocksPublication(
  constraints: readonly { effect: string; blocksPublication?: boolean }[],
): boolean {
  return constraints.some(
    (constraint) =>
      constraint.blocksPublication === true ||
      constraint.effect === 'CONSTRAIN_POPULATION' ||
      constraint.effect === 'BLOCKS_CONFIRMED_ALERTS',
  );
}

/** Population classes that can substantiate full-market language (FR-DISC-014). */
const SUBSTANTIATED_POPULATIONS: readonly string[] = [
  CoveragePopulationClass.SUPPORTED_PROGRAM_UNIVERSE,
  CoveragePopulationClass.PROSPECTIVELY_OBSERVED_UNIVERSE,
  CoveragePopulationClass.STRATIFIED_SAMPLED_UNIVERSE,
];

/**
 * FR-DISC-014 — full-market / all-Solana / universal-recall language is
 * substantiated only by an exhaustive sampling contract with recorded
 * selection probabilities: a population class that actually covers the
 * market, zero known gaps, and disclosed source dependence. Anything less
 * narrows the claim instead.
 */
export function fullMarketLanguageSubstantiated(manifest: {
  populationClass: string;
  knownGapsCount: number;
  sourceDependenceDisclosed: boolean;
  rightsExclusions?: readonly string[];
}): boolean {
  if (!SUBSTANTIATED_POPULATIONS.includes(manifest.populationClass)) return false;
  if (manifest.knownGapsCount > 0) return false;
  if (!manifest.sourceDependenceDisclosed) return false;
  return (manifest.rightsExclusions ?? []).length === 0;
}
