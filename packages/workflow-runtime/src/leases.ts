/**
 * Step leases with monotonically increasing fencing tokens (T016, FR-WF-003,
 * AC-012; PRD §25.7).
 *
 * This mirrors the G0-proven `packages/tool-core/src/single-flight.ts` fencing
 * pattern EXACTLY, over `wf.step_leases` with the dedicated
 * `wf.wf_lease_fencing_seq` sequence:
 *
 * - takeover upserts ONLY a released or expired row and ALWAYS allocates a
 *   fresh `nextval` token, so a live lease refuses every other actor at the
 *   database;
 * - release is guarded by `fencing_token = $n AND released_at IS NULL`, and
 *   zero updated rows is a typed `LEASE_FENCING_TOKEN_STALE`;
 * - `assertLeaseCurrent` is the commit-time compare: a stale holder fails
 *   closed even before expiry, because a takeover changed the token;
 * - expiry alone is NOT fencing — an expired-but-not-taken-over lease still
 *   permits its current holder (matching AC-012's failure path).
 *
 * Strictly read-only: a fenced lease guards workflow progress; it can never
 * trade, custody, sign, handle keys, or submit a transaction.
 */
import { ErrorCode, ForesiftError } from '@foresift/domain';
import { sha256Text, type DatabaseEngine } from '@foresift/persistence';

export interface StepLeaseHandle {
  readonly resourceKey: string;
  readonly fencingToken: number;
  readonly expiresAt: string;
}

export interface StepLeaseManagerOptions {
  readonly engine: DatabaseEngine;
  /** Injectable clock; acquired_at and expiry comparisons use it. */
  readonly now?: () => string;
  readonly defaultTtlSeconds?: number;
}

/** Typed refusal: the caller's fencing token no longer owns the lease. */
export class StaleStepLeaseError extends ForesiftError {
  constructor(message: string, detail: Record<string, string | number | boolean | null> = {}) {
    super(ErrorCode.LEASE_FENCING_TOKEN_STALE, message, detail);
    this.name = 'StaleStepLeaseError';
  }
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/**
 * THE takeover guard: upsert so FIRST acquisition inserts a fresh lease, while
 * any conflict takes over the existing row ONLY when it is released or expired
 * (fresh sequence token either way). A live lease matches the guard against
 * zero rows — the database itself refuses every other actor.
 *
 * The `step_leases_no_regression` trigger permits an UNCHANGED token and only
 * refuses a DECREASE, so `nextval` is always legal here.
 */
const STEP_LEASE_TAKEOVER = `
    INSERT INTO wf.step_leases
        (resource_key, owner, fencing_token, acquired_at, expires_at)
    VALUES ($1, $2, nextval('wf.wf_lease_fencing_seq'), $3, $4)
    ON CONFLICT (resource_key) DO UPDATE
        SET fencing_token = nextval('wf.wf_lease_fencing_seq'),
            owner = EXCLUDED.owner,
            acquired_at = EXCLUDED.acquired_at,
            expires_at = EXCLUDED.expires_at,
            released_at = NULL
        WHERE wf.step_leases.released_at IS NOT NULL
           OR wf.step_leases.expires_at <= EXCLUDED.acquired_at
    RETURNING fencing_token`;

/** THE release guard: matching token, still held. */
const STEP_LEASE_RELEASE = `
    UPDATE wf.step_leases
    SET released_at = $3
    WHERE resource_key = $1 AND fencing_token = $2 AND released_at IS NULL
    RETURNING fencing_token`;

/**
 * THE commit-time compare: the token must still be the current, unreleased
 * token. Expiry is deliberately NOT part of the predicate — only a takeover
 * fences a holder (§25.7), so an expired-but-not-taken-over lease still
 * permits its current holder.
 */
const STEP_LEASE_ASSERT = `
    SELECT fencing_token FROM wf.step_leases
    WHERE resource_key = $1 AND fencing_token = $2 AND released_at IS NULL`;

export class StepLeaseManager {
  private readonly engine: DatabaseEngine;
  private readonly now: (() => string) | undefined;
  private readonly defaultTtlSeconds: number | undefined;

  constructor(options: StepLeaseManagerOptions) {
    this.engine = options.engine;
    this.now = options.now;
    this.defaultTtlSeconds = options.defaultTtlSeconds;
  }

  /** Deterministic resource-key hash over the workflow identity tuple. */
  static resourceKeyHash(keyParts: { runId: string; stepType: string; scope?: string }): string {
    return sha256Text(JSON.stringify([keyParts.runId, keyParts.stepType, keyParts.scope ?? '']));
  }

  private clock(): string {
    return this.now?.() ?? new Date().toISOString();
  }

  /**
   * Acquire the lease for a resource key. Any holder may take over ONLY a
   * released or expired lease; a live lease refuses this actor at the
   * database (zero rows returned by the guarded upsert).
   */
  async acquire(request: {
    resourceKey: string;
    owner: string;
    ttlSeconds?: number;
  }): Promise<StepLeaseHandle> {
    const now = this.clock();
    const ttl = request.ttlSeconds ?? this.defaultTtlSeconds ?? 60;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new ForesiftError(
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
        'lease ttl must be a positive number of seconds',
        { ttlSeconds: ttl },
      );
    }
    const expiresAt = addSeconds(now, ttl);
    const taken = await this.engine.query<{ fencing_token: string }>(STEP_LEASE_TAKEOVER, [
      request.resourceKey,
      request.owner,
      now,
      expiresAt,
    ]);
    const token = taken.rows[0]?.fencing_token;
    if (token === undefined) {
      throw new StaleStepLeaseError('lease is live and unexpired', {
        resourceKey: request.resourceKey,
      });
    }
    return { resourceKey: request.resourceKey, fencingToken: Number(token), expiresAt };
  }

  /**
   * Release with fence validation. Zero rows updated means the caller's token
   * is stale (released earlier or superseded after expiry) — a typed refusal.
   */
  async release(handle: StepLeaseHandle): Promise<void> {
    const now = this.clock();
    const released = await this.engine.query<{ fencing_token: string }>(STEP_LEASE_RELEASE, [
      handle.resourceKey,
      handle.fencingToken,
      now,
    ]);
    if (released.rows.length === 0) {
      throw new StaleStepLeaseError('release refused: fencing token does not match a live lease', {
        resourceKey: handle.resourceKey,
        fencingToken: handle.fencingToken,
      });
    }
  }

  /**
   * Commit-time fence compare. A holder whose token was superseded by a
   * takeover fails closed here even if its own lease has not expired yet
   * (AC-012). An expired-but-not-taken-over lease still passes.
   */
  async assertLeaseCurrent(handle: StepLeaseHandle): Promise<void> {
    const held = await this.engine.query<{ fencing_token: string }>(STEP_LEASE_ASSERT, [
      handle.resourceKey,
      handle.fencingToken,
    ]);
    if (held.rows.length === 0) {
      throw new StaleStepLeaseError(
        'commit refused: fencing token is no longer the current lease token',
        { resourceKey: handle.resourceKey, fencingToken: handle.fencingToken },
      );
    }
  }

  /** True when a live, unreleased, unexpired lease exists for the key. */
  async isLive(resourceKey: string): Promise<boolean> {
    const now = this.clock();
    const rows = await this.engine.query(
      `SELECT fencing_token FROM wf.step_leases
       WHERE resource_key = $1 AND released_at IS NULL AND expires_at > $2`,
      [resourceKey, now],
    );
    return rows.rows.length > 0;
  }
}
