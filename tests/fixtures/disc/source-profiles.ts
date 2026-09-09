/**
 * Discovery source profile fixtures (§63.2 source classes, FR-DISC-011 field sets,
 * versioned supersession chains, and incomplete refusal vectors).
 * Traces: FR-DISC-011, AC-110.
 */
import type { UtcTimestamp } from '@foresift/domain';

export type DiscoverySourceClass =
  | 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT'
  | 'FREE_AGGREGATE_DISCOVERY'
  | 'AUTHORIZED_LAUNCH_FEED'
  | 'USER_WATCHLIST_OR_MCP'
  | 'AUTHORIZED_SOCIAL_AGGREGATE'
  | 'SELECTIVE_CHAIN_VERIFICATION'
  | 'RETROSPECTIVE_UNIVERSE_ENUMERATION'
  | 'STRATIFIED_UNIVERSE_SAMPLE';

export interface DiscSourceProfileFixture {
  readonly sourceId: string;
  readonly sourceClass: DiscoverySourceClass;
  readonly version: string;
  readonly supersedesVersion?: string;
  readonly isFirstParty: boolean;
  readonly sourceSpecificFirstSeen: boolean;
  readonly normalizedIdentity: boolean;
  readonly upstreamDependence: readonly string[];
  readonly upstreamDependenceDisclosed: boolean;
  readonly queryFilterVersion: string;
  readonly coverageScope: readonly string[];
  readonly rightsPolicy: string;
  readonly allowedEntryReasons: readonly string[];
  readonly metadataHash: string;
  readonly registeredAt: UtcTimestamp;
}

// -----------------------------------------------------------------------------
// 1. §63.2-classed complete profile vectors for all eight source classes
// -----------------------------------------------------------------------------

export const PUMP_FIRST_PARTY_SOURCE_PROFILE_V1: DiscSourceProfileFixture = {
  sourceId: 'src_solana_pump_live',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  version: '1.0.0',
  isFirstParty: true,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: [],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_pump_curve_v1',
  coverageScope: ['scope_solana_pump_fun_v1'],
  rightsPolicy: 'FIRST_PARTY_OBSERVATION_FULL_COMMERCIAL',
  allowedEntryReasons: ['BONDING_CURVE_INITIALIZE', 'LIQUIDITY_POOL_CREATE', 'TOKEN_MIGRATION'],
  metadataHash: 'sha256:pump_first_party_profile_meta_v1',
  registeredAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
};

export const GMGN_FREE_AGGREGATE_SOURCE_PROFILE_V1: DiscSourceProfileFixture = {
  sourceId: 'src_gmgn_free_aggregate',
  sourceClass: 'FREE_AGGREGATE_DISCOVERY',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: ['upstream_gmgn_public_api'],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_gmgn_all_tokens_v1',
  coverageScope: ['scope_gmgn_free_stream'],
  rightsPolicy: 'PUBLIC_AGGREGATE_FREE_NON_EXCLUSIVE',
  allowedEntryReasons: ['AGGREGATE_DISCOVERY_FEED'],
  metadataHash: 'sha256:gmgn_free_aggregate_meta_v1',
  registeredAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
};

export const PUMP_AUTHORIZED_LAUNCH_FEED_PROFILE_V1: DiscSourceProfileFixture = {
  sourceId: 'src_pump_official_webhook',
  sourceClass: 'AUTHORIZED_LAUNCH_FEED',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: ['upstream_pump_partner_feed'],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_pump_webhook_v1',
  coverageScope: ['scope_pump_launchpad'],
  rightsPolicy: 'AUTHORIZED_PARTNER_LICENSE_V1',
  allowedEntryReasons: ['AUTHORIZED_LAUNCHPAD_STREAM', 'BONDING_CURVE_INITIALIZE'],
  metadataHash: 'sha256:pump_auth_launch_meta_v1',
  registeredAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
};

export const USER_WATCHLIST_MCP_SOURCE_PROFILE_V1: DiscSourceProfileFixture = {
  sourceId: 'src_user_watchlist_mcp',
  sourceClass: 'USER_WATCHLIST_OR_MCP',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: ['upstream_user_mcp_client'],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_user_watchlist_v1',
  coverageScope: ['scope_user_interactive_mcp'],
  rightsPolicy: 'USER_SUPPLIED_QUERY_DIRECT_CONSENT',
  allowedEntryReasons: ['USER_WATCHLIST_REGISTRATION'],
  metadataHash: 'sha256:user_watchlist_meta_v1',
  registeredAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
};

