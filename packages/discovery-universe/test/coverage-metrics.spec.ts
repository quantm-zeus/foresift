/**
 * Metric golden vectors: unique yield, pairwise overlap, effective independent yield,
 * lead/lag, provider lateness bases, coverage loss, extended-at-first-seen, identity failures,
 * unsupported-program exclusions, and price extensions (FR-DISC-007, FR-DISC-009, FR-DISC-012).
 */
import { describe, expect, it } from 'bun:test';
import {
  calculateUniqueDiscoveryYield,
  calculatePairwiseOverlap,
  calculateEffectiveIndependentYield,
  calculateFirstSeenLeadLag,
  calculateProviderLateness,
  calculateSourceCoverageLoss,
  measureCoverageSnapshot,
  distribution,
  type CoverageEntryFacts,
  type CoverageDependenceFacts,
  type SourceHealthWindow,
  type DiscoveryEconomicObservation,
} from '../src/coverage-metrics.ts';
import type { UniverseSnapshot } from '../src/universe-registry.ts';
import type { DiscoveryUniverseEntry } from '@foresift/shared-schemas';

describe('Coverage Metric Calculations (FR-DISC-007, FR-DISC-012)', () => {
  const entries: DiscoveryUniverseEntry[] = [
    {
      assetRepresentationId: 'asset_A',
      sourceId: 'src_pump',
      sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
      sourceAvailableAt: '2026-08-20T10:00:00Z',
      firstIngestedAt: '2026-08-20T10:00:01Z',
      sourceMetadataHash: 'sha256:aaaa',
      discoveryPolicyVersion: '1.0.0',
      qualityCodes: [],
    },
    {
      assetRepresentationId: 'asset_B',
      sourceId: 'src_pump',
      sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
      sourceAvailableAt: '2026-08-20T10:05:00Z',
      firstIngestedAt: '2026-08-20T10:05:01Z',
      sourceMetadataHash: 'sha256:bbbb',
      discoveryPolicyVersion: '1.0.0',
      qualityCodes: [],
    },
    {
      assetRepresentationId: 'asset_B',
      sourceId: 'src_gmgn',
      sourceClass: 'FREE_AGGREGATE_DISCOVERY',
      sourceObservedAt: '2026-08-20T10:04:50Z',
      sourceAvailableAt: '2026-08-20T10:05:02Z',
      firstIngestedAt: '2026-08-20T10:05:04Z',
      sourceMetadataHash: 'sha256:cccc',
      discoveryPolicyVersion: '1.0.0',
      qualityCodes: [],
    },
    {
      assetRepresentationId: 'asset_C',
      sourceId: 'src_gmgn',
      sourceClass: 'FREE_AGGREGATE_DISCOVERY',
      sourceObservedAt: '2026-08-20T10:10:00Z',
      sourceAvailableAt: '2026-08-20T10:10:05Z',
      firstIngestedAt: '2026-08-20T10:10:08Z',
      sourceMetadataHash: 'sha256:dddd',
      discoveryPolicyVersion: '1.0.0',
      qualityCodes: [],
    },
  ];

  it('calculates unique discovery yield', () => {
    // asset_A is only on src_pump -> yield 1
    // asset_C is only on src_gmgn -> yield 1
    // asset_B is on both -> not unique
    expect(calculateUniqueDiscoveryYield(entries, 'src_pump')).toBe(1);
    expect(calculateUniqueDiscoveryYield(entries, 'src_gmgn')).toBe(1);
    expect(calculateUniqueDiscoveryYield(entries, 'src_unknown')).toBe(0);
  });

  it('calculates pairwise overlap', () => {
    const pumpOverlap = calculatePairwiseOverlap(entries, 'src_pump');
    expect(pumpOverlap).toEqual({ src_gmgn: 1 });

    const gmgnOverlap = calculatePairwiseOverlap(entries, 'src_gmgn');
    expect(gmgnOverlap).toEqual({ src_pump: 1 });
  });

  it('calculates effective independent yield with dependence multiplier', () => {
    const dependenceFacts: CoverageDependenceFacts[] = [
      {
        sourceA: 'src_pump',
        sourceB: 'src_gmgn',
        sharedUpstreamLineage: false,
        valueErrorTimingCorrelation: 0.1,
        outageOverlap: 0.1,
        firstSeenLagAgreement: 0.1,
        fingerprintSimilarity: 0.1,
      },
    ];
    // uniqueYield = 1, overlap with src_gmgn = 1, multiplier >= 0
    const effective = calculateEffectiveIndependentYield(
      1,
      { src_gmgn: 1 },
      'src_pump',
      dependenceFacts,
    );
    expect(effective).not.toBeNull();
    expect(effective).toBeGreaterThan(1);

    // Missing dependence edge returns null
    const missingEdge = calculateEffectiveIndependentYield(1, { src_other: 2 }, 'src_pump', []);
    expect(missingEdge).toBeNull();
  });

  it('calculates first-seen lead/lag distribution', () => {
    const facts = new Map<string, CoverageEntryFacts>([
      [
        'src_pump\u0000asset_A',
        {
          sourceId: 'src_pump',
          assetRepresentationId: 'asset_A',
          identityResolved: true,
          firstPartyObservedAt: '2026-08-20T09:59:50Z', // 10s lead
        },
      ],
      [
        'src_pump\u0000asset_B',
        {
          sourceId: 'src_pump',
          assetRepresentationId: 'asset_B',
          identityResolved: true,
          firstPartyObservedAt: '2026-08-20T10:04:40Z', // 20s lead
        },
      ],
    ]);

    const leadLag = calculateFirstSeenLeadLag(entries, 'src_pump', facts);
    expect(leadLag).not.toBeNull();
    expect(leadLag?.count).toBe(2);
    expect(leadLag?.min).toBe(10);
    expect(leadLag?.max).toBe(20);
  });

  it('calculates provider lateness with basis priority', () => {
    // src_gmgn has sourceObservedAt -> basis is SOURCE_OBSERVED_AT
    // e3: ingested 10:05:04, observed 10:04:50 -> 14s
    // e4: ingested 10:10:08, observed 10:10:00 -> 8s
    const gmgnLateness = calculateProviderLateness(entries, 'src_gmgn');
    expect(gmgnLateness.basis).toBe('SOURCE_OBSERVED_AT');
    expect(gmgnLateness.values?.count).toBe(2);
    expect(gmgnLateness.values?.min).toBe(8);
    expect(gmgnLateness.values?.max).toBe(14);

    // src_pump has only sourceAvailableAt -> basis is SOURCE_AVAILABLE_AT
    const pumpLateness = calculateProviderLateness(entries, 'src_pump');
    expect(pumpLateness.basis).toBe('SOURCE_AVAILABLE_AT');
    expect(pumpLateness.values?.count).toBe(2);
    expect(pumpLateness.values?.min).toBe(1);
    expect(pumpLateness.values?.max).toBe(1);
  });

  it('calculates source coverage loss windows', () => {
    const windows: SourceHealthWindow[] = [
      {
        sourceId: 'src_pump',
        windowStart: '2026-08-20T08:00:00Z',
        windowEnd: '2026-08-20T09:00:00Z',
        collectorScopeHealthy: true,
        previouslyYielding: true,
        yieldedAssets: 0, // Loss window!
      },
      {
        sourceId: 'src_pump',
        windowStart: '2026-08-20T09:00:00Z',
        windowEnd: '2026-08-20T10:00:00Z',
        collectorScopeHealthy: true,
        previouslyYielding: true,
        yieldedAssets: 5, // Normal window
      },
      {
        sourceId: 'src_pump',
        windowStart: '2026-08-20T10:00:00Z',
        windowEnd: '2026-08-20T11:00:00Z',
        collectorScopeHealthy: false, // Collector was down -> not a coverage loss
        previouslyYielding: true,
        yieldedAssets: 0,
      },
    ];

    const loss = calculateSourceCoverageLoss('src_pump', windows, '2026-08-20T12:00:00Z');
    expect(loss).toBe(1);
  });

  it('computes distribution summary correctly', () => {
    expect(distribution([])).toBeNull();
    const dist = distribution([10, 20, 30, 40, 50]);
    expect(dist).toEqual({
      count: 5,
      min: 10,
      p50: 30,
      p95: 50,
      max: 50,
    });
  });
});

