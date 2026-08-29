import type { DatabaseEngine } from '@foresift/persistence';
import {
  CoveragePopulationManifestSchema,
  DiscoveryUniverseEntrySchema,
  type CoveragePopulationManifest,
  type DiscoveryUniverseEntry,
} from '@foresift/shared-schemas';
export interface UniverseSnapshot {
  readonly manifest: CoveragePopulationManifest;
  readonly entries: readonly DiscoveryUniverseEntry[];
  readonly sourceOverlap: Readonly<Record<string, number>>;
  readonly uniqueYield: Readonly<Record<string, number>>;
}
function jsonValue<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}
function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
export class DiscoveryUniverseRegistry {
  constructor(private readonly engine: DatabaseEngine) {}
  async snapshot(populationId: string, at: string): Promise<UniverseSnapshot> {
    const manifests = await this.engine.query<{
      manifest_id: string;
      population: CoveragePopulationManifest['populationClass'];
      source_scope: unknown;
      collector_scope: unknown;
      window_start: string | Date;
      window_end: string | Date;
      gaps: unknown;
      rights_exclusions: unknown;
      selection_probabilities: unknown;
      source_dependence_assessment: unknown;
    }>(
      `SELECT manifest_id,population,source_scope,collector_scope,window_start,window_end,
              gaps,rights_exclusions,selection_probabilities,source_dependence_assessment
       FROM disc.coverage_population_manifests
       WHERE (manifest_id=$1 OR population=$1) AND window_start<=$2 AND window_end>$2
       ORDER BY window_start DESC LIMIT 1`,
      [populationId, at],
    );
    const row = manifests.rows[0];
    if (!row) throw new Error('COVERAGE_POPULATION_MANIFEST_MISSING');
    const sourceScope = jsonValue<Record<string, unknown>>(row.source_scope as string);
    const collectorScope = jsonValue<Record<string, unknown>>(row.collector_scope as string);
    const gaps = jsonValue<readonly unknown[]>(row.gaps as string);
    const sourceIds = Array.isArray(sourceScope.sourceIds)
      ? sourceScope.sourceIds.filter((v): v is string => typeof v === 'string')
      : [];
    const collectorScopeIds = Array.isArray(collectorScope.scopeIds)
      ? collectorScope.scopeIds.filter((v): v is string => typeof v === 'string')
      : [];
    const manifest = CoveragePopulationManifestSchema.parse({
      manifestId: row.manifest_id,
      populationClass: row.population,
      collectorScopeIds,
      sourceIds,
      startSlot: String(collectorScope.startSlot ?? '0'),
      endSlot: String(collectorScope.endSlot ?? collectorScope.startSlot ?? '0'),
      startTime: timestamp(row.window_start),
      endTime: timestamp(row.window_end),
      knownGapsCount: gaps.length,
      rightsExclusions: jsonValue<readonly string[]>(row.rights_exclusions as string),
      selectionProbabilities: jsonValue<Record<string, number>>(
        row.selection_probabilities as string,
      ),
      sourceDependenceDisclosed:
        jsonValue<Record<string, unknown>>(row.source_dependence_assessment as string).disclosed ===
        true,
    });
    const result = await this.engine.query<{
      asset_representation_id: string;
      source_id: string;
      source_class: DiscoveryUniverseEntry['sourceClass'];
      source_observed_at: string | Date | null;
      source_published_at: string | Date | null;
      source_available_at: string | Date;
      first_fetched_at: string | Date | null;
      first_received_at: string | Date | null;
      first_ingested_at: string | Date;
      chain_coordinates: string | null;
      source_rank: number | null;
      source_metadata_hash: string;
      discovery_policy_version: string;
      collector_coverage_manifest_id: string | null;
      quality_codes: string[];
    }>(
      `SELECT asset_representation_id,source_id,source_class,source_observed_at,
              source_published_at,source_available_at,first_fetched_at,first_received_at,
              first_ingested_at,chain_coordinates,source_rank,source_metadata_hash,
              discovery_policy_version,collector_coverage_manifest_id,quality_codes
       FROM disc.discovery_universe_entries
       WHERE source_available_at >= $1 AND source_available_at <= $2 AND first_ingested_at <= $2`,
      [timestamp(row.window_start), at],
    );
    const entries = result.rows
      .filter((entry) => sourceIds.length === 0 || sourceIds.includes(entry.source_id))
      .map((entry) =>
        DiscoveryUniverseEntrySchema.parse({
          assetRepresentationId: entry.asset_representation_id,
          sourceId: entry.source_id,
          sourceClass: entry.source_class,
          ...(entry.source_observed_at === null
            ? {}
            : { sourceObservedAt: timestamp(entry.source_observed_at) }),
          ...(entry.source_published_at === null
            ? {}
            : { sourcePublishedAt: timestamp(entry.source_published_at) }),
          sourceAvailableAt: timestamp(entry.source_available_at),
          ...(entry.first_fetched_at === null
            ? {}
            : { firstFetchedAt: timestamp(entry.first_fetched_at) }),
          ...(entry.first_received_at === null
            ? {}
            : { firstReceivedAt: timestamp(entry.first_received_at) }),
          firstIngestedAt: timestamp(entry.first_ingested_at),
          ...(entry.chain_coordinates === null
            ? {}
            : { chainCoordinates: entry.chain_coordinates }),
          ...(entry.source_rank === null ? {} : { sourceRank: entry.source_rank }),
          sourceMetadataHash: entry.source_metadata_hash,
          discoveryPolicyVersion: entry.discovery_policy_version,
          ...(entry.collector_coverage_manifest_id === null
            ? {}
            : { collectorCoverageManifestId: entry.collector_coverage_manifest_id }),
          qualityCodes: entry.quality_codes,
        }),
      );
    const sourceOverlap: Record<string, number> = {},
      uniqueYield: Record<string, number> = {};
    const entriesByAsset = new Map<string, DiscoveryUniverseEntry[]>();
    for (const entry of entries) {
      const group = entriesByAsset.get(entry.assetRepresentationId) ?? [];
      group.push(entry);
      entriesByAsset.set(entry.assetRepresentationId, group);
    }
    for (const assetEntries of entriesByAsset.values()) {
      const sources = [...new Set(assetEntries.map((entry) => entry.sourceId))].sort();
      for (const source of sources) {
        if (sources.length === 1) uniqueYield[source] = (uniqueYield[source] ?? 0) + 1;
        for (const other of sources)
          if (source < other) {
            const key = `${source}|${other}`;
            sourceOverlap[key] = (sourceOverlap[key] ?? 0) + 1;
          }
      }
    }
    return { manifest, entries, sourceOverlap, uniqueYield };
  }
  async missed(subjectId: string, populationId: string, at: string): Promise<boolean> {
    const snap = await this.snapshot(populationId, at);
    return !snap.entries.some((e) => e.assetRepresentationId === subjectId);
  }
}
