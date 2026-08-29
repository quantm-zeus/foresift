import type { DatabaseEngine } from '@foresift/persistence';
import { CollectorHealthSchema, type CollectorHealth } from '@foresift/shared-schemas';
export function assembleCollectorHealth(input: CollectorHealth): CollectorHealth {
  return CollectorHealthSchema.parse(input);
}
export async function persistCollectorHealth(
  engine: DatabaseEngine,
  input: CollectorHealth,
): Promise<void> {
  const health = assembleCollectorHealth(input);
  await engine.query(
    'INSERT INTO col.collector_health (partition_id, measured_at, snapshot_json) VALUES ($1,$2,$3)',
    [health.partitionId, health.measuredAt, JSON.stringify(health)],
  );
}
