/**
 * Golden metric inputs fixtures (§63.8 coverage metrics, FR-DISC-007, FR-DISC-012).
 * Covers entries, dependence edges with proven multipliers, price observations,
 * gap windows, and every §63.8 metric bullet.
 * Traces: FR-DISC-007, FR-DISC-012.
 */
import type { UtcTimestamp } from '@foresift/domain';
import type {
  CoverageEntryFacts,
  CoverageDependenceFacts,
  SourceHealthWindow,
  DiscoveryEconomicObservation,
  SourceResourceAttribution,
  CoverageMetricOptions,
} from '../../../packages/discovery-universe/src/coverage-metrics.ts';
import type {
  DiscoveryUniverseEntry,
  CoveragePopulationManifest,
} from '../../../packages/shared-schemas/src/disc.ts';

// -----------------------------------------------------------------------------
// 1. Golden Universe Entries covering multiple sources and timing dimensions
// -----------------------------------------------------------------------------

export const GOLDEN_ASSET_IDS = [
  'asset_rep_sol_pump_001',
  'asset_rep_sol_pump_002',
  'asset_rep_sol_pump_003',
  'asset_rep_sol_pump_004',
  'asset_rep_sol_pump_005',
  'asset_rep_sol_raydium_006',
  'asset_rep_sol_unsupported_007',
  'asset_rep_sol_unresolved_008',
] as const;

export const GOLDEN_SOURCE_FIRST_PARTY = 'col_solana_pump_live';
export const GOLDEN_SOURCE_AGGREGATE = 'src_gmgn_free_aggregate';
export const GOLDEN_SOURCE_LAUNCH_FEED = 'src_pump_official_webhook';
export const GOLDEN_SOURCE_DEPENDENT_AGGREGATE = 'src_dexscreener_feed';

