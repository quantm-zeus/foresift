import { randomUUID } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';
import type { CollectorPartitionState } from '@foresift/shared-schemas';
export type PartitionState = CollectorPartitionState['state'];
export const LEGAL_PARTITION_TRANSITIONS: Readonly<
  Record<PartitionState, readonly PartitionState[]>
> = {
  DISABLED: ['STARTING'],
  STARTING: ['SYNCING', 'PAUSED', 'FAILED'],
  SYNCING: ['LIVE', 'DEGRADED', 'GAP_DETECTED', 'PAUSED', 'FAILED'],
  LIVE: ['DEGRADED', 'GAP_DETECTED', 'PAUSED', 'FAILED'],
  DEGRADED: ['SYNCING', 'GAP_DETECTED', 'PAUSED', 'FAILED'],
  GAP_DETECTED: ['BACKFILLING', 'PAUSED', 'FAILED'],
  BACKFILLING: ['SYNCING', 'DEGRADED', 'PAUSED', 'FAILED'],
  PAUSED: ['STARTING', 'FAILED', 'DISABLED'],
  FAILED: ['STARTING', 'DISABLED'],
};
export interface LiveReadiness {
  readonly connected: boolean;
  readonly decoderVerified: boolean;
  readonly finalitySatisfied: boolean;
  readonly checkpointContiguous: boolean;
  readonly capacityAvailable: boolean;
  readonly rightsVerified: boolean;
}
export function assertLiveReadiness(checks: LiveReadiness): void {
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (failed.length) throw new Error(`LIVE_READINESS_REFUSED:${failed.join(',')}`);
}
export class PartitionStateMachine {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async transition(input: {
    partitionId: string;
    to: PartitionState;
    fencingToken: number;
    auditRef: string;
    reason: string;
    liveReadiness?: LiveReadiness;
  }): Promise<void> {
    await this.engine.transaction(async (tx) => {
      const result = await tx.query<{ state: PartitionState; fencing_token: string | number }>(
        'SELECT state,fencing_token FROM col.collector_partitions WHERE partition_id=$1 FOR UPDATE',
        [input.partitionId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('UNKNOWN_PARTITION');
      if (input.fencingToken < Number(row.fencing_token)) throw new Error('STALE_FENCING_TOKEN');
      if (!LEGAL_PARTITION_TRANSITIONS[row.state].includes(input.to))
        throw new Error(`ILLEGAL_PARTITION_TRANSITION:${row.state}->${input.to}`);
      if (input.to === 'LIVE')
        assertLiveReadiness(
          input.liveReadiness ?? {
            connected: false,
            decoderVerified: false,
            finalitySatisfied: false,
            checkpointContiguous: false,
            capacityAvailable: false,
            rightsVerified: false,
          },
        );
      const at = this.now().toISOString();
      await tx.query(
        'UPDATE col.collector_partitions SET state=$2,fencing_token=$3,transitioned_at=$4,audit_ref=$5,reason=$6 WHERE partition_id=$1',
        [input.partitionId, input.to, input.fencingToken, at, input.auditRef, input.reason],
      );
      await tx.query(
        'INSERT INTO col.collector_partition_transitions (transition_id,partition_id,from_state,to_state,fencing_token,occurred_at,audit_ref,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          randomUUID(),
          input.partitionId,
          row.state,
          input.to,
          input.fencingToken,
          at,
          input.auditRef,
          input.reason,
        ],
      );
    });
  }
}
