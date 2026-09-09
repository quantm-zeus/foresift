/**
 * Discovery universe per-entry provenance fixtures (all eight entry reasons,
 * complete and claim-breaking-incomplete variants, first-party vs non-first-party flags).
 * Traces: FR-DISC-011, AC-110.
 */
import type { UtcTimestamp } from '@foresift/domain';
import type { DiscoverySourceClass } from './source-profiles.ts';

export type UniverseEntryReason =
  | 'BONDING_CURVE_INITIALIZE'
  | 'LIQUIDITY_POOL_CREATE'
  | 'TOKEN_MIGRATION'
  | 'AGGREGATE_DISCOVERY_FEED'
  | 'AUTHORIZED_LAUNCHPAD_STREAM'
  | 'USER_WATCHLIST_REGISTRATION'
  | 'SELECTIVE_CHAIN_BACKFILL'
  | 'RETROSPECTIVE_RECONSTRUCTION';

export const ALL_UNIVERSE_ENTRY_REASONS: readonly UniverseEntryReason[] = [
  'BONDING_CURVE_INITIALIZE',
  'LIQUIDITY_POOL_CREATE',
  'TOKEN_MIGRATION',
  'AGGREGATE_DISCOVERY_FEED',
  'AUTHORIZED_LAUNCHPAD_STREAM',
  'USER_WATCHLIST_REGISTRATION',
  'SELECTIVE_CHAIN_BACKFILL',
  'RETROSPECTIVE_RECONSTRUCTION',
];

export interface UniverseEntryProvenanceFixture {
  readonly assetRepresentationId: string;
  readonly sourceId: string;
  readonly sourceClass: DiscoverySourceClass;
  readonly entryReason: UniverseEntryReason;
  readonly isFirstParty: boolean;
  readonly sourceObservedAt?: UtcTimestamp;
  readonly sourcePublishedAt?: UtcTimestamp;
  readonly sourceAvailableAt: UtcTimestamp;
  readonly firstFetchedAt?: UtcTimestamp;
  readonly firstReceivedAt?: UtcTimestamp;
  readonly firstIngestedAt: UtcTimestamp;
  readonly chainCoordinates?: string;
  readonly sourceRank?: number;
  readonly sourceMetadataHash: string;
  readonly discoveryPolicyVersion: string;
  readonly normalizedIdentity: boolean;
  readonly collectorCoverageManifestId?: string;
  readonly qualityCodes: readonly string[];
}

// -----------------------------------------------------------------------------
// 1. Complete per-entry provenance vectors for all eight entry reasons
// -----------------------------------------------------------------------------

export const PUMP_BONDING_CURVE_ENTRY_PROVENANCE: UniverseEntryProvenanceFixture = {
  assetRepresentationId: 'asset_rep_sol_pump_001',
  sourceId: 'col_solana_pump_live',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  entryReason: 'BONDING_CURVE_INITIALIZE',
  isFirstParty: true,
  sourceObservedAt: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
  firstReceivedAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:00:00.010Z' as UtcTimestamp,
  chainCoordinates: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300100200:0:2',
  sourceRank: 1,
  sourceMetadataHash: 'sha256:pump_bonding_curve_meta_hash_001',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  collectorCoverageManifestId: 'cov_man_pump_v1_001',
  qualityCodes: ['QUALITY_FIRST_PARTY_VERIFIED'],
};

export const RAYDIUM_POOL_CREATE_ENTRY_PROVENANCE: UniverseEntryProvenanceFixture = {
  assetRepresentationId: 'asset_rep_sol_raydium_002',
  sourceId: 'col_solana_raydium_live',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  entryReason: 'LIQUIDITY_POOL_CREATE',
  isFirstParty: true,
  sourceObservedAt: '2026-08-20T10:05:00.000Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:05:00.006Z' as UtcTimestamp,
  firstReceivedAt: '2026-08-20T10:05:00.006Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:05:00.012Z' as UtcTimestamp,
  chainCoordinates: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300100500:1:0',
  sourceRank: 1,
  sourceMetadataHash: 'sha256:raydium_pool_meta_hash_002',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  collectorCoverageManifestId: 'cov_man_raydium_v4_001',
  qualityCodes: ['QUALITY_FIRST_PARTY_VERIFIED'],
};

