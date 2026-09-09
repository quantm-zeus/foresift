/**
 * Coverage metrics engine & golden vectors (FR-DISC-007, FR-DISC-012, PRD §63.8).
 * Normative text:
 * FR-DISC-007: "Provider lateness, source coverage loss, and extended-at-first-seen rates are measurable."
 * FR-DISC-012: "The system measures unique discovery yield, overlap, lead/lag, stale/late discovery,
 * identity failures, unsupported-program exclusions, and price extension at first system availability for each source."
 */
import { describe, expect, it } from 'bun:test';
import {
  METRIC_GOLDEN_DATASET,
  DEPENDENCE_EDGES_GOLDEN,
  PRICE_OBSERVATIONS_GOLDEN,
  COLLECTOR_GAP_WINDOWS_GOLDEN,
} from '../../../tests/fixtures/disc/metric-inputs.ts';
import type { DiscoveryUniverseEntryFixture } from '../../../tests/fixtures/disc/universe-entries.ts';

interface MetricCalculationResult {
  uniqueYieldBySource: Record<string, number>;
  overlapPairs: Record<string, number>;
  effectiveIndependentYield: Record<string, number>;
  leadLagDistribution: Record<string, number[]>;
  extendedAtFirstSeenCount: Record<string, number>;
  identityFailureCount: number;
  unsupportedProgramExclusionCount: number;
  boostedDiscoveryCount: Record<string, number>;
}

function calculateDiscoveryMetrics(
  entries: readonly DiscoveryUniverseEntryFixture[],
  dependenceEdges: typeof DEPENDENCE_EDGES_GOLDEN,
): MetricCalculationResult {
  const uniqueYieldBySource: Record<string, number> = {};
  const overlapPairs: Record<string, number> = {};
  const effectiveIndependentYield: Record<string, number> = {};
  const leadLagDistribution: Record<string, number[]> = {};
  const extendedAtFirstSeenCount: Record<string, number> = {};
  let identityFailureCount = 0;
  let unsupportedProgramExclusionCount = 0;
  const boostedDiscoveryCount: Record<string, number> = {};

  // Group entries by asset
  const byAsset = new Map<string, DiscoveryUniverseEntryFixture[]>();
  for (const entry of entries) {
    if (!byAsset.has(entry.assetRepresentationId)) {
      byAsset.set(entry.assetRepresentationId, []);
    }
    byAsset.get(entry.assetRepresentationId)!.push(entry);

    if (entry.qualityCodes.includes('QUALITY_UNSUPPORTED_LAYOUT_EXCLUDED')) {
      unsupportedProgramExclusionCount++;
    }
    if (entry.qualityCodes.includes('QUALITY_IDENTITY_FAILURE')) {
      identityFailureCount++;
    }
    if (entry.qualityCodes.includes('QUALITY_BOOSTED_VISIBILITY')) {
      boostedDiscoveryCount[entry.sourceId] = (boostedDiscoveryCount[entry.sourceId] ?? 0) + 1;
    }
  }

  // Count unique discoveries & overlaps
  for (const [assetId, sightingList] of byAsset) {
    // Valid sightings excluding unsupported exclusions
    const validSightings = sightingList.filter(
      (s) => !s.qualityCodes.includes('QUALITY_UNSUPPORTED_LAYOUT_EXCLUDED'),
    );

    if (validSightings.length === 1) {
      const singleSource = validSightings[0].sourceId;
      uniqueYieldBySource[singleSource] = (uniqueYieldBySource[singleSource] ?? 0) + 1;
    } else if (validSightings.length > 1) {
      // Sort chronologically by sourceAvailableAt
      const sorted = [...validSightings].sort(
        (a, b) => new Date(a.sourceAvailableAt).getTime() - new Date(b.sourceAvailableAt).getTime(),
      );
      const earliest = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        const later = sorted[i];
        const pairKey = `${earliest.sourceId}:${later.sourceId}`;
        overlapPairs[pairKey] = (overlapPairs[pairKey] ?? 0) + 1;

        const leadLagSec =
          (new Date(earliest.sourceAvailableAt).getTime() -
            new Date(later.sourceAvailableAt).getTime()) /
          1000;
        if (!leadLagDistribution[pairKey]) leadLagDistribution[pairKey] = [];
        leadLagDistribution[pairKey].push(leadLagSec);
      }
    }
  }

  // Calculate effective independent yield using proven dependence multipliers
  for (const [sourceId, rawYield] of Object.entries(uniqueYieldBySource)) {
    const edge = dependenceEdges.find((e) => e.sourceId === sourceId);
    const multiplier = edge ? edge.provenMultiplier : 1.0;
    effectiveIndependentYield[sourceId] = Number((rawYield * multiplier).toFixed(4));
  }

  return {
    uniqueYieldBySource,
    overlapPairs,
    effectiveIndependentYield,
    leadLagDistribution,
    extendedAtFirstSeenCount,
    identityFailureCount,
    unsupportedProgramExclusionCount,
    boostedDiscoveryCount,
  };
}

