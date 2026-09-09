import {
  calculateEffectiveIndependenceMultiplier,
  utcTimestamp,
  visibleAt,
  type DependenceInputs,
} from '@foresift/domain';
import {
  CoverageMetricSetSchema,
  type CoverageMetricSet,
  type DiscoveryUniverseEntry,
} from '@foresift/shared-schemas';
import { type DiscoveryUniverseRegistry, type UniverseSnapshot } from './universe-registry.ts';

export type ProviderLatenessBasis =
  'SOURCE_OBSERVED_AT' | 'SOURCE_PUBLISHED_AT' | 'SOURCE_AVAILABLE_AT';

export interface CoverageEntryFacts {
  readonly sourceId: string;
  readonly assetRepresentationId: string;
  readonly identityResolved: boolean;
  readonly firstPartyObservedAt?: string;
  readonly extendedAtFirstSeen?: boolean;
  readonly programId?: string;
  readonly programVersion?: string;
  readonly manipulationBoosted?: boolean;
  readonly usefulOutcome?: boolean;
  readonly tradableOutcome?: boolean;
  readonly falsePositive?: boolean;
  readonly cheapRejected?: boolean;
  readonly unsupportedLayout?: boolean;
  readonly retrospectivelyNotDiscovered?: boolean;
}

export interface CoverageDependenceFacts extends DependenceInputs {
  readonly sourceA: string;
  readonly sourceB: string;
}

export interface SourceHealthWindow {
  readonly sourceId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly collectorScopeHealthy: boolean;
  readonly previouslyYielding: boolean;
  readonly yieldedAssets: number;
}

/** Read-only projection of an economic observation already proven by the data substrate. */
export interface DiscoveryEconomicObservation {
  readonly sourceId: string;
  readonly assetRepresentationId: string;
  readonly availableAt: string;
  readonly firstSystemAvailablePrice: number;
  readonly sourceFirstSeenPrice: number;
}

export interface SourceResourceAttribution {
  readonly sourceId: string;
  readonly cost: number;
  readonly credits: number;
  readonly bytes: number;
}

export interface CoverageMetricOptions {
  readonly entryFacts?: readonly CoverageEntryFacts[];
  readonly dependenceFacts?: readonly CoverageDependenceFacts[];
  readonly healthWindows?: readonly SourceHealthWindow[];
  readonly supportedPrograms?: Readonly<Record<string, readonly string[]>>;
  readonly economicObservations?: readonly DiscoveryEconomicObservation[];
  readonly resourceAttribution?: readonly SourceResourceAttribution[];
  readonly profileVersions?: Readonly<Record<string, number>>;
}

export interface MetricDistribution {
  readonly count: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] as number;
}

export function distribution(values: readonly number[]): MetricDistribution | null {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (sorted.length === 0) return null;
  return {
    count: sorted.length,
    min: sorted[0] as number,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] as number,
  };
}

function entryKey(
  entry: Pick<DiscoveryUniverseEntry, 'sourceId' | 'assetRepresentationId'>,
): string {
  return `${entry.sourceId}\u0000${entry.assetRepresentationId}`;
}

function visibleEntries(
  snapshot: UniverseSnapshot,
  asOf: string,
): readonly DiscoveryUniverseEntry[] {
  const boundary = utcTimestamp(asOf);
  return snapshot.entries.filter((entry) =>
    visibleAt({ availableAt: utcTimestamp(entry.firstIngestedAt) }, boundary),
  );
}

function resolvedEntries(
  entries: readonly DiscoveryUniverseEntry[],
  facts: ReadonlyMap<string, CoverageEntryFacts>,
): readonly DiscoveryUniverseEntry[] {
  return entries.filter((entry) => facts.get(entryKey(entry))?.identityResolved !== false);
}

export function calculateUniqueDiscoveryYield(
  entries: readonly DiscoveryUniverseEntry[],
  sourceId: string,
): number {
  const sourcesByAsset = new Map<string, Set<string>>();
  for (const entry of entries) {
    const sources = sourcesByAsset.get(entry.assetRepresentationId) ?? new Set<string>();
    sources.add(entry.sourceId);
    sourcesByAsset.set(entry.assetRepresentationId, sources);
  }
  return [...sourcesByAsset.values()].filter(
    (sources) => sources.size === 1 && sources.has(sourceId),
  ).length;
}

export function calculatePairwiseOverlap(
  entries: readonly DiscoveryUniverseEntry[],
  sourceId: string,
): Readonly<Record<string, number>> {
  const own = new Set(
    entries
      .filter((entry) => entry.sourceId === sourceId)
      .map((entry) => entry.assetRepresentationId),
  );
  const result: Record<string, number> = {};
  for (const other of new Set(entries.map((entry) => entry.sourceId))) {
    if (other === sourceId) continue;
    const otherAssets = new Set(
      entries
        .filter((entry) => entry.sourceId === other)
        .map((entry) => entry.assetRepresentationId),
    );
    result[other] = [...own].filter((asset) => otherAssets.has(asset)).length;
  }
  return result;
}