describe('measureCoverageSnapshot Golden Vectors (FR-DISC-007, FR-DISC-009, FR-DISC-012)', () => {
  const snapshot: UniverseSnapshot = {
    manifest: {
      manifestId: 'man_test_001',
      populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
      sourceIds: ['src_pump', 'src_gmgn'],
      collectorScopeIds: ['col_solana_live'],
      startTime: '2026-08-20T10:00:00Z',
      endTime: '2026-08-20T12:00:00Z',
      startSlot: '1000',
      endSlot: '2000',
      knownGapsCount: 0,
      rightsExclusions: [],
      sourceDependenceDisclosed: true,
      selectionProbabilities: {},
    },
    entries: [
      {
        assetRepresentationId: 'asset_1',
        sourceId: 'src_pump',
        sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
        sourceAvailableAt: '2026-08-20T10:00:00Z',
        firstIngestedAt: '2026-08-20T10:00:01Z',
        sourceMetadataHash: 'sha256:1111',
        discoveryPolicyVersion: '1.0.0',
        qualityCodes: [],
      },
      {
        assetRepresentationId: 'asset_2',
        sourceId: 'src_pump',
        sourceClass: 'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
        sourceAvailableAt: '2026-08-20T10:10:00Z',
        firstIngestedAt: '2026-08-20T10:10:01Z',
        sourceMetadataHash: 'sha256:2222',
        discoveryPolicyVersion: '1.0.0',
        qualityCodes: [],
      },
    ],
    sourceOverlap: {},
    uniqueYield: {},
  };

  const entryFacts: CoverageEntryFacts[] = [
    {
      sourceId: 'src_pump',
      assetRepresentationId: 'asset_1',
      identityResolved: true,
      firstPartyObservedAt: '2026-08-20T09:59:58Z',
      extendedAtFirstSeen: true,
      programId: '6EF8',
      programVersion: '1.0.0',
      usefulOutcome: true,
      tradableOutcome: true,
      falsePositive: false,
      cheapRejected: false,
    },
    {
      sourceId: 'src_pump',
      assetRepresentationId: 'asset_2',
      identityResolved: true,
      firstPartyObservedAt: '2026-08-20T10:09:55Z',
      extendedAtFirstSeen: false,
      programId: '6EF8',
      programVersion: '2.0.0', // Unsupported version
      usefulOutcome: false,
      tradableOutcome: false,
      falsePositive: true,
      cheapRejected: false,
    },
  ];

  const economic: DiscoveryEconomicObservation[] = [
    {
      sourceId: 'src_pump',
      assetRepresentationId: 'asset_1',
      availableAt: '2026-08-20T10:00:00Z',
      firstSystemAvailablePrice: 1.5,
      sourceFirstSeenPrice: 1.0, // (1.5 / 1.0) - 1 = 0.5 (50% extension)
    },
  ];

  it('measures complete coverage metric set with quality codes and exclusions', () => {
    const metrics = measureCoverageSnapshot(snapshot, 'src_pump', '2026-08-20T12:00:00Z', {
      entryFacts,
      supportedPrograms: { '6EF8': ['1.0.0'] },
      economicObservations: economic,
      resourceAttribution: [{ sourceId: 'src_pump', cost: 10, credits: 50, bytes: 1000 }],
    });

    expect(metrics.manifestId).toBe('man_test_001');
    expect(metrics.sourceId).toBe('src_pump');
    expect(metrics.uniqueDiscoveryYield).toBe(2);
    expect(metrics.unsupportedProgramExclusions).toBe(1); // asset_2 has version 2.0.0
    expect(metrics.extendedAtFirstSeenRate).toBe(1.0); // 1 out of 1 eligible fact is extended
    expect(metrics.priceExtensionAtFirstSystemAvailability).toBeCloseTo(0.5, 4);
    expect(metrics.costPerUsefulDiscovery).toBe(10);
    expect(metrics.creditsPerUsefulDiscovery).toBe(50);
    expect(metrics.bytesPerUsefulDiscovery).toBe(1000);
    expect(metrics.identityFailureRate).toBe(0);
  });
});