export const GOLDEN_METRIC_ENTRIES: readonly DiscoveryUniverseEntry[] = [
  // Asset 001: First-party observed earliest, seen by aggregate and launch feed
  {
    assetRepresentationId: 'asset_rep_sol_pump_001',
    sourceId: GOLDEN_SOURCE_FIRST_PARTY,
    sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
    sourceObservedAt: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
    firstReceivedAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:00:00.010Z' as UtcTimestamp,
    chainCoordinates: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300100200:0:1',
    sourceRank: 1,
    sourceMetadataHash: 'sha256:golden_entry_meta_001a',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_FIRST_PARTY_VERIFIED'],
  },
  {
    assetRepresentationId: 'asset_rep_sol_pump_001',
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    sourceClass: 'FREE_AGGREGATE_DISCOVERY',
    sourceObservedAt: '2026-08-20T10:00:01.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:00:01.500Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:00:01.600Z' as UtcTimestamp,
    sourceRank: 2,
    sourceMetadataHash: 'sha256:golden_entry_meta_001b',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
  },
  {
    assetRepresentationId: 'asset_rep_sol_pump_001',
    sourceId: GOLDEN_SOURCE_LAUNCH_FEED,
    sourceClass: 'AUTHORIZED_LAUNCH_FEED',
    sourceObservedAt: '2026-08-20T10:00:00.200Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:00:00.300Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:00:00.350Z' as UtcTimestamp,
    sourceRank: 1,
    sourceMetadataHash: 'sha256:golden_entry_meta_001c',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_AUTHORIZED_FEED'],
  },
  // Asset 002: Unique to first-party
  {
    assetRepresentationId: 'asset_rep_sol_pump_002',
    sourceId: GOLDEN_SOURCE_FIRST_PARTY,
    sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
    sourceObservedAt: '2026-08-20T10:05:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:05:00.005Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:05:00.010Z' as UtcTimestamp,
    chainCoordinates: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:300100300:0:1',
    sourceRank: 1,
    sourceMetadataHash: 'sha256:golden_entry_meta_002a',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_FIRST_PARTY_VERIFIED'],
  },
  // Asset 003: Unique to aggregate provider
  {
    assetRepresentationId: 'asset_rep_sol_pump_003',
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    sourceClass: 'FREE_AGGREGATE_DISCOVERY',
    sourceObservedAt: '2026-08-20T10:10:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:10:00.500Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:10:00.600Z' as UtcTimestamp,
    sourceRank: 1,
    sourceMetadataHash: 'sha256:golden_entry_meta_003b',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
  },
  // Asset 004: Overlap between Aggregate and Dependent Aggregate
  {
    assetRepresentationId: 'asset_rep_sol_pump_004',
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    sourceClass: 'FREE_AGGREGATE_DISCOVERY',
    sourceObservedAt: '2026-08-20T10:15:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:15:00.500Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:15:00.600Z' as UtcTimestamp,
    sourceRank: 1,
    sourceMetadataHash: 'sha256:golden_entry_meta_004b',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
  },
  {
    assetRepresentationId: 'asset_rep_sol_pump_004',
    sourceId: GOLDEN_SOURCE_DEPENDENT_AGGREGATE,
    sourceClass: 'FREE_AGGREGATE_DISCOVERY',
    sourceObservedAt: '2026-08-20T10:15:01.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:15:01.500Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:15:01.600Z' as UtcTimestamp,
    sourceRank: 2,
    sourceMetadataHash: 'sha256:golden_entry_meta_004d',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
  },
  // Asset 005: Extended at first seen on aggregate source
  {
    assetRepresentationId: 'asset_rep_sol_pump_005',
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    sourceClass: 'FREE_AGGREGATE_DISCOVERY',
    sourceObservedAt: '2026-08-20T10:20:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:20:00.800Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:20:00.900Z' as UtcTimestamp,
    sourceRank: 1,
    sourceMetadataHash: 'sha256:golden_entry_meta_005b',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
  },
  // Asset 007: Unsupported program version
  {
    assetRepresentationId: 'asset_rep_sol_unsupported_007',
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    sourceClass: 'FREE_AGGREGATE_DISCOVERY',
    sourceObservedAt: '2026-08-20T10:25:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:25:00.500Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:25:00.600Z' as UtcTimestamp,
    sourceRank: 1,
    sourceMetadataHash: 'sha256:golden_entry_meta_007b',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_AGGREGATE_OBSERVED'],
  },
  // Asset 008: Unresolved identity
  {
    assetRepresentationId: 'asset_rep_sol_unresolved_008',
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    sourceClass: 'FREE_AGGREGATE_DISCOVERY',
    sourceObservedAt: '2026-08-20T10:30:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:30:00.500Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:30:00.600Z' as UtcTimestamp,
    sourceRank: 1,
    sourceMetadataHash: 'sha256:golden_entry_meta_008b',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: ['QUALITY_IDENTITY_UNRESOLVED'],
  },
];

// -----------------------------------------------------------------------------
// 2. Entry Facts covering §63.8 metric attributes
// -----------------------------------------------------------------------------

