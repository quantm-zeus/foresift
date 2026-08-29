import type { DatabaseEngine } from '@foresift/persistence';
export interface CollectorWatermarkKey {
  readonly shardId: string;
  readonly programVersion: string;
  readonly chainId: string;
}
export type PositionEvidence = {
  readonly position: number;
  readonly kind: 'OBSERVED_EVENT' | 'EMPTY_RANGE_PROOF';
  readonly proofRef: string;
};
export class WatermarkCoordinator {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private key(k: CollectorWatermarkKey): string {
    return `${k.chainId}:${k.programVersion}:${k.shardId}`;
  }
  async advance(
    key: CollectorWatermarkKey,
    current: number,
    evidence: readonly PositionEvidence[],
    fencingToken: number,
  ): Promise<number> {
    const sorted = [...evidence].sort((a, b) => a.position - b.position);
    let next = current;
    for (const item of sorted) {
      if (!item.proofRef) throw new Error('WATERMARK_PROOF_REQUIRED');
      if (item.position === next + 1) next = item.position;
      else if (item.position > next + 1) break;
    }
    if (next === current && sorted.some((e) => e.position > current + 1))
      throw new Error('WATERMARK_NON_CONTIGUOUS');
    await this.engine.query(
      `INSERT INTO col.collector_watermarks (watermark_key,contiguous_through,fencing_token,updated_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (watermark_key) DO UPDATE SET contiguous_through=EXCLUDED.contiguous_through,fencing_token=EXCLUDED.fencing_token,updated_at=EXCLUDED.updated_at
      WHERE EXCLUDED.fencing_token>col.collector_watermarks.fencing_token OR (EXCLUDED.fencing_token=col.collector_watermarks.fencing_token AND EXCLUDED.contiguous_through>=col.collector_watermarks.contiguous_through)`,
      [this.key(key), next, fencingToken, this.now().toISOString()],
    );
    return next;
  }
  completeCoverage(contiguousThrough: number, claimedThrough: number, openGaps: number): boolean {
    return openGaps === 0 && contiguousThrough >= claimedThrough;
  }
}
