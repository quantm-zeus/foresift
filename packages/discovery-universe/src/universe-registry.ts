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
export class DiscoveryUniverseRegistry {
  constructor(private readonly engine: DatabaseEngine) {}
  async snapshot(populationId: string, at: string): Promise<UniverseSnapshot> {
    const manifests = await this.engine.query<{ manifest_json: unknown }>(
      'SELECT manifest_json FROM disc.coverage_population_manifests WHERE population_id=$1 AND window_start<=$2 AND window_end>$2 ORDER BY window_start DESC LIMIT 1',
      [populationId, at],
    );
    const row = manifests.rows[0];
    if (!row) throw new Error('COVERAGE_POPULATION_MANIFEST_MISSING');
    const manifest = CoveragePopulationManifestSchema.parse(
      typeof row.manifest_json === 'string' ? JSON.parse(row.manifest_json) : row.manifest_json,
    );
    const result = await this.engine.query<{ entry_json: unknown }>(
      'SELECT entry_json FROM disc.discovery_universe_entries WHERE population_id=$1 AND valid_from<=$2 AND (valid_until IS NULL OR valid_until>$2)',
      [populationId, at],
    );
    const entries = result.rows.map((r) =>
      DiscoveryUniverseEntrySchema.parse(
        typeof r.entry_json === 'string' ? JSON.parse(r.entry_json) : r.entry_json,
      ),
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
