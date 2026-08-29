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
        `INSERT INTO col.collector_incidents (
          incident_id,kind,decoder_id,program_id,program_version,opened_at,
          status,evidence_refs,audit_chain_ref
        ) VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8)`,
        [
          incidentId,
          input.reason,
          input.scopeId,
          input.programId,
          input.programVersion,
          pausedAt,
          JSON.stringify([`decoder:${input.decoderVersion}`, `scope:${input.scopeId}`]),
          `collector-decode-pause:${incidentId}`,
        ],
      );
      await tx.query(
        `INSERT INTO col.collector_decode_pauses (
          pause_id,decoder_id,program_id,program_version,reason,opening_incident_id,
          paused_at,revalidation_state,revalidated_at,derived_facts_state
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'PAUSED',NULL,'BLOCKED')`,
        [
          pause.pauseId,
          pause.scopeId,
          pause.programId,
          pause.programVersion,
          pause.reason,
          pause.incidentId,
          pause.pausedAt,
        ],
      );
    });
    return pause;
  }
  async assertDerivedFactsAllowed(scopeId: string): Promise<void> {
    const rows = await this.engine.query(
      `SELECT pause_id FROM col.collector_decode_pauses
       WHERE decoder_id=$1 AND revalidation_state <> 'REVALIDATED'`,
      [scopeId],
    );
    if (rows.rows.length > 0) throw new Error('DERIVED_FACTS_PAUSED');
  }
  autoReactivate(): never {
    throw new Error('AUTO_REACTIVATION_REFUSED');
  }
  async revalidate(pauseId: string, evidenceRef: string): Promise<void> {
    if (!evidenceRef) throw new Error('REVALIDATION_EVIDENCE_REQUIRED');
    await this.engine.transaction(async (tx) => {
      const rows = await tx.query<{ opening_incident_id: string }>(
        `UPDATE col.collector_decode_pauses
         SET revalidation_state='REVALIDATED',derived_facts_state='ALLOWED',revalidated_at=$2
         WHERE pause_id=$1 AND revalidation_state <> 'REVALIDATED'
         RETURNING opening_incident_id`,
        [pauseId, this.now().toISOString()],
      );
      const incidentId = rows.rows[0]?.opening_incident_id;
      if (!incidentId) throw new Error('UNKNOWN_OR_REVALIDATED_DECODE_PAUSE');
      const at = this.now().toISOString();
      await tx.query(
        `UPDATE col.collector_incidents
         SET status='RESOLVED',revalidated_at=$2,resolved_at=$2,
             resolution_notes=$3,evidence_refs=evidence_refs || $4::jsonb
         WHERE incident_id=$1`,
        [incidentId, at, `explicit revalidation: ${evidenceRef}`, JSON.stringify([evidenceRef])],
      );
    });
  }
}