export function calculateEffectiveIndependentYield(
  uniqueYield: number,
  overlap: Readonly<Record<string, number>>,
  sourceId: string,
  dependenceFacts: readonly CoverageDependenceFacts[],
): number | null {
  let effective = uniqueYield;
  for (const [other, count] of Object.entries(overlap)) {
    const edge = dependenceFacts.find(
      (candidate) =>
        (candidate.sourceA === sourceId && candidate.sourceB === other) ||
        (candidate.sourceB === sourceId && candidate.sourceA === other),
    );
    if (edge === undefined) return null;
    effective += count * calculateEffectiveIndependenceMultiplier(edge);
  }
  return effective;
}

export function calculateFirstSeenLeadLag(
  entries: readonly DiscoveryUniverseEntry[],
  sourceId: string,
  facts: ReadonlyMap<string, CoverageEntryFacts>,
): MetricDistribution | null {
  return distribution(
    entries
      .filter((entry) => entry.sourceId === sourceId)
      .flatMap((entry) => {
        const firstPartyObservedAt = facts.get(entryKey(entry))?.firstPartyObservedAt;
        return firstPartyObservedAt === undefined
          ? []
          : [Date.parse(entry.sourceAvailableAt) - Date.parse(firstPartyObservedAt)];
      })
      .map((milliseconds) => milliseconds / 1_000),
  );
}

export function calculateProviderLateness(
  entries: readonly DiscoveryUniverseEntry[],
  sourceId: string,
): { readonly basis: ProviderLatenessBasis | null; readonly values: MetricDistribution | null } {
  const sourceEntries = entries.filter((entry) => entry.sourceId === sourceId);
  const basis: ProviderLatenessBasis | null = sourceEntries.some(
    (entry) => entry.sourceObservedAt !== undefined,
  )
    ? 'SOURCE_OBSERVED_AT'
    : sourceEntries.some((entry) => entry.sourcePublishedAt !== undefined)
      ? 'SOURCE_PUBLISHED_AT'
      : sourceEntries.length > 0
        ? 'SOURCE_AVAILABLE_AT'
        : null;
  if (basis === null) return { basis, values: null };
  const field =
    basis === 'SOURCE_OBSERVED_AT'
      ? 'sourceObservedAt'
      : basis === 'SOURCE_PUBLISHED_AT'
        ? 'sourcePublishedAt'
        : 'sourceAvailableAt';
  const values = sourceEntries.flatMap((entry) => {
    const timestamp = entry[field];
    return timestamp === undefined
      ? []
      : [(Date.parse(entry.firstIngestedAt) - Date.parse(timestamp)) / 1_000];
  });
  return { basis, values: distribution(values) };
}

export function calculateSourceCoverageLoss(
  sourceId: string,
  windows: readonly SourceHealthWindow[],
  asOf: string,
): number {
  const boundary = Date.parse(asOf);
  return windows.filter(
    (window) =>
      window.sourceId === sourceId &&
      Date.parse(window.windowEnd) <= boundary &&
      window.collectorScopeHealthy &&
      window.previouslyYielding &&
      window.yieldedAssets === 0,
  ).length;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nullQualityCodes(metric: Readonly<Record<string, unknown>>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(metric)
      .filter(([, value]) => value === null)
      .map(([field]) => [field, ['INSUFFICIENT_OBSERVATIONS']]),
  );
}