export const AUTHORIZED_SOCIAL_AGGREGATE_PROFILE_V1: DiscSourceProfileFixture = {
  sourceId: 'src_authorized_social_feed',
  sourceClass: 'AUTHORIZED_SOCIAL_AGGREGATE',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: ['upstream_social_partner_api'],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_social_mentions_v1',
  coverageScope: ['scope_social_verified_mentions'],
  rightsPolicy: 'COMMERCIAL_SOCIAL_AGGREGATE_LICENSE',
  allowedEntryReasons: ['AGGREGATE_DISCOVERY_FEED'],
  metadataHash: 'sha256:auth_social_meta_v1',
  registeredAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
};

export const SELECTIVE_CHAIN_VERIFICATION_PROFILE_V1: DiscSourceProfileFixture = {
  sourceId: 'src_solana_rpc_selective',
  sourceClass: 'SELECTIVE_CHAIN_VERIFICATION',
  version: '1.0.0',
  isFirstParty: true,
  sourceSpecificFirstSeen: false,
  normalizedIdentity: true,
  upstreamDependence: [],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_selective_backfill_v1',
  coverageScope: ['scope_promoted_candidate_verification'],
  rightsPolicy: 'DIRECT_CHAIN_READ_ONLY',
  allowedEntryReasons: ['SELECTIVE_CHAIN_BACKFILL'],
  metadataHash: 'sha256:selective_chain_meta_v1',
  registeredAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
};

export const RETROSPECTIVE_CHAIN_ENUMERATION_PROFILE_V1: DiscSourceProfileFixture = {
  sourceId: 'src_retro_indexer_enumeration',
  sourceClass: 'RETROSPECTIVE_UNIVERSE_ENUMERATION',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: false,
  normalizedIdentity: true,
  upstreamDependence: ['upstream_independent_archive_indexer'],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_retro_all_mints_2026q3',
  coverageScope: ['scope_solana_historical_archive'],
  rightsPolicy: 'HISTORICAL_DATA_EVALUATION_ONLY',
  allowedEntryReasons: ['RETROSPECTIVE_RECONSTRUCTION'],
  metadataHash: 'sha256:retro_enumeration_meta_v1',
  registeredAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
};

export const STRATIFIED_SAMPLE_UNIVERSE_PROFILE_V1: DiscSourceProfileFixture = {
  sourceId: 'src_stratified_sample_generator',
  sourceClass: 'STRATIFIED_UNIVERSE_SAMPLE',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: false,
  normalizedIdentity: true,
  upstreamDependence: ['upstream_historical_block_stream'],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_stratified_sample_v1',
  coverageScope: ['scope_solana_stratified_sample_q3'],
  rightsPolicy: 'RESEARCH_PROBABILITY_SAMPLE_LICENSE',
  allowedEntryReasons: ['RETROSPECTIVE_RECONSTRUCTION'],
  metadataHash: 'sha256:stratified_sample_meta_v1',
  registeredAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
};

export const ALL_EIGHT_SOURCE_PROFILES: readonly DiscSourceProfileFixture[] = [
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V1,
  GMGN_FREE_AGGREGATE_SOURCE_PROFILE_V1,
  PUMP_AUTHORIZED_LAUNCH_FEED_PROFILE_V1,
  USER_WATCHLIST_MCP_SOURCE_PROFILE_V1,
  AUTHORIZED_SOCIAL_AGGREGATE_PROFILE_V1,
  SELECTIVE_CHAIN_VERIFICATION_PROFILE_V1,
  RETROSPECTIVE_CHAIN_ENUMERATION_PROFILE_V1,
  STRATIFIED_SAMPLE_UNIVERSE_PROFILE_V1,
];

// -----------------------------------------------------------------------------
// 2. Versioned supersession chains
// -----------------------------------------------------------------------------

export const PUMP_FIRST_PARTY_SOURCE_PROFILE_V2: DiscSourceProfileFixture = {
  ...PUMP_FIRST_PARTY_SOURCE_PROFILE_V1,
  version: '1.1.0',
  supersedesVersion: '1.0.0',
  queryFilterVersion: 'qf_pump_curve_v2_fast_decoding',
  metadataHash: 'sha256:pump_first_party_profile_meta_v2',
  registeredAt: '2026-08-15T00:00:00Z' as UtcTimestamp,
};