export const TOKEN_MIGRATION_ENTRY_PROVENANCE: UniverseEntryProvenanceFixture = {
  assetRepresentationId: 'asset_rep_sol_migration_003',
  sourceId: 'col_solana_migration_tracker',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  entryReason: 'TOKEN_MIGRATION',
  isFirstParty: true,
  sourceObservedAt: '2026-08-20T10:10:00.000Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:10:00.008Z' as UtcTimestamp,
  firstReceivedAt: '2026-08-20T10:10:00.008Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:10:00.015Z' as UtcTimestamp,
  chainCoordinates: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300101000:2:1',
  sourceRank: 1,
  sourceMetadataHash: 'sha256:migration_meta_hash_003',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  collectorCoverageManifestId: 'cov_man_migration_v1_001',
  qualityCodes: ['QUALITY_FIRST_PARTY_VERIFIED'],
};

export const GMGN_FREE_AGGREGATE_ENTRY_PROVENANCE: UniverseEntryProvenanceFixture = {
  assetRepresentationId: 'asset_rep_sol_gmgn_004',
  sourceId: 'src_gmgn_free_aggregate',
  sourceClass: 'FREE_AGGREGATE_DISCOVERY',
  entryReason: 'AGGREGATE_DISCOVERY_FEED',
  isFirstParty: false,
  sourceObservedAt: '2026-08-20T10:15:00.000Z' as UtcTimestamp,
  sourcePublishedAt: '2026-08-20T10:15:01.000Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:15:01.500Z' as UtcTimestamp,
  firstFetchedAt: '2026-08-20T10:15:01.600Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:15:01.700Z' as UtcTimestamp,
  sourceRank: 3,
  sourceMetadataHash: 'sha256:gmgn_meta_hash_004',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
};

export const PUMP_AUTHORIZED_FEED_ENTRY_PROVENANCE: UniverseEntryProvenanceFixture = {
  assetRepresentationId: 'asset_rep_sol_auth_feed_005',
  sourceId: 'src_pump_official_webhook',
  sourceClass: 'AUTHORIZED_LAUNCH_FEED',
  entryReason: 'AUTHORIZED_LAUNCHPAD_STREAM',
  isFirstParty: false,
  sourceObservedAt: '2026-08-20T10:20:00.000Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:20:00.300Z' as UtcTimestamp,
  firstReceivedAt: '2026-08-20T10:20:00.300Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:20:00.350Z' as UtcTimestamp,
  sourceRank: 2,
  sourceMetadataHash: 'sha256:auth_feed_meta_hash_005',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: ['QUALITY_AUTHORIZED_FEED'],
};

export const USER_WATCHLIST_ENTRY_PROVENANCE: UniverseEntryProvenanceFixture = {
  assetRepresentationId: 'asset_rep_sol_watchlist_006',
  sourceId: 'src_user_watchlist_mcp',
  sourceClass: 'USER_WATCHLIST_OR_MCP',
  entryReason: 'USER_WATCHLIST_REGISTRATION',
  isFirstParty: false,
  sourceAvailableAt: '2026-08-20T10:25:00.000Z' as UtcTimestamp,
  firstReceivedAt: '2026-08-20T10:25:00.000Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:25:00.050Z' as UtcTimestamp,
  sourceRank: 4,
  sourceMetadataHash: 'sha256:user_watchlist_meta_hash_006',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: ['QUALITY_USER_WATCHLIST'],
};

export const SELECTIVE_BACKFILL_ENTRY_PROVENANCE: UniverseEntryProvenanceFixture = {
  assetRepresentationId: 'asset_rep_sol_backfill_007',
  sourceId: 'src_solana_rpc_selective',
  sourceClass: 'SELECTIVE_CHAIN_VERIFICATION',
  entryReason: 'SELECTIVE_CHAIN_BACKFILL',
  isFirstParty: true,
  sourceObservedAt: '2026-08-20T10:30:00.000Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:30:00.010Z' as UtcTimestamp,
  firstFetchedAt: '2026-08-20T10:30:00.500Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:30:00.550Z' as UtcTimestamp,
  chainCoordinates: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300103000:3:0',
  sourceMetadataHash: 'sha256:selective_backfill_meta_hash_007',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: ['QUALITY_SELECTIVE_VERIFIED'],
};