/** Compute one strictly-attributed metric set from an already resolved registry snapshot. */
export function measureCoverageSnapshot(
  snapshot: UniverseSnapshot,
  sourceId: string,
  asOf: string,
  options: CoverageMetricOptions = {},
): CoverageMetricSet {
  const facts = new Map((options.entryFacts ?? []).map((item) => [entryKey(item), item]));
  const visible = visibleEntries(snapshot, asOf);
  const resolved = resolvedEntries(visible, facts);
  const sourceEntries = resolved.filter((entry) => entry.sourceId === sourceId);
  const sourceFacts = sourceEntries.flatMap((entry) => {
    const fact = facts.get(entryKey(entry));
    return fact === undefined ? [] : [fact];
  });
  const unresolvedCount = visible.filter(
    (entry) =>
      entry.sourceId === sourceId && facts.get(entryKey(entry))?.identityResolved === false,
  ).length;
  const overlap = calculatePairwiseOverlap(resolved, sourceId);
  const uniqueYield = calculateUniqueDiscoveryYield(resolved, sourceId);
  const lateness = calculateProviderLateness(resolved, sourceId);
  const supportedPrograms = options.supportedPrograms ?? {};
  const unsupportedProgramExclusions = sourceFacts.filter((fact) => {
    if (fact.programId === undefined || fact.programVersion === undefined) return false;
    const supportedVersions = supportedPrograms[fact.programId];
    return supportedVersions !== undefined && !supportedVersions.includes(fact.programVersion);
  }).length;
  const eligibleFacts = sourceFacts.filter((fact) => {
    if (fact.programId === undefined || fact.programVersion === undefined) return true;
    const supportedVersions = supportedPrograms[fact.programId];
    return supportedVersions === undefined || supportedVersions.includes(fact.programVersion);
  });
  const firstPartyPopulation = new Set(
    [...facts.values()]
      .filter((fact) => fact.firstPartyObservedAt !== undefined && fact.identityResolved)
      .map((fact) => fact.assetRepresentationId),
  );
  const economic = (options.economicObservations ?? []).filter(
    (observation) =>
      observation.sourceId === sourceId &&
      visibleAt({ availableAt: utcTimestamp(observation.availableAt) }, utcTimestamp(asOf)) &&
      Number.isFinite(observation.firstSystemAvailablePrice) &&
      Number.isFinite(observation.sourceFirstSeenPrice) &&
      observation.sourceFirstSeenPrice > 0,
  );
  const resource = options.resourceAttribution?.find((item) => item.sourceId === sourceId);
  const usefulCount = eligibleFacts.filter((fact) => fact.usefulOutcome === true).length;
  const metric = {
    uniqueDiscoveryYield: uniqueYield,
    pairwiseOverlap: overlap,
    effectiveIndependentYield: calculateEffectiveIndependentYield(
      uniqueYield,
      overlap,
      sourceId,
      options.dependenceFacts ?? [],
    ),
    firstSeenLeadLagSeconds: calculateFirstSeenLeadLag(resolved, sourceId, facts),
    sourceEventToSystemLatencySeconds: lateness.values,
    supportedProgramEventRecall: rate(
      [...firstPartyPopulation].filter((asset) =>
        sourceEntries.some((entry) => entry.assetRepresentationId === asset),
      ).length,
      firstPartyPopulation.size,
    ),
    sourceCoverageLossWindows: calculateSourceCoverageLoss(
      sourceId,
      options.healthWindows ?? [],
      asOf,
    ),
    extendedAtFirstSeenRate: rate(
      eligibleFacts.filter((fact) => fact.extendedAtFirstSeen === true).length,
      eligibleFacts.filter((fact) => fact.extendedAtFirstSeen !== undefined).length,
    ),
    usefulTradableOutcomeYield: rate(
      eligibleFacts.filter((fact) => fact.usefulOutcome === true && fact.tradableOutcome === true)
        .length,
      eligibleFacts.filter((fact) => fact.usefulOutcome !== undefined).length,
    ),
    falsePositiveYield: rate(
      eligibleFacts.filter((fact) => fact.falsePositive === true).length,
      eligibleFacts.filter((fact) => fact.falsePositive !== undefined).length,
    ),
    cheapRejectYield: rate(
      eligibleFacts.filter((fact) => fact.cheapRejected === true).length,
      eligibleFacts.filter((fact) => fact.cheapRejected !== undefined).length,
    ),
    costPerUsefulDiscovery:
      resource === undefined || usefulCount === 0 ? null : resource.cost / usefulCount,
    creditsPerUsefulDiscovery:
      resource === undefined || usefulCount === 0 ? null : resource.credits / usefulCount,
    bytesPerUsefulDiscovery:
      resource === undefined || usefulCount === 0 ? null : resource.bytes / usefulCount,
    collectorGapMisses: snapshot.manifest.knownGapsCount,
    unsupportedLayoutMisses: sourceFacts.filter((fact) => fact.unsupportedLayout === true).length,
    retrospectiveNotDiscoveredCount: sourceFacts.filter(
      (fact) => fact.retrospectivelyNotDiscovered === true,
    ).length,
    sourceManipulationBoostedDiscoveryShare: rate(
      eligibleFacts.filter((fact) => fact.manipulationBoosted === true).length,
      eligibleFacts.length,
    ),
    identityFailureRate: rate(unresolvedCount, unresolvedCount + sourceEntries.length),
    unsupportedProgramExclusions,
    priceExtensionAtFirstSystemAvailability: mean(
      economic.map(
        (observation) =>
          observation.firstSystemAvailablePrice / observation.sourceFirstSeenPrice - 1,
      ),
    ),
  } as const;
  return CoverageMetricSetSchema.parse({
    metricSetId: `coverage:${snapshot.manifest.manifestId}:${sourceId}:${asOf}`,
    manifestId: snapshot.manifest.manifestId,
    populationClass: snapshot.manifest.populationClass,
    sourceId,
    profileVersion: options.profileVersions?.[sourceId] ?? null,
    collectorScopeIds: [...snapshot.manifest.collectorScopeIds],
    asOf,
    ...metric,
    providerLatenessBasis: lateness.basis,
    qualityCodes: nullQualityCodes(metric),
  });
}

/** Resolve the explicit replay boundary through the registry snapshot seam. */
export async function measureCoverage(
  registry: DiscoveryUniverseRegistry,
  populationId: string,
  asOf: string,
  options: CoverageMetricOptions = {},
): Promise<readonly CoverageMetricSet[]> {
  const snapshot = await registry.snapshot(populationId, asOf);
  return snapshot.manifest.sourceIds.map((sourceId) =>
    measureCoverageSnapshot(snapshot, sourceId, asOf, options),
  );
}

export const calculateCoverageMetrics = measureCoverageSnapshot;