export const GOLDEN_ENTRY_FACTS: readonly CoverageEntryFacts[] = [
  {
    sourceId: GOLDEN_SOURCE_FIRST_PARTY,
    assetRepresentationId: 'asset_rep_sol_pump_001',
    identityResolved: true,
    firstPartyObservedAt: '2026-08-20T10:00:00.000Z',
    extendedAtFirstSeen: false,
    programId: 'prog_pump_fun',
    programVersion: '1.0.0',
    manipulationBoosted: false,
    usefulOutcome: true,
    tradableOutcome: true,
    falsePositive: false,
    cheapRejected: false,
    unsupportedLayout: false,
    retrospectivelyNotDiscovered: false,
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_pump_001',
    identityResolved: true,
    firstPartyObservedAt: '2026-08-20T10:00:00.000Z',
    extendedAtFirstSeen: false,
    programId: 'prog_pump_fun',
    programVersion: '1.0.0',
    manipulationBoosted: false,
    usefulOutcome: true,
    tradableOutcome: true,
    falsePositive: false,
    cheapRejected: false,
    unsupportedLayout: false,
    retrospectivelyNotDiscovered: false,
  },
  {
    sourceId: GOLDEN_SOURCE_LAUNCH_FEED,
    assetRepresentationId: 'asset_rep_sol_pump_001',
    identityResolved: true,
    firstPartyObservedAt: '2026-08-20T10:00:00.000Z',
    extendedAtFirstSeen: false,
    programId: 'prog_pump_fun',
    programVersion: '1.0.0',
    manipulationBoosted: false,
    usefulOutcome: true,
    tradableOutcome: true,
    falsePositive: false,
    cheapRejected: false,
  },
  {
    sourceId: GOLDEN_SOURCE_FIRST_PARTY,
    assetRepresentationId: 'asset_rep_sol_pump_002',
    identityResolved: true,
    firstPartyObservedAt: '2026-08-20T10:05:00.000Z',
    extendedAtFirstSeen: false,
    programId: 'prog_pump_fun',
    programVersion: '1.0.0',
    manipulationBoosted: false,
    usefulOutcome: true,
    tradableOutcome: true,
    falsePositive: false,
    cheapRejected: false,
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_pump_003',
    identityResolved: true,
    extendedAtFirstSeen: false,
    programId: 'prog_pump_fun',
    programVersion: '1.0.0',
    manipulationBoosted: true, // Boosted placement
    usefulOutcome: false,
    tradableOutcome: false,
    falsePositive: true, // False positive
    cheapRejected: true, // Cheap reject
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_pump_004',
    identityResolved: true,
    extendedAtFirstSeen: false,
    programId: 'prog_pump_fun',
    programVersion: '1.0.0',
    manipulationBoosted: false,
    usefulOutcome: true,
    tradableOutcome: true,
    falsePositive: false,
    cheapRejected: false,
  },
  {
    sourceId: GOLDEN_SOURCE_DEPENDENT_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_pump_004',
    identityResolved: true,
    extendedAtFirstSeen: false,
    programId: 'prog_pump_fun',
    programVersion: '1.0.0',
    manipulationBoosted: false,
    usefulOutcome: true,
    tradableOutcome: true,
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_pump_005',
    identityResolved: true,
    extendedAtFirstSeen: true, // Extended at first seen
    programId: 'prog_pump_fun',
    programVersion: '1.0.0',
    manipulationBoosted: false,
    usefulOutcome: true,
    tradableOutcome: true,
    unsupportedLayout: true, // Unsupported layout miss
    retrospectivelyNotDiscovered: true, // Retro not discovered
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_unsupported_007',
    identityResolved: true,
    programId: 'prog_pump_fun',
    programVersion: '2.0.0-unsupported', // Unsupported version
    usefulOutcome: false,
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_unresolved_008',
    identityResolved: false, // Unresolved identity
    usefulOutcome: false,
  },
];

// -----------------------------------------------------------------------------
// 3. Dependence Edges with Proven Multipliers
// -----------------------------------------------------------------------------

export const GOLDEN_INDEPENDENT_DEPENDENCE_FACT: CoverageDependenceFacts = {
  sourceA: GOLDEN_SOURCE_FIRST_PARTY,
  sourceB: GOLDEN_SOURCE_AGGREGATE,
  sharedUpstreamLineage: false,
  valueErrorTimingCorrelation: 0.1,
  outageOverlap: 0.05,
  firstSeenLagAgreement: 0.1,
  fingerprintSimilarity: 0.05,
};

export const GOLDEN_SHARED_LINEAGE_DEPENDENCE_FACT: CoverageDependenceFacts = {
  sourceA: GOLDEN_SOURCE_AGGREGATE,
  sourceB: GOLDEN_SOURCE_DEPENDENT_AGGREGATE,
  sharedUpstreamLineage: true, // Shared lineage caps credit at <= 0.25
  valueErrorTimingCorrelation: 0.85,
  outageOverlap: 0.6,
  firstSeenLagAgreement: 0.8,
  fingerprintSimilarity: 0.95,
};

