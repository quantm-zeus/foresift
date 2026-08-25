/**
 * Cache stage chain — pipeline stages 6–11 (FR-CORE-006; PRD §16.2/§16.4/
 * §16.5). Lookup order short-circuits exactly as the pipeline mandates:
 * request-local memoization, then FRESH, then acceptable-stale (admission
 * governed by the §16.5 table and the caller's holder mode), and a post-lease
 * re-check so a lease wait can never serve a decision made before another
 * actor refreshed the entry. Store-side writes happen only when rights AND
 * cache policy permit (stage 20 semantics); lookups are point-in-time-safe
 * (`stored_at <= decisionTime`), so no reader ever observes backdating.
 */
import type { FreshnessFieldFamily, HolderMode } from '@foresift/domain';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import type { DatabaseEngine } from '@foresift/persistence';
import { computeExactCacheKey, type ExactCacheKey } from '../cache-key.ts';
import { FreshnessEvaluator, type FreshnessOutcome } from '../freshness.ts';

export interface CachePolicy {
  /** When false, stage 20 never writes this tool's results to the cache. */
  readonly cachingPermitted: boolean;
}

interface CacheRow {
  payload_ref: string;
  stored_at: string;
  fresh_until: string;
  stale_until: string;
  license_policy_version: string;
  rights_permitted: boolean;
}

export interface CacheLookupResult {
  readonly outcome: Exclude<FreshnessOutcome, 'EXPIRED'> | 'MISS' | 'MEMO_HIT';
  readonly key: ExactCacheKey;
  readonly payloadRef?: string;
}

export interface CacheStoreRequest {
  readonly components: CacheKeyComponents;
  readonly payloadRef: string;
  readonly storedAt: string;
  readonly rightsAllowed: boolean;
  readonly policy: CachePolicy;
}

export interface CacheStageOptions {
  readonly engine: DatabaseEngine;
  readonly evaluator?: FreshnessEvaluator;
  readonly now?: () => string;
  /**
   * Operation → §16.5 field-family resolution. Injected at composition from
   * the tool definition's declared families; defaults to `metadata`, the
   * least fresh-sensitive row.
   */
  readonly resolveFamily?: (components: CacheKeyComponents) => FreshnessFieldFamily;
}

export class CacheStageChain {
  private readonly memo = new Map<string, CacheLookupResult>();
  private readonly evaluator: FreshnessEvaluator;
  private readonly resolveFamily: (components: CacheKeyComponents) => FreshnessFieldFamily;

  constructor(private readonly opts: CacheStageOptions) {
    this.evaluator = opts.evaluator ?? new FreshnessEvaluator();
    this.resolveFamily = opts.resolveFamily ?? (() => 'metadata');
  }

  private async keyFor(components: CacheKeyComponents): Promise<ExactCacheKey> {
    // Financial/identity classes have exact-only caching; the refusal lives
    // in the key builder itself, so no later stage can bypass it.
    return computeExactCacheKey(components);
  }

  /**
   * Stages 6–8 + 10: memo → fresh → acceptable-stale. `decisionTime`
   * defaults to now; the post-lease re-check passes an explicit time so the
   * second decision is re-evaluated AFTER the lease wait.
   */
  async lookup(request: {
    components: CacheKeyComponents;
    holderMode: HolderMode;
    decisionTime?: string;
  }): Promise<CacheLookupResult> {
    const key = await this.keyFor(request.components);
    const memoHit = this.memo.get(key.cacheKeyHash);
    if (memoHit && memoHit.outcome !== 'MISS') return memoHit;

    const decisionTime = request.decisionTime ?? this.opts.now?.() ?? new Date().toISOString();
    const rows = await this.opts.engine.query<CacheRow>(
      `SELECT payload_ref, stored_at, fresh_until, stale_until,
              license_policy_version, rights_permitted
       FROM core.core_exact_cache_entries
       WHERE cache_key_hash = $1 AND stored_at <= $2
       ORDER BY stored_at DESC LIMIT 1`,
      [key.cacheKeyHash, decisionTime],
    );
    const row = rows.rows[0];
    if (!row) return { outcome: 'MISS', key };

    // License component mismatch refuses fail-closed: the entry was written
    // under a different policy version than the request carries.
    if (
      row.license_policy_version !== request.components.licensePolicyVersion ||
      !row.rights_permitted
    ) {
      return { outcome: 'MISS', key };
    }

    const verdict = this.evaluator.evaluate({
      family: this.resolveFamily(request.components),
      storedAt: row.stored_at,
      decisionTime,
      holderMode: request.holderMode,
    });
    if (verdict.outcome === 'HIT_FRESH' || verdict.outcome === 'HIT_STALE') {
      const result: CacheLookupResult = {
        outcome: verdict.outcome,
        key,
        payloadRef: row.payload_ref,
      };
      this.memo.set(key.cacheKeyHash, result);
      return result;
    }
    return { outcome: 'MISS', key };
  }

  /**
   * Stage 11's post-lease re-check: forget nothing, re-decide everything at
   * the CURRENT time. The memo from before the lease wait is dropped — a
   * concurrent refresh during the wait must be observed.
   */
  async postLeaseRecheck(request: {
    components: CacheKeyComponents;
    holderMode: HolderMode;
  }): Promise<CacheLookupResult> {
    const key = await this.keyFor(request.components);
    this.memo.delete(key.cacheKeyHash);
    return this.lookup({ ...request, decisionTime: this.opts.now?.() ?? new Date().toISOString() });
  }

  /**
   * Stage 20 write path: only when rights allow AND cache policy permits.
   * Freshness windows come from the §16.5 family row at write time.
   */
  async storeIfPermitted(request: CacheStoreRequest): Promise<boolean> {
    if (!request.rightsAllowed || !request.policy.cachingPermitted) return false;
    const key = await this.keyFor(request.components);
    const row = this.evaluator.policyFor(this.resolveFamily(request.components));
    const storedAt = request.storedAt;
    const freshUntil = addSeconds(storedAt, row.freshTtlSeconds);
    const staleUntil = addSeconds(storedAt, row.acceptableStaleSeconds);
    await this.opts.engine.query(
      `INSERT INTO core.core_exact_cache_entries
         (cache_key_hash, payload_ref, stored_at, fresh_until, stale_until,
          license_policy_version, rights_permitted)
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [
        key.cacheKeyHash,
        request.payloadRef,
        storedAt,
        freshUntil,
        staleUntil,
        request.components.licensePolicyVersion,
      ],
    );
    return true;
  }
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
