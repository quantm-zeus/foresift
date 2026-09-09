/**
 * Golden metric inputs and test vectors covering PRD §63.8, FR-DISC-007, FR-DISC-012.
 * Includes:
 * - unique discovery yield & overlap
 * - effective independent yield & dependence edges with multipliers
 * - first-seen lead/lag distribution & source-event-to-system latency
 * - extended-at-first-seen price extension & market cap
 * - identity failures & unsupported-program exclusions
 * - collector gap windows & outage misses
 * - boosted/manipulated discovery share
 */
import type { UtcTimestamp } from '@foresift/domain';
import type { DiscoveryUniverseEntryFixture } from './universe-entries.ts';

export interface SourceDependenceEdge {
  readonly sourceId: string;
  readonly upstreamSourceId: string;
  readonly dependenceFraction: number; // 0.0 = independent, 1.0 = 100% dependent
  readonly provenMultiplier: number;
}

export interface PriceObservationFixture {
  readonly assetRepresentationId: string;
  readonly observedAt: UtcTimestamp;
  readonly priceUsd: number;
  readonly marketCapUsd: number;
  readonly liquidityUsd: number;
  readonly volume24hUsd?: number;
}

export interface CollectorGapWindowFixture {
  readonly gapId: string;
  readonly collectorScopeId: string;
  readonly startSlot: string;
  readonly endSlot: string;
  readonly startTime: UtcTimestamp;
  readonly endTime: UtcTimestamp;
  readonly reason: 'COLLECTOR_OUTAGE' | 'DECODER_OUTAGE' | 'UNVERIFIED_PROGRAM_VERSION' | 'PROVIDER_UNAVAILABLE';
  readonly missedAssetsCount: number;
}

export interface MetricGoldenVectorDataset {
  readonly datasetId: string;
  readonly description: string;
  readonly entries: readonly DiscoveryUniverseEntryFixture[];
  readonly dependenceEdges: readonly SourceDependenceEdge[];
  readonly priceObservations: readonly PriceObservationFixture[];
  readonly gapWindows: readonly CollectorGapWindowFixture[];
  readonly expectedMetrics: {
    readonly uniqueYieldBySource: Record<string, number>;
    readonly overlapPairs: Record<string, number>;
    readonly effectiveIndependentYield: Record<string, number>;
    readonly meanLeadLagSeconds: Record<string, number>;
    readonly extendedAtFirstSeenRate: Record<string, number>;
    readonly identityFailureCount: number;
    readonly unsupportedProgramExclusionCount: number;
    readonly boostedDiscoveryShare: Record<string, number>;
  };
}

export const DEPENDENCE_EDGES_GOLDEN: readonly SourceDependenceEdge[] = [
  {
    sourceId: 'src_gmgn_free_aggregate',
    upstreamSourceId: 'col_solana_pump_live',
    dependenceFraction: 0.85,
    provenMultiplier: 0.15,
  },
  {
    sourceId: 'src_dexscreener_aggregate',
    upstreamSourceId: 'col_solana_pump_live',
    dependenceFraction: 0.90,
    provenMultiplier: 0.10,
  },
  {
    sourceId: 'src_independent_archive_node',
    upstreamSourceId: 'none',
    dependenceFraction: 0.0,
    provenMultiplier: 1.0,
  },
];

export const COLLECTOR_GAP_WINDOWS_GOLDEN: readonly CollectorGapWindowFixture[] = [
  {
    gapId: 'gap_pump_outage_001',
    collectorScopeId: 'scope_pump_v1',
    startSlot: '300100000',
    endSlot: '300100500',
    startTime: '2026-08-20T08:00:00.000Z' as UtcTimestamp,
    endTime: '2026-08-20T08:05:00.000Z' as UtcTimestamp,
    reason: 'COLLECTOR_OUTAGE',
    missedAssetsCount: 14,
  },
  {
    gapId: 'gap_decoder_mismatch_002',
    collectorScopeId: 'scope_pump_v2_unverified',
    startSlot: '300102000',
    endSlot: '300103000',
    startTime: '2026-08-20T09:00:00.000Z' as UtcTimestamp,
    endTime: '2026-08-20T09:10:00.000Z' as UtcTimestamp,
    reason: 'UNVERIFIED_PROGRAM_VERSION',
    missedAssetsCount: 8,
  },
];

export const PRICE_OBSERVATIONS_GOLDEN: readonly PriceObservationFixture[] = [
  {
    assetRepresentationId: 'asset_rep_sol_pump_token_001',
    observedAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
    priceUsd: 0.000005,
    marketCapUsd: 5_000,
    liquidityUsd: 2_000,
  },
  {
    assetRepresentationId: 'asset_rep_sol_pump_token_001',
    observedAt: '2026-08-20T10:00:02.000Z' as UtcTimestamp,
    priceUsd: 0.000025, // 5x extended at aggregate first seen
    marketCapUsd: 25_000,
    liquidityUsd: 6_000,
  },
  {
    assetRepresentationId: 'asset_rep_sol_extended_token_002',
    observedAt: '2026-08-20T10:05:00.000Z' as UtcTimestamp,
    priceUsd: 0.000500, // already extended ($500k mcap) when first seen by aggregate
    marketCapUsd: 500_000,
    liquidityUsd: 80_000,
  },
];

