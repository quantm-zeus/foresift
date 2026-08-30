import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  DiscoveryUniverseEntrySchema,
  type DiscoveryUniverseEntry,
} from '@foresift/shared-schemas';
export type DiscoveryAttribution = DiscoveryUniverseEntry;
export function appendAttribution(
  existing: readonly DiscoveryAttribution[],
  value: DiscoveryAttribution,
): readonly DiscoveryAttribution[] {
  const parsed = DiscoveryUniverseEntrySchema.parse(value);
  if (
    existing.some(
      (x) =>
        x.sourceId === parsed.sourceId &&
        x.sourceAvailableAt === parsed.sourceAvailableAt &&
        x.sourceMetadataHash === parsed.sourceMetadataHash,
    )
  )
    return existing;
  return [...existing, parsed];
}
export function candidateFirstSeen(
  attributions: readonly DiscoveryAttribution[],
): DiscoveryAttribution {
  const valid = attributions.filter(
    (a) => Date.parse(a.firstIngestedAt) >= Date.parse(a.sourceAvailableAt),
  );
  if (valid.length === 0) throw new Error('NO_VALID_FIRST_SEEN_ATTRIBUTION');
  return [...valid].sort(
    (a, b) =>
      Date.parse(a.sourceAvailableAt) - Date.parse(b.sourceAvailableAt) ||
      (a.sourceRank ?? Number.MAX_SAFE_INTEGER) - (b.sourceRank ?? Number.MAX_SAFE_INTEGER) ||
      a.sourceId.localeCompare(b.sourceId),
  )[0] as DiscoveryAttribution;
}
export async function persistAttribution(
  engine: DatabaseEngine,
  entryId: string,
  value: DiscoveryAttribution,
): Promise<void> {
  const parsed = DiscoveryUniverseEntrySchema.parse(value);
  const sightingId = sha256Text(
    canonicalJson({
      sourceId: parsed.sourceId,
      sourceAvailableAt: parsed.sourceAvailableAt,
      sourceMetadataHash: parsed.sourceMetadataHash,
    }),
  );
  const attributionId = sha256Text(canonicalJson({ universeEntryId: entryId, sightingId }));
  await engine.query(
    `INSERT INTO disc.discovery_attribution (
      attribution_id,universe_entry_id,source_id,source_class,sighting_id,
      source_observed_at,source_published_at,source_available_at,first_received_at,
      first_ingested_at,source_rank,source_metadata_hash,quality_codes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (universe_entry_id,source_id,sighting_id) DO NOTHING`,
    [
      attributionId,
      entryId,
      parsed.sourceId,
      parsed.sourceClass,
      sightingId,
      parsed.sourceObservedAt ?? null,
      parsed.sourcePublishedAt ?? null,
      parsed.sourceAvailableAt,
      parsed.firstReceivedAt ?? null,
      parsed.firstIngestedAt,
      parsed.sourceRank ?? null,
      parsed.sourceMetadataHash,
      [...parsed.qualityCodes],
    ],
  );
}
