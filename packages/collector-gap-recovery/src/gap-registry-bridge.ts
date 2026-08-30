import type { DatabaseEngine } from '@foresift/persistence';
export type GapLifecycle =
  | 'OPEN'
  | 'BACKFILL_QUEUED'
  | 'BACKFILLING'
  | 'RESOLVED_COMPLETE'
  | 'RESOLVED_EMPTY_PROOF'
  | 'PARTIAL'
  | 'UNRESOLVED'
  | 'WAIVED_FOR_NARROW_SCOPE';
const transitions: Readonly<Record<GapLifecycle, readonly GapLifecycle[]>> = {
  OPEN: ['BACKFILL_QUEUED', 'UNRESOLVED', 'WAIVED_FOR_NARROW_SCOPE'],
  BACKFILL_QUEUED: ['BACKFILLING', 'UNRESOLVED'],
  BACKFILLING: ['RESOLVED_COMPLETE', 'RESOLVED_EMPTY_PROOF', 'PARTIAL', 'UNRESOLVED'],
  RESOLVED_COMPLETE: [],
  RESOLVED_EMPTY_PROOF: [],
  PARTIAL: ['BACKFILL_QUEUED', 'UNRESOLVED'],
  UNRESOLVED: ['BACKFILL_QUEUED', 'WAIVED_FOR_NARROW_SCOPE'],
  WAIVED_FOR_NARROW_SCOPE: [],
};
export class GapRegistryBridge {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async open(input: {
    gapId: string;
    partitionId: string;
    start: number;
    end: number;
  }): Promise<void> {
    if (input.start > input.end) throw new Error('INVERTED_GAP');
    await this.engine.query(
      `INSERT INTO col.collector_gap_registry (gap_id,partition_id,start_position,end_position,status,updated_at) VALUES ($1,$2,$3,$4,'OPEN',$5)`,
      [input.gapId, input.partitionId, input.start, input.end, this.now().toISOString()],
    );
  }
  async transition(
    gapId: string,
    to: GapLifecycle,
    waiver?: { scope: string; signature: string; expiresAt: string },
  ): Promise<void> {
    await this.engine.transaction(async (tx) => {
      const r = await tx.query<{ status: GapLifecycle }>(
        'SELECT status FROM col.collector_gap_registry WHERE gap_id=$1 FOR UPDATE',
        [gapId],
      );
      const from = r.rows[0]?.status;
      if (!from || !transitions[from].includes(to))
        throw new Error(`ILLEGAL_GAP_TRANSITION:${from ?? 'UNKNOWN'}->${to}`);
      if (
        to === 'WAIVED_FOR_NARROW_SCOPE' &&
        (!waiver ||
          waiver.scope.length === 0 ||
          waiver.signature.length === 0 ||
          Date.parse(waiver.expiresAt) <= this.now().getTime())
      )
        throw new Error('VALID_SIGNED_EXPIRING_WAIVER_REQUIRED');
      await tx.query(
        `UPDATE col.collector_gap_registry
         SET status=$2,waiver_scope=$3,waiver_signature=$4,waiver_expires_at=$5,updated_at=$6
         WHERE gap_id=$1`,
        [
          gapId,
          to,
          waiver?.scope ?? null,
          waiver?.signature ?? null,
          waiver?.expiresAt ?? null,
          this.now().toISOString(),
        ],
      );
    });
  }
  supportsCompleteCoverage(status: GapLifecycle): boolean {
    return status === 'RESOLVED_COMPLETE' || status === 'RESOLVED_EMPTY_PROOF';
  }
}