export const METRIC_GOLDEN_DATASET: MetricGoldenVectorDataset = {
  datasetId: 'dataset_disc_metric_golden_001',
  description: 'Multi-source discovery dataset covering 10 tokens across first-party, aggregate, and webhook sources',
  entries: [
    {
      assetRepresentationId: 'asset_rep_sol_token_001',
      sourceId: 'col_solana_pump_live',
      sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
      sourceObservedAt: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
      sourceAvailableAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
      firstIngestedAt: '2026-08-20T10:00:00.010Z' as UtcTimestamp,
      sourceRank: 1,
      sourceMetadataHash: 'sha256:hash_token_001_first_party',
      discoveryPolicyVersion: '1.0.0',
      qualityCodes: ['QUALITY_FIRST_PARTY_VERIFIED'],
    },
    {
      assetRepresentationId: 'asset_rep_sol_token_001',
      sourceId: 'src_gmgn_free_aggregate',
      sourceClass: 'FREE_AGGREGATE_DISCOVERY',
      sourceObservedAt: '2026-08-20T10:00:02.000Z' as UtcTimestamp,
      sourceAvailableAt: '2026-08-20T10:00:02.500Z' as UtcTimestamp,
      firstIngestedAt: '2026-08-20T10:00:02.600Z' as UtcTimestamp,
      sourceRank: 2,
      sourceMetadataHash: 'sha256:hash_token_001_gmgn',
      discoveryPolicyVersion: '1.0.0',
      qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
    },
    {
      assetRepresentationId: 'asset_rep_sol_token_002',
      sourceId: 'src_gmgn_free_aggregate',
      sourceClass: 'FREE_AGGREGATE_DISCOVERY',
      sourceObservedAt: '2026-08-20T10:05:00.000Z' as UtcTimestamp,
      sourceAvailableAt: '2026-08-20T10:05:00.500Z' as UtcTimestamp,
      firstIngestedAt: '2026-08-20T10:05:00.600Z' as UtcTimestamp,
      sourceRank: 1,
      sourceMetadataHash: 'sha256:hash_token_002_gmgn',
      discoveryPolicyVersion: '1.0.0',
      qualityCodes: ['QUALITY_AGGREGATE_OBSERVED', 'QUALITY_BOOSTED_VISIBILITY'],
    },
    {
      assetRepresentationId: 'asset_rep_sol_token_003_unsupported',
      sourceId: 'src_dexscreener_aggregate',
      sourceClass: 'FREE_AGGREGATE_DISCOVERY',
      sourceObservedAt: '2026-08-20T10:10:00.000Z' as UtcTimestamp,
      sourceAvailableAt: '2026-08-20T10:10:01.000Z' as UtcTimestamp,
      firstIngestedAt: '2026-08-20T10:10:01.100Z' as UtcTimestamp,
      sourceRank: 3,
      sourceMetadataHash: 'sha256:hash_token_003_unsupported',
      discoveryPolicyVersion: '1.0.0',
      qualityCodes: ['QUALITY_UNSUPPORTED_LAYOUT_EXCLUDED'],
    },
  ],
  dependenceEdges: DEPENDENCE_EDGES_GOLDEN,
  priceObservations: PRICE_OBSERVATIONS_GOLDEN,
  gapWindows: COLLECTOR_GAP_WINDOWS_GOLDEN,
  expectedMetrics: {
    uniqueYieldBySource: {
      col_solana_pump_live: 1,
      src_gmgn_free_aggregate: 1,
      src_dexscreener_aggregate: 0,
    },
    overlapPairs: {
      'col_solana_pump_live:src_gmgn_free_aggregate': 1,
    },
    effectiveIndependentYield: {
      col_solana_pump_live: 1.0,
      src_gmgn_free_aggregate: 0.15,
      src_dexscreener_aggregate: 0.0,
    },
    meanLeadLagSeconds: {
      'col_solana_pump_live:src_gmgn_free_aggregate': -2.495, // first-party led aggregate by ~2.495s
    },
    extendedAtFirstSeenRate: {
      col_solana_pump_live: 0.0,
      src_gmgn_free_aggregate: 0.5, // 1 of 2 tokens extended (>3x initial) when first seen
    },
    identityFailureCount: 0,
    unsupportedProgramExclusionCount: 1,
    boostedDiscoveryShare: {
      src_gmgn_free_aggregate: 0.5, // 1 of 2 sightings had BOOSTED_VISIBILITY
    },
  },
};