export const GOLDEN_CORRELATED_DEPENDENCE_FACT: CoverageDependenceFacts = {
  sourceA: GOLDEN_SOURCE_LAUNCH_FEED,
  sourceB: GOLDEN_SOURCE_AGGREGATE,
  sharedUpstreamLineage: false,
  valueErrorTimingCorrelation: 0.9,
  outageOverlap: 0.4,
  firstSeenLagAgreement: 0.5,
  fingerprintSimilarity: 0.3,
};

export const GOLDEN_DEPENDENCE_FACTS: readonly CoverageDependenceFacts[] = [
  GOLDEN_INDEPENDENT_DEPENDENCE_FACT,
  GOLDEN_SHARED_LINEAGE_DEPENDENCE_FACT,
  GOLDEN_CORRELATED_DEPENDENCE_FACT,
];

// -----------------------------------------------------------------------------
// 4. Price Observations at First System Availability
// -----------------------------------------------------------------------------

export const GOLDEN_ECONOMIC_OBSERVATIONS: readonly DiscoveryEconomicObservation[] = [
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_pump_001',
    availableAt: '2026-08-20T10:00:01.500Z',
    firstSystemAvailablePrice: 1.25,
    sourceFirstSeenPrice: 1.0, // +25% price extension
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    assetRepresentationId: 'asset_rep_sol_pump_004',
    availableAt: '2026-08-20T10:15:00.500Z',
    firstSystemAvailablePrice: 2.1,
    sourceFirstSeenPrice: 2.0, // +5% price extension
  },
  {
    sourceId: GOLDEN_SOURCE_FIRST_PARTY,
    assetRepresentationId: 'asset_rep_sol_pump_001',
    availableAt: '2026-08-20T10:00:00.005Z',
    firstSystemAvailablePrice: 1.0,
    sourceFirstSeenPrice: 1.0, // 0% price extension
  },
];

// -----------------------------------------------------------------------------
// 5. Source Health Windows (Coverage Loss vs Collector Gaps)
// -----------------------------------------------------------------------------

export const GOLDEN_HEALTH_WINDOWS: readonly SourceHealthWindow[] = [
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    windowStart: '2026-08-20T08:00:00.000Z',
    windowEnd: '2026-08-20T09:00:00.000Z',
    collectorScopeHealthy: true,
    previouslyYielding: true,
    yieldedAssets: 10, // Normal yielding window
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    windowStart: '2026-08-20T09:00:00.000Z',
    windowEnd: '2026-08-20T09:30:00.000Z',
    collectorScopeHealthy: true,
    previouslyYielding: true,
    yieldedAssets: 0, // Genuine source coverage loss window
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    windowStart: '2026-08-20T09:30:00.000Z',
    windowEnd: '2026-08-20T10:00:00.000Z',
    collectorScopeHealthy: false, // Collector gap, NOT counted as source fault
    previouslyYielding: true,
    yieldedAssets: 0,
  },
];

// -----------------------------------------------------------------------------
// 6. Source Resource Attributions
// -----------------------------------------------------------------------------

export const GOLDEN_RESOURCE_ATTRIBUTIONS: readonly SourceResourceAttribution[] = [
  {
    sourceId: GOLDEN_SOURCE_FIRST_PARTY,
    cost: 10.0,
    credits: 50,
    bytes: 262144,
  },
  {
    sourceId: GOLDEN_SOURCE_AGGREGATE,
    cost: 45.0,
    credits: 300,
    bytes: 1048576,
  },
];

// -----------------------------------------------------------------------------
// 7. Supported Programs configuration
// -----------------------------------------------------------------------------

export const GOLDEN_SUPPORTED_PROGRAMS: Readonly<Record<string, readonly string[]>> = {
  prog_pump_fun: ['1.0.0', '1.1.0'],
  prog_raydium_v4: ['4.0.0'],
};

