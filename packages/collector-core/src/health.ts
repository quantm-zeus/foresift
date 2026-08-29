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
    [health.partitionId, health.sampledAt, JSON.stringify(health)],
  );
}
export function assembleHealthSnapshot(partitionId: string): CollectorHealth {
  return {
    partitionId,
    connectedState: 'DISCONNECTED',
    endpointGeneration: 0,
    headSlot: '0',
    finalizedSlot: '0',
    checkpointLag: 0,
    gapCount: 0,
    gapDurationSeconds: 0,
    backfillStatus: 'IDLE',
    decodeFailureRate: 0,
    streamedBytes: 0,
    eventRate: 0,
    deduplicationRate: 0,
    resourceConsumption: { cpuPercent: 0, memoryMb: 0 },
    sampledAt: new Date().toISOString(),
  };
}
