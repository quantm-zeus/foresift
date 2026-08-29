import { randomUUID } from 'node:crypto';
import { commitCheckpoint, registerGap, type DatabaseEngine } from '@foresift/persistence';
export interface CheckpointPosition {
  readonly partitionId: string;
  readonly position: number;
  readonly fencingToken: number;
}
export class CollectorCheckpointStore {
  constructor(private readonly engine: DatabaseEngine) {}
  async load(partitionId: string): Promise<CheckpointPosition | null> {
    const r = await this.engine.query<{
      cursor_position: string | number;
      fencing_token: string | number;
    }>('SELECT cursor_position,fencing_token FROM collector_checkpoints WHERE shard_id=$1', [
      partitionId,
    ]);
    const row = r.rows[0];
    return row
      ? {
          partitionId,
          position: Number(row.cursor_position),
          fencingToken: Number(row.fencing_token),
        }
      : null;
  }
  async reconnect(
    partitionId: string,
    observedStart: number,
  ): Promise<{ resumeFrom: number; gapId?: string }> {
    const stored = await this.load(partitionId);
    const resumeFrom = stored?.position ?? 0;
    if (observedStart > resumeFrom + 1) {
      const gapId = randomUUID();
      await registerGap(this.engine, {
        gapId,
        shardId: partitionId,
        gapStartSlot: resumeFrom + 1,
        gapEndSlot: observedStart - 1,
        reason: 'RECONNECT_OBSERVED_RANGE_DISCONTINUITY',
      });
      return { resumeFrom, gapId };
    }
    return { resumeFrom };
  }
  async commit(input: CheckpointPosition): Promise<void> {
    await commitCheckpoint(this.engine, {
      shardId: input.partitionId,
      cursorPosition: input.position,
      fencingToken: input.fencingToken,
    });
  }
}
