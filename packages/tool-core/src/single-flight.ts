/**
 * Cross-mode single-flight with database-backed fencing leases
 * (FR-CORE-006; PRD §16.6; INV-009). The lease lives in
 * `core.core_single_flight_leases` — one current row per resource key — and
 * the statements here are THE guarded SQL proven by the Phase-B truth tests:
 * takeover only of released-or-expired leases with a fresh sequence token,
 * release only for the matching unreleased token. A stale holder therefore
 * fails closed at the database, never merely in memory.
 */
import { ForesiftError, type HolderMode } from '@foresift/domain';
import { sha256Text, type DatabaseEngine } from '@foresift/persistence';

export interface LeaseHandle {
  readonly resourceKeyHash: string;
  readonly fencingToken: number;
  readonly expiresAt: string;
}

/**
 * THE takeover guard: upsert so FIRST acquisition inserts a fresh lease, while
 * any conflict takes over the existing row ONLY when it is released or expired
 * (fresh sequence token either way). A live lease matches the guard against
 * zero rows — the database itself refuses every other actor.
 */
const LEASE_TAKEOVER = `
    INSERT INTO core.core_single_flight_leases
        (resource_key_hash, fencing_token, holder_mode, holder_id,
         acquired_at, expires_at)
    VALUES ($1, nextval('core.core_lease_fencing_seq'), $2, $3, $4, $5)
    ON CONFLICT (resource_key_hash) DO UPDATE
        SET fencing_token = nextval('core.core_lease_fencing_seq'),
            holder_mode = EXCLUDED.holder_mode,
            holder_id = EXCLUDED.holder_id,
            acquired_at = EXCLUDED.acquired_at,
            expires_at = EXCLUDED.expires_at,
            released_at = NULL
        WHERE core.core_single_flight_leases.released_at IS NOT NULL
           OR core.core_single_flight_leases.expires_at <= EXCLUDED.acquired_at
    RETURNING fencing_token`;

/** THE release guard: matching token, still held. */
const LEASE_RELEASE = `
    UPDATE core.core_single_flight_leases
    SET released_at = $3
    WHERE resource_key_hash = $1 AND fencing_token = $2 AND released_at IS NULL
    RETURNING fencing_token`;

export class StaleFencingTokenError extends ForesiftError {
  constructor(message: string, detail: Record<string, string | number | boolean | null> = {}) {
    super('LEASE_FENCING_TOKEN_STALE', message, detail);
    this.name = 'StaleFencingTokenError';
  }
}

export interface SingleFlightOptions {
  readonly engine: DatabaseEngine;
  /** Injectable clock; acquired_at and expiry comparisons use it. */
  readonly now?: () => string;
  readonly defaultTtlSeconds?: number;
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export class SingleFlightManager {
  constructor(private readonly opts: SingleFlightOptions) {}

  /** Deterministic resource-key hash over the caller's identity tuple. */
  static resourceKeyHash(keyParts: {
    provider: string;
    operation: string;
    canonicalEntityIdentity: string;
  }): string {
    return sha256Text(
      JSON.stringify([keyParts.provider, keyParts.operation, keyParts.canonicalEntityIdentity]),
    );
  }

  /**
   * Acquire the lease for a resource. Cross-mode by construction: any holder
   * mode may take over ONLY a released or expired lease; a live lease makes
   * every other actor (including automation) wait.
   */
  async acquire(request: {
    resourceKeyHash: string;
    holderMode: HolderMode;
    holderId: string;
    ttlSeconds?: number;
  }): Promise<LeaseHandle> {
    const now = this.opts.now?.() ?? new Date().toISOString();
    const ttl = request.ttlSeconds ?? this.opts.defaultTtlSeconds ?? 60;
    const expiresAt = addSeconds(now, ttl);
    const taken = await this.opts.engine.query<{ fencing_token: string }>(LEASE_TAKEOVER, [
      request.resourceKeyHash,
      request.holderMode,
      request.holderId,
      now,
      expiresAt,
    ]);
    const token = taken.rows[0]?.fencing_token;
    if (token === undefined) {
      throw new ForesiftError('LEASE_FENCING_TOKEN_STALE', 'lease is live and unexpired', {
        resourceKeyHash: request.resourceKeyHash,
      });
    }
    return {
      resourceKeyHash: request.resourceKeyHash,
      fencingToken: Number(token),
      expiresAt,
    };
  }

  /**
   * Release with fence validation. Zero rows updated ⇒ the caller's token is
   * stale (released earlier or superseded after expiry) ⇒ typed refusal.
   */
  async release(handle: LeaseHandle): Promise<void> {
    const now = this.opts.now?.() ?? new Date().toISOString();
    const released = await this.opts.engine.query<{ fencing_token: string }>(LEASE_RELEASE, [
      handle.resourceKeyHash,
      handle.fencingToken,
      now,
    ]);
    if (released.rows.length === 0) {
      throw new StaleFencingTokenError(
        'release refused: fencing token does not match a live lease',
        {
          resourceKeyHash: handle.resourceKeyHash,
          fencingToken: handle.fencingToken,
        },
      );
    }
  }

  /** True when a live, unreleased, unexpired lease exists for the key. */
  async isLive(resourceKeyHash: string): Promise<boolean> {
    const now = this.opts.now?.() ?? new Date().toISOString();
    const rows = await this.opts.engine.query(
      `SELECT fencing_token FROM core.core_single_flight_leases
       WHERE resource_key_hash = $1 AND released_at IS NULL AND expires_at > $2`,
      [resourceKeyHash, now],
    );
    return rows.rows.length > 0;
  }
}
