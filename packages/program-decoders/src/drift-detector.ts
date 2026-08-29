import { randomUUID } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';
import { CollectorDecodePauseSchema, type CollectorDecodePause } from '@foresift/shared-schemas';
export type DriftSignal = CollectorDecodePause['reason'];
export class DecoderDriftDetector {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async pause(input: {
    scopeId: string;
    programId: string;
    programVersion: string;
    decoderVersion: string;
    reason: DriftSignal;
  }): Promise<CollectorDecodePause> {
    const pausedAt = this.now().toISOString();
    const incidentId = randomUUID();
    const pause = CollectorDecodePauseSchema.parse({
      ...input,
      pauseId: randomUUID(),
      rawEventsPreserved: true,
      pausedAt,
      revalidatedAt: null,
      incidentId,
    });
    await this.engine.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO col.collector_incidents (incident_id,scope_id,partition_id,kind,severity,opened_at,evidence_refs) VALUES ($1,$2,NULL,$3,'CRITICAL',$4,$5)`,
        [incidentId, input.scopeId, input.reason, pausedAt, []],
      );
      await tx.query(
        `INSERT INTO col.collector_decode_pauses (pause_id,scope_id,program_id,program_version,decoder_version,reason,raw_events_preserved,paused_at,revalidated_at,incident_id) VALUES ($1,$2,$3,$4,$5,$6,true,$7,NULL,$8)`,
        [
          pause.pauseId,
          pause.scopeId,
          pause.programId,
          pause.programVersion,
          pause.decoderVersion,
          pause.reason,
          pause.pausedAt,
          pause.incidentId,
        ],
      );
    });
    return pause;
  }
  async assertDerivedFactsAllowed(scopeId: string): Promise<void> {
    const rows = await this.engine.query(
      'SELECT pause_id FROM col.collector_decode_pauses WHERE scope_id=$1 AND revalidated_at IS NULL',
      [scopeId],
    );
    if (rows.rows.length > 0) throw new Error('DERIVED_FACTS_PAUSED');
  }
  autoReactivate(): never {
    throw new Error('AUTO_REACTIVATION_REFUSED');
  }
  async revalidate(pauseId: string, evidenceRef: string): Promise<void> {
    if (!evidenceRef) throw new Error('REVALIDATION_EVIDENCE_REQUIRED');
    await this.engine.query(
      'UPDATE col.collector_decode_pauses SET revalidated_at=$2 WHERE pause_id=$1 AND revalidated_at IS NULL',
      [pauseId, this.now().toISOString()],
    );
  }
}
