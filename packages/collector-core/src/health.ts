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
  const resources = {
    cpuPercent: health.resourceConsumption.cpuPercent,
    memoryBytes: health.resourceConsumption.memoryMb * 1024 * 1024,
    networkBytes: health.resourceConsumption.networkBytes ?? 0,
    subscriptions: health.resourceConsumption.subscriptions ?? 0,
    rawStorageBytes: health.resourceConsumption.rawStorageBytes ?? 0,
    retries: health.resourceConsumption.retries ?? 0,
    monthlyCredits: health.resourceConsumption.monthlyCredits ?? 0,
  };
  await engine.query(
    `INSERT INTO col.collector_health (
      partition_id,measured_at,connected,endpoint_generation,head_slot,finalized_slot,
      checkpoint_lag,gap_count,oldest_gap_duration_ms,backfill_status,
      decode_failure_rate,streamed_bytes,event_rate,deduplication_rate,resource_consumption
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      health.partitionId,
      health.sampledAt,
      health.connectedState === 'CONNECTED',
      health.endpointGeneration,
      health.headSlot,
      health.finalizedSlot,
      health.checkpointLag,
      health.gapCount,
      Math.round(health.gapDurationSeconds * 1000),
      health.backfillStatus,
      health.decodeFailureRate,
      health.streamedBytes,
      health.eventRate,
      health.deduplicationRate,
      JSON.stringify(resources),
    ],
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