// -----------------------------------------------------------------------------
// 8. Population Manifests
// -----------------------------------------------------------------------------

export const GOLDEN_POPULATION_MANIFEST: CoveragePopulationManifest = {
  manifestId: 'cov_man_golden_pump_2026q3',
  populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
  collectorScopeIds: ['scope_solana_pump_v1'],
  sourceIds: [
    GOLDEN_SOURCE_FIRST_PARTY,
    GOLDEN_SOURCE_AGGREGATE,
    GOLDEN_SOURCE_LAUNCH_FEED,
    GOLDEN_SOURCE_DEPENDENT_AGGREGATE,
  ],
  startSlot: '300100000',
  endSlot: '300200000',
  startTime: '2026-08-20T00:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T23:59:59Z' as UtcTimestamp,
  knownGapsCount: 2, // 2 collector gap misses
  rightsExclusions: [],
  sourceDependenceDisclosed: true,
};

// -----------------------------------------------------------------------------
// 9. Metric Options bundle
// -----------------------------------------------------------------------------

export const GOLDEN_METRIC_OPTIONS: CoverageMetricOptions = {
  entryFacts: GOLDEN_ENTRY_FACTS,
  dependenceFacts: GOLDEN_DEPENDENCE_FACTS,
  healthWindows: GOLDEN_HEALTH_WINDOWS,
  supportedPrograms: GOLDEN_SUPPORTED_PROGRAMS,
  economicObservations: GOLDEN_ECONOMIC_OBSERVATIONS,
  resourceAttribution: GOLDEN_RESOURCE_ATTRIBUTIONS,
  profileVersions: {
    [GOLDEN_SOURCE_FIRST_PARTY]: 1,
    [GOLDEN_SOURCE_AGGREGATE]: 1,
    [GOLDEN_SOURCE_LAUNCH_FEED]: 1,
    [GOLDEN_SOURCE_DEPENDENT_AGGREGATE]: 1,
  },
};

// -----------------------------------------------------------------------------
// 10. Provider Lateness Basis Test Streams
// -----------------------------------------------------------------------------

export const LATENESS_STREAM_SOURCE_OBSERVED: readonly DiscoveryUniverseEntry[] = [
  {
    assetRepresentationId: 'asset_rep_sol_lat_001',
    sourceId: 'src_lateness_observed_test',
    sourceClass: 'FREE_AGGREGATE_DISCOVERY',
    sourceObservedAt: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:00:02.000Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:00:03.000Z' as UtcTimestamp, // lateness = 3.0s
    sourceMetadataHash: 'sha256:lat_meta_001',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: [],
  },
];

export const LATENESS_STREAM_SOURCE_PUBLISHED: readonly DiscoveryUniverseEntry[] = [
  {
    assetRepresentationId: 'asset_rep_sol_lat_002',
    sourceId: 'src_lateness_published_test',
    sourceClass: 'AUTHORIZED_LAUNCH_FEED',
    sourcePublishedAt: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
    sourceAvailableAt: '2026-08-20T10:00:01.000Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:00:01.500Z' as UtcTimestamp, // lateness = 1.5s
    sourceMetadataHash: 'sha256:lat_meta_002',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: [],
  },
];

export const LATENESS_STREAM_SOURCE_AVAILABLE_ONLY: readonly DiscoveryUniverseEntry[] = [
  {
    assetRepresentationId: 'asset_rep_sol_lat_003',
    sourceId: 'src_lateness_available_test',
    sourceClass: 'SELECTIVE_CHAIN_VERIFICATION',
    sourceAvailableAt: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
    firstIngestedAt: '2026-08-20T10:00:00.400Z' as UtcTimestamp, // lateness = 0.4s
    sourceMetadataHash: 'sha256:lat_meta_003',
    discoveryPolicyVersion: '1.0.0',
    qualityCodes: [],
  },
];
