import { randomUUID } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';
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
      (x) => x.sourceId === parsed.sourceId && x.sourceAvailableAt === parsed.sourceAvailableAt,
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
  await engine.query(
    'INSERT INTO disc.discovery_attributions (entry_id,source_id,source_timestamp,system_timestamp,source_rank,attribution_json) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
    [
      entryId,
      parsed.sourceId,
      parsed.sourceObservedAt ?? parsed.sourcePublishedAt ?? parsed.sourceAvailableAt,
      parsed.sourceAvailableAt,
      parsed.sourceRank ?? 0,
      JSON.stringify({ ...parsed, attributionId: randomUUID() }),
    ],
  );
}