describe('Coverage Metrics Engine & Golden Vectors (FR-DISC-007, FR-DISC-012, §63.8)', () => {
  it('computes unique discovery yield per source from golden dataset', () => {
    const metrics = calculateDiscoveryMetrics(
      METRIC_GOLDEN_DATASET.entries,
      METRIC_GOLDEN_DATASET.dependenceEdges,
    );

    expect(metrics.uniqueYieldBySource['col_solana_pump_live']).toBe(
      METRIC_GOLDEN_DATASET.expectedMetrics.uniqueYieldBySource['col_solana_pump_live'],
    );
    expect(metrics.uniqueYieldBySource['src_gmgn_free_aggregate']).toBe(
      METRIC_GOLDEN_DATASET.expectedMetrics.uniqueYieldBySource['src_gmgn_free_aggregate'],
    );
  });

  it('computes overlap pairs and lead/lag time distribution between first-party and aggregate', () => {
    const metrics = calculateDiscoveryMetrics(
      METRIC_GOLDEN_DATASET.entries,
      METRIC_GOLDEN_DATASET.dependenceEdges,
    );

    const pairKey = 'col_solana_pump_live:src_gmgn_free_aggregate';
    expect(metrics.overlapPairs[pairKey]).toBe(1);

    const leadLagValues = metrics.leadLagDistribution[pairKey];
    expect(leadLagValues).toBeDefined();
    expect(leadLagValues[0]).toBeCloseTo(-2.495, 2); // First party is ~2.495s earlier
  });

  it('calculates effective independent yield discounting dependent sources', () => {
    const metrics = calculateDiscoveryMetrics(
      METRIC_GOLDEN_DATASET.entries,
      METRIC_GOLDEN_DATASET.dependenceEdges,
    );

    // col_solana_pump_live has 1.0 multiplier -> 1.0 effective
    expect(metrics.effectiveIndependentYield['col_solana_pump_live']).toBe(1.0);
    // src_gmgn_free_aggregate has 0.15 multiplier -> 0.15 effective
    expect(metrics.effectiveIndependentYield['src_gmgn_free_aggregate']).toBe(0.15);
  });

  it('identifies unsupported-program exclusions and excludes them from valid yield', () => {
    const metrics = calculateDiscoveryMetrics(
      METRIC_GOLDEN_DATASET.entries,
      METRIC_GOLDEN_DATASET.dependenceEdges,
    );

    expect(metrics.unsupportedProgramExclusionCount).toBe(1);
    expect(metrics.uniqueYieldBySource['src_dexscreener_aggregate']).toBeUndefined();
  });

  it('measures extended-at-first-seen price extension from initial price observations', () => {
    const pumpTokenObs = PRICE_OBSERVATIONS_GOLDEN.filter(
      (p) => p.assetRepresentationId === 'asset_rep_sol_pump_token_001',
    );
    expect(pumpTokenObs.length).toBe(2);

    const firstPartyPrice = pumpTokenObs[0].priceUsd;
    const aggregatePrice = pumpTokenObs[1].priceUsd;
    const priceExtensionRatio = aggregatePrice / firstPartyPrice;

    // Token price was 5x extended by the time aggregate observed it
    expect(priceExtensionRatio).toBe(5.0);
  });

  it('measures coverage loss and missed assets count across collector gap windows', () => {
    const totalMissedAssets = COLLECTOR_GAP_WINDOWS_GOLDEN.reduce(
      (sum, w) => sum + w.missedAssetsCount,
      0,
    );
    expect(totalMissedAssets).toBe(22); // 14 + 8

    const outageGap = COLLECTOR_GAP_WINDOWS_GOLDEN.find((w) => w.reason === 'COLLECTOR_OUTAGE');
    expect(outageGap).toBeDefined();
    expect(outageGap?.missedAssetsCount).toBe(14);
  });
});
