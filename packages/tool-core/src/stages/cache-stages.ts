/**
 * Pipeline stages 6–11 wiring (FR-CORE-006; PRD §16.2): exact cache-key
 * calculation, request-local memoization, fresh check, acceptable-stale
 * check, distributed single-flight lease acquisition (with QUEUE
 * backpressure), and the post-lease re-check. All decisions delegate to the
 * Phase-D seams (`cache-key`, `stages/cache`, `single-flight`) — this module
 * only wires them into THE stage sequence.
 *
 * Serving from cache is a terminal short-circuit: stages 12–22 become no-ops
 * except their cleanup duties, while audit + result still run.
 */
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import { computeExactCacheKey } from '../cache-key.ts';
import { CacheStageChain } from './cache.ts';
import type { ToolRunContext } from '../run-context.ts';
import { block } from './authn.ts';
import { SingleFlightManager } from '../single-flight.ts';
import { ForesiftError } from '@foresift/domain';

export interface CacheStagesDeps {
  readonly chain: CacheStageChain;
  readonly singleFlight: SingleFlightManager;
  readonly now: () => string;
  /** Lease wait cadence for QUEUE backpressure. */
  readonly leaseWaitPollMs?: number | undefined;
}

/** True when the run already has its answer and functional stages must skip. */
export function resolvedFromCache(ctx: ToolRunContext): boolean {
  return ctx.servedFromCache || ctx.blocked !== undefined;
}

function serveFromCache(
  ctx: ToolRunContext,
  outcome: 'HIT_FRESH' | 'HIT_STALE' | 'MEMO_HIT',
): void {
  ctx.cacheOutcome = outcome === 'MEMO_HIT' ? 'HIT_FRESH' : outcome;
  ctx.servedFromCache = true;
}

/** Stage 6 — CALCULATE_EXACT_CACHE_KEY. */
export function makeCacheKeyStage(deps: CacheStagesDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (resolvedFromCache(ctx)) return;
    const route = ctx.route!;
    const components: CacheKeyComponents = {
      provider: route.provider,
      operation: route.operation,
      operationVersion: route.operationVersion,
      chain: route.chain,
      canonicalEntityIdentity: ctx.request.canonicalEntityIdentity,
      normalizedArguments: asRecord(ctx.canonicalInput),
      fieldProjection: [...(ctx.request.fieldProjection ?? route.fieldProjection)],
      asOf: ctx.request.asOf ?? deps.now(),
      licensePolicyVersion: ctx.licenseVerdict?.policyVersion ?? 'unverified',
    };
    ctx.cacheComponents = components;
    ctx.cacheKey = computeExactCacheKey(components);
  };
}

/** Stages 7–9 — memoization → fresh → acceptable-stale, in THE fixed order. */
export function makeCacheLookupStages(deps: CacheStagesDeps) {
  return {
    /** Stage 7 — CHECK_REQUEST_LOCAL_MEMOIZATION. */
    memoStage: async (ctx: ToolRunContext): Promise<void> => {
      if (resolvedFromCache(ctx)) return;
      const verdict = await deps.chain.lookupMemo({
        components: ctx.cacheComponents!,
        holderMode: ctx.request.holderMode,
        requestScope: ctx.runId,
      });
      if (verdict.outcome === 'MEMO_HIT') {
        if (verdict.payloadRef !== undefined) ctx.cachedPayloadRef = verdict.payloadRef;
        serveFromCache(ctx, 'MEMO_HIT');
      }
    },
    /** Stage 8 — CHECK_FRESH_CACHE. */
    freshStage: async (ctx: ToolRunContext): Promise<void> => {
      if (resolvedFromCache(ctx)) return;
      const verdict = await deps.chain.lookupFresh({
        components: ctx.cacheComponents!,
        holderMode: ctx.request.holderMode,
        requestScope: ctx.runId,
      });
      if (verdict.outcome === 'HIT_FRESH') {
        if (verdict.payloadRef !== undefined) ctx.cachedPayloadRef = verdict.payloadRef;
        serveFromCache(ctx, 'HIT_FRESH');
      }
    },
    /** Stage 9 — CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED. */
    staleStage: async (ctx: ToolRunContext): Promise<void> => {
      if (resolvedFromCache(ctx)) return;
      const verdict = await deps.chain.lookupStale({
        components: ctx.cacheComponents!,
        holderMode: ctx.request.holderMode,
        requestScope: ctx.runId,
      });
      if (verdict.outcome === 'HIT_STALE') {
        if (verdict.payloadRef !== undefined) ctx.cachedPayloadRef = verdict.payloadRef;
        serveFromCache(ctx, 'HIT_STALE');
      }
    },
  };
}

/** Stage 10 — ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE (QUEUE backpressure). */
export function makeLeaseAcquireStage(deps: CacheStagesDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (resolvedFromCache(ctx)) return;
    const resourceKeyHash = SingleFlightManager.resourceKeyHash({
      provider: ctx.cacheComponents!.provider,
      operation: ctx.cacheComponents!.operation,
      canonicalEntityIdentity: ctx.request.canonicalEntityIdentity,
    });
    try {
      ctx.lease = await deps.singleFlight.acquire({
        resourceKeyHash,
        holderMode: ctx.request.holderMode,
        holderId: ctx.runId,
      });
    } catch (error) {
      if (!(error instanceof ForesiftError) || error.code !== 'LEASE_FENCING_TOKEN_STALE') {
        throw error;
      }
      // Live lease held by another mode/actor ⇒ QUEUE: bounded wait for the
      // lease to free, then take over. Deadline breach exits TIMED_OUT.
      const deadline = Date.now() + ctx.route!.deadlineMs;
      const pollMs = deps.leaseWaitPollMs ?? 25;
      for (;;) {
        await sleep(pollMs);
        if (Date.now() > deadline) {
          block(
            ctx,
            'TIMED_OUT',
            'LEASE_WAIT_DEADLINE_EXCEEDED: single-flight queue exceeded the dispatch deadline',
            'ACQUIRE_LEASE',
            'QUEUE',
          );
          return;
        }
        try {
          ctx.waitedForLease = true;
          ctx.lease = await deps.singleFlight.acquire({
            resourceKeyHash,
            holderMode: ctx.request.holderMode,
            holderId: ctx.runId,
          });
          return;
        } catch (retryError) {
          if (
            !(retryError instanceof ForesiftError) ||
            retryError.code !== 'LEASE_FENCING_TOKEN_STALE'
          ) {
            throw retryError;
          }
          // still live; keep waiting
        }
      }
    }
  };
}

/** Stage 11 — RECHECK_CACHE_AFTER_LEASE. */
export function makePostLeaseRecheckStage(deps: CacheStagesDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (resolvedFromCache(ctx)) return;
    // A cache decision made before a lease wait is stale by construction.
    if (!ctx.waitedForLease) return;
    const verdict = await deps.chain.postLeaseRecheck({
      components: ctx.cacheComponents!,
      holderMode: ctx.request.holderMode,
      requestScope: ctx.runId,
    });
    if (verdict.outcome === 'HIT_FRESH' || verdict.outcome === 'HIT_STALE') {
      ctx.cacheOutcome = verdict.outcome;
      if (verdict.payloadRef !== undefined) ctx.cachedPayloadRef = verdict.payloadRef;
      serveFromCache(ctx, verdict.outcome);
    }
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { value: input };
  }
  return input as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