export const PUMP_FIRST_PARTY_SOURCE_PROFILE_V3: DiscSourceProfileFixture = {
  ...PUMP_FIRST_PARTY_SOURCE_PROFILE_V2,
  version: '2.0.0',
  supersedesVersion: '1.1.0',
  queryFilterVersion: 'qf_pump_curve_v3_multishard',
  metadataHash: 'sha256:pump_first_party_profile_meta_v3',
  registeredAt: '2026-09-01T00:00:00Z' as UtcTimestamp,
};

export const VALID_SUPERSEDED_PROFILE_CHAIN: readonly DiscSourceProfileFixture[] = [
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V1,
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V2,
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V3,
];

// Invalid supersession chains
export const INVALID_SELF_SUPERSEDING_PROFILE = {
  ...PUMP_FIRST_PARTY_SOURCE_PROFILE_V1,
  version: '1.0.0',
  supersedesVersion: '1.0.0',
};

export const INVALID_FORWARD_SUPERSEDING_PROFILE = {
  ...PUMP_FIRST_PARTY_SOURCE_PROFILE_V1,
  version: '1.0.0',
  supersedesVersion: '2.0.0',
};

// -----------------------------------------------------------------------------
// 3. Incomplete refusal vectors (FR-DISC-011 violations)
// -----------------------------------------------------------------------------

export const INCOMPLETE_PROFILE_MISSING_SOURCE_CLASS = {
  sourceId: 'src_incomplete_no_class',
  version: '1.0.0',
  isFirstParty: true,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: [],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_v1',
  coverageScope: ['scope_v1'],
  rightsPolicy: 'STANDARD_RIGHTS',
  allowedEntryReasons: ['BONDING_CURVE_INITIALIZE'],
  metadataHash: 'sha256:incomplete_meta',
  registeredAt: '2026-08-01T00:00:00Z',
};

export const INCOMPLETE_PROFILE_MISSING_VERSION = {
  sourceId: 'src_incomplete_no_version',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  isFirstParty: true,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: [],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_v1',
  coverageScope: ['scope_v1'],
  rightsPolicy: 'STANDARD_RIGHTS',
  allowedEntryReasons: ['BONDING_CURVE_INITIALIZE'],
  metadataHash: 'sha256:incomplete_meta',
  registeredAt: '2026-08-01T00:00:00Z',
};

export const INCOMPLETE_PROFILE_MISSING_RIGHTS = {
  sourceId: 'src_incomplete_no_rights',
  sourceClass: 'FREE_AGGREGATE_DISCOVERY',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: ['upstream_feed'],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_v1',
  coverageScope: ['scope_v1'],
  allowedEntryReasons: ['AGGREGATE_DISCOVERY_FEED'],
  metadataHash: 'sha256:incomplete_meta',
  registeredAt: '2026-08-01T00:00:00Z',
};

export const INCOMPLETE_PROFILE_UNDISCLOSED_UPSTREAM = {
  sourceId: 'src_undisclosed_upstream',
  sourceClass: 'FREE_AGGREGATE_DISCOVERY',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: ['upstream_third_party'],
  upstreamDependenceDisclosed: false, // Refusal: dependence undisclosed!
  queryFilterVersion: 'qf_v1',
  coverageScope: ['scope_v1'],
  rightsPolicy: 'PUBLIC_AGGREGATE',
  allowedEntryReasons: ['AGGREGATE_DISCOVERY_FEED'],
  metadataHash: 'sha256:incomplete_meta',
  registeredAt: '2026-08-01T00:00:00Z',
};

export const INVALID_UNKNOWN_SOURCE_CLASS_PROFILE = {
  sourceId: 'src_invalid_class',
  sourceClass: 'UNAUTHORIZED_SCRAPER_STREAM',
  version: '1.0.0',
  isFirstParty: false,
  sourceSpecificFirstSeen: true,
  normalizedIdentity: true,
  upstreamDependence: [],
  upstreamDependenceDisclosed: true,
  queryFilterVersion: 'qf_v1',
  coverageScope: ['scope_v1'],
  rightsPolicy: 'UNKNOWN',
  allowedEntryReasons: ['AGGREGATE_DISCOVERY_FEED'],
  metadataHash: 'sha256:incomplete_meta',
  registeredAt: '2026-08-01T00:00:00Z',
};
