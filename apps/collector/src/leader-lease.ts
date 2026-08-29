import {
  canonicalJson,
  commitCheckpoint,
  sha256Text,
  type DatabaseEngine,
} from '@foresift/persistence';
import { canonicalEventKey, DuplicateAbsorber, type DedupCounters } from '@foresift/collector-core';
export interface LeaderLease {
  readonly shardId: string;
  readonly holderId: string;
  readonly fencingToken: number;
  readonly expiresAt: string;
}
export class CollectorLeaderLease {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async acquire(shardId: string, holderId: string, ttlMs: number): Promise<LeaderLease> {
    if (ttlMs <= 0) throw new Error('LEASE_TTL_REQUIRED');
    const key = sha256Text(canonicalJson({ kind: 'collector-shard', shardId }));
    return this.engine.transaction(async (tx) => {
      const current = await tx.query<{
        fencing_token: string | number;
        holder_id: string;
        expires_at: string | Date;
        released_at: string | Date | null;
      }>(
        'SELECT fencing_token,holder_id,expires_at,released_at FROM core.core_single_flight_leases WHERE resource_key_hash=$1 FOR UPDATE',
        [key],
      );
      const row = current.rows[0];
      const now = this.now();
      if (
        row &&
        row.released_at === null &&
        new Date(row.expires_at).getTime() > now.getTime() &&
        row.holder_id !== holderId
      )
        throw new Error('SHARD_LEASE_HELD');
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
      const updated = await tx.query<{ fencing_token: string | number }>(
        `INSERT INTO core.core_single_flight_leases (resource_key_hash,holder_mode,holder_id,acquired_at,expires_at,released_at) VALUES ($1,'AUTOMATION',$2,$3,$4,NULL)
        ON CONFLICT (resource_key_hash) DO UPDATE SET fencing_token=nextval('core.core_lease_fencing_seq'),holder_mode='AUTOMATION',holder_id=EXCLUDED.holder_id,acquired_at=EXCLUDED.acquired_at,expires_at=EXCLUDED.expires_at,released_at=NULL RETURNING fencing_token`,
        [key, holderId, now.toISOString(), expiresAt],
      );
      return {
        shardId,
        holderId,
        fencingToken: Number((updated.rows[0] as { fencing_token: string | number }).fencing_token),
        expiresAt,
      };
    });
  }
  async commit(lease: LeaderLease, position: number): Promise<void> {
    await commitCheckpoint(this.engine, {
      shardId: lease.shardId,
      fencingToken: lease.fencingToken,
      cursorPosition: position,
    });
  }
}
export class LeaderDuplicateGuard extends DuplicateAbsorber {
  constructor(engine: DatabaseEngine, counters: DedupCounters) {
    super(engine, counters);
  }
  key(input: Parameters<typeof canonicalEventKey>[0]): string {
    return canonicalEventKey(input);
  }
}