export const RETROSPECTIVE_ENTRY_PROVENANCE: UniverseEntryProvenanceFixture = {
  assetRepresentationId: 'asset_rep_sol_retro_008',
  sourceId: 'src_retro_indexer_enumeration',
  sourceClass: 'RETROSPECTIVE_UNIVERSE_ENUMERATION',
  entryReason: 'RETROSPECTIVE_RECONSTRUCTION',
  isFirstParty: false,
  sourceObservedAt: '2026-08-20T10:35:00.000Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:35:00.000Z' as UtcTimestamp,
  firstFetchedAt: '2026-08-20T11:00:00.000Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T11:00:00.100Z' as UtcTimestamp,
  sourceMetadataHash: 'sha256:retro_entry_meta_hash_008',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: ['QUALITY_RETROSPECTIVE_SAMPLE'],
};

export const ALL_EIGHT_ENTRY_PROVENANCES: readonly UniverseEntryProvenanceFixture[] = [
  PUMP_BONDING_CURVE_ENTRY_PROVENANCE,
  RAYDIUM_POOL_CREATE_ENTRY_PROVENANCE,
  TOKEN_MIGRATION_ENTRY_PROVENANCE,
  GMGN_FREE_AGGREGATE_ENTRY_PROVENANCE,
  PUMP_AUTHORIZED_FEED_ENTRY_PROVENANCE,
  USER_WATCHLIST_ENTRY_PROVENANCE,
  SELECTIVE_BACKFILL_ENTRY_PROVENANCE,
  RETROSPECTIVE_ENTRY_PROVENANCE,
];

// -----------------------------------------------------------------------------
// 2. Claim-breaking incomplete variants (refusal vectors)
// -----------------------------------------------------------------------------

export const INCOMPLETE_ENTRY_MISSING_REASON = {
  assetRepresentationId: 'asset_rep_incomplete_001',
  sourceId: 'col_solana_pump_live',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  isFirstParty: true,
  sourceAvailableAt: '2026-08-20T10:00:00.005Z',
  firstIngestedAt: '2026-08-20T10:00:00.010Z',
  sourceMetadataHash: 'sha256:hash_missing_reason',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: [],
};

export const INCOMPLETE_ENTRY_UNNORMALIZED_IDENTITY = {
  assetRepresentationId: 'asset_rep_incomplete_002',
  sourceId: 'col_solana_pump_live',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  entryReason: 'BONDING_CURVE_INITIALIZE',
  isFirstParty: true,
  sourceAvailableAt: '2026-08-20T10:00:00.005Z',
  firstIngestedAt: '2026-08-20T10:00:00.010Z',
  sourceMetadataHash: 'sha256:hash_unnormalized',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: false, // Refusal: unnormalized identity cannot establish claims
  qualityCodes: [],
};

export const INCOMPLETE_ENTRY_INVERTED_TIMESTAMPS = {
  assetRepresentationId: 'asset_rep_incomplete_003',
  sourceId: 'col_solana_pump_live',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  entryReason: 'BONDING_CURVE_INITIALIZE',
  isFirstParty: true,
  sourceAvailableAt: '2026-08-20T10:00:05.000Z',
  firstIngestedAt: '2026-08-20T10:00:01.000Z', // Inverted: firstIngestedAt < sourceAvailableAt
  sourceMetadataHash: 'sha256:hash_inverted',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: [],
};

export const INCOMPLETE_ENTRY_NON_SHA256_HASH = {
  assetRepresentationId: 'asset_rep_incomplete_004',
  sourceId: 'col_solana_pump_live',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  entryReason: 'BONDING_CURVE_INITIALIZE',
  isFirstParty: true,
  sourceAvailableAt: '2026-08-20T10:00:00.005Z',
  firstIngestedAt: '2026-08-20T10:00:00.010Z',
  sourceMetadataHash: 'md5:bad_hash_format', // Refusal: non-sha256 hash
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: [],
};

export const UNBACKED_FIRST_PARTY_CLAIM_ENTRY = {
  assetRepresentationId: 'asset_rep_incomplete_005',
  sourceId: 'src_gmgn_free_aggregate',
  sourceClass: 'FREE_AGGREGATE_DISCOVERY',
  entryReason: 'AGGREGATE_DISCOVERY_FEED',
  isFirstParty: true, // Violation: FREE_AGGREGATE cannot be labeled first-party! (§63.12)
  sourceAvailableAt: '2026-08-20T10:00:00.005Z',
  firstIngestedAt: '2026-08-20T10:00:00.010Z',
  sourceMetadataHash: 'sha256:hash_unbacked',
  discoveryPolicyVersion: '1.0.0',
  normalizedIdentity: true,
  qualityCodes: [],
};
