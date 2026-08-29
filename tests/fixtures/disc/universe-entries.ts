import type { UtcTimestamp } from '@foresift/domain';

export interface DiscoveryUniverseEntryFixture {
  readonly assetRepresentationId: string;
  readonly sourceId: string;
  readonly sourceClass: string;
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
  readonly collectorCoverageManifestId?: string;
  readonly qualityCodes: readonly string[];
}

export const FIRST_PARTY_DISCOVERY_ENTRY: DiscoveryUniverseEntryFixture = {
  assetRepresentationId: 'asset_rep_sol_pump_token_001',
  sourceId: 'col_solana_pump_live',
  sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  sourceObservedAt: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
  firstReceivedAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:00:00.010Z' as UtcTimestamp,
  chainCoordinates: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300100200:0:2',
  sourceRank: 1,
  sourceMetadataHash: 'sha256:first_party_meta_hash_001',
  discoveryPolicyVersion: '1.0.0',
  collectorCoverageManifestId: 'man_pump_v1_001',
  qualityCodes: ['QUALITY_FIRST_PARTY_VERIFIED'],
};

export const FREE_AGGREGATE_DISCOVERY_ENTRY: DiscoveryUniverseEntryFixture = {
  assetRepresentationId: 'asset_rep_sol_pump_token_001',
  sourceId: 'src_gmgn_free_aggregate',
  sourceClass: 'FREE_AGGREGATE_DISCOVERY',
  sourceObservedAt: '2026-08-20T10:00:01.500Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:00:02.000Z' as UtcTimestamp,
  firstFetchedAt: '2026-08-20T10:00:02.100Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:00:02.200Z' as UtcTimestamp,
  sourceRank: 2,
  sourceMetadataHash: 'sha256:free_aggregate_meta_hash_002',
  discoveryPolicyVersion: '1.0.0',
  qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
};

export const AUTHORIZED_LAUNCH_FEED_ENTRY: DiscoveryUniverseEntryFixture = {
  assetRepresentationId: 'asset_rep_sol_pump_token_001',
  sourceId: 'src_pump_official_webhook',
  sourceClass: 'AUTHORIZED_LAUNCH_FEED',
  sourceObservedAt: '2026-08-20T10:00:00.200Z' as UtcTimestamp,
  sourceAvailableAt: '2026-08-20T10:00:00.400Z' as UtcTimestamp,
  firstReceivedAt: '2026-08-20T10:00:00.400Z' as UtcTimestamp,
  firstIngestedAt: '2026-08-20T10:00:00.450Z' as UtcTimestamp,
  sourceRank: 1,
  sourceMetadataHash: 'sha256:auth_launch_meta_hash_003',
  discoveryPolicyVersion: '1.0.0',
  qualityCodes: ['QUALITY_AUTHORIZED_FEED'],
};
