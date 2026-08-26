/**
 * Pipeline stages 6–13 (FR-CORE-002, FR-CORE-006, FR-CORE-007; PRD
 * §16.2/§16.4/§16.6/§16.7/§16.8):
 *
 *    6. calculate exact cache key
 *    7. check request-local memoization
 *    8. check fresh cache
 *    9. if allowed, check acceptable stale cache
 *   10. acquire distributed single-flight lease when external refresh may be required
 *   11. re-check cache after lease
 *   12. estimate quota/cost and verify capacity/protected-reserve admission
 *   13. atomically reserve quota when an external call is required
 *
 * All caching flows through the Phase-D CacheStageChain, single-flight through
 * the Phase-D SingleFlightManager, and every quota/cost decision through the
 * QuotaReservationAdapter seam — protected-reserve admission is delegated to
 * that seam, never decided here (milestone boundary). Backpressure outcomes
 * (queue | return-cache | downgrade | skip | QUOTA_EXHAUSTED) are explicit
 * typed exits; uncontrolled parallel calls are structurally impossible because
 * stage 10 waits on THE database lease or exits.
 */
import { ForesiftError } from '@foresift/domain';
import { block, exited, type ToolCallContext } from '../run-context.ts';
import type { CacheStageChain } from './cache.ts';
import type { SingleFlightManager } from '../single-flight.ts';
import type { QuotaReservationAdapter } from '../quota-contract.ts';

export interface CacheFlowDeps {
  readonly chain: CacheStageChain;
  readonly singleFlight: SingleFlightManager;
  readonly quota: QuotaReservationAdapter;
  /** How long a contended lease is waited on before a QUEUE backpressure exit. */
  readonly leaseWaitDeadlineMs: number;
  readonly leaseTtlSeconds: number;
}

function refuse(ctx: ToolCallContext, state: 'COST_BLOCKED' | 'QUOTA_BLOCKED' | 'CAPABILITY_UNAVAILABLE', reason: string): void {
  block(ctx, {
    payload: {
      acquisitionState: state,
      machineReason: reason,
      toolName: ctx.request.toolName,
      toolVersion: ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown',
      pipelineRunId: ctx.runId,
      at: ctx.now(),
    },
    auditOutcome: 'BLOCKED',
    persistAcquisitionRow: false,
  });
}

/** Stage 6 — calculate exact cache key over the nine §16.4 components. */
export function calculateExactCacheKey(ctx: ToolCallContext): void {
  if (exited(ctx)) return;
  const license = ctx.licenseVerdict;
  if (license === null) return; // unreachable after stage 4's envelope check
  const request = ctx.request;
  ctx.keyComponents = {
    provider: request.provider ?? 'composite',
    operation: request.operation ?? request.toolName,
    operationVersion: request.operationVersion ?? ctx.entry?.metadata.version ?? '0.0.0',
    chain: request.chain ?? 'none',
    canonicalEntityIdentity: ctx.canonicalEntityIdentity,
    normalizedArguments: (ctx.canonicalInput ?? {}) as Record<string, unknown>,
    fieldProjection: [...(request.fieldProjection ?? [])],
    asOf: request.asOf ?? ctx.now(),
    licensePolicyVersion: license.policyVersion,
  };
  // ctx.cacheKey is filled by the chain's lookup (it owns key construction);
  // stage 10 reads the exact-key hash off the lookup result.
}

/** Stages 7–9 — memoization → fresh → acceptable-stale (short-circuit order). */
export async function checkCacheStages(ctx: ToolCallContext, deps: CacheFlowDeps): Promise<void> {
  if (exited(ctx)) return;
  // The chain evaluates memo → fresh → stale in exactly this order with
  // short-circuiting; stages 8–9 are the same decision surfaced as separate
  // pipeline stages and no-op once an earlier tier already served.
  const holderMode = ctx.actor!.holderMode;
  const result = await deps.chain.lookup({
    components: ctx.keyComponents!,
    holderMode,
  });
  ctx.cacheResult = result;
  if (result.outcome !== 'MISS') {
    ctx.cacheOutcome = result.outcome === 'MEMO_HIT' ? 'HIT_FRESH' : result.outcome;
    ctx.fetchedAt = ctx.now(); // the returned payload was obtained NOW
  }
}

/** Stage 10 — acquire the cross-mode single-flight lease when refresh may be needed. */
export async function acquireSingleFlightLease(
  ctx: ToolCallContext,
  deps: CacheFlowDeps,
): Promise<void> {
  if (exited(ctx)) return;
  if (ctx.cacheResult !== null && ctx.cacheResult.outcome !== 'MISS') return; // served from cache
  const resourceKeyHash = ctx.cacheResult?.key.cacheKeyHash;
  if (resourceKeyHash === undefined) return; // no lookup happened — nothing to fence

  const deadline = Date.now() + deps.leaseWaitDeadlineMs;
  for (;;) {
    try {
      ctx.lease = await deps.singleFlight.acquire({
        resourceKeyHash,
        holderMode: ctx.actor!.holderMode,
        holderId: ctx.actor!.actorId,
        ttlSeconds: deps.leaseTtlSeconds,
      });
      ctx.cacheKey = ctx.cacheResult!.key;
      return;
    } catch (error) {
      if (!(error instanceof ForesiftError) || error.code !== 'LEASE_FENCING_TOKEN_STALE') {
        throw error;
      }
      // Live lease held by another actor/mode: wait bounded, then exit QUEUE
      // (explicit backpressure — never an uncontrolled parallel call).
      if (Date.now() >= deadline) {
        ctx.backpressure = 'QUEUE';
        block(ctx, {
          payload: {
            acquisitionState: 'QUOTA_BLOCKED',
            machineReason: 'BACKPRESSURE_QUEUE:single-flight lease contended past deadline',
            toolName: ctx.request.toolName,
            toolVersion: ctx.entry?.metadata.version ?? 'unknown',
            pipelineRunId: ctx.runId,
            at: ctx.now(),
          },
          auditOutcome: 'BLOCKED',
          // The REQUESTED row stays open — the attempt is queued, not ended.
          persistAcquisitionRow: false,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deps.leaseWaitDeadlineMs / 20))));
    }
  }
}

/** Stage 11 — re-check cache AFTER the lease wait; a concurrent refresh wins. */
export async function recheckCacheAfterLease(
  ctx: ToolCallContext,
  deps: CacheFlowDeps,
): Promise<void> {
  if (exited(ctx)) return;
  if (ctx.lease === null) return; // nothing was acquired — cache already served or skipped
  const result = await deps.chain.postLeaseRecheck({
    components: ctx.keyComponents!,
    holderMode: ctx.actor!.holderMode,
  });
  if (result.outcome !== 'MISS') {
    ctx.cacheResult = result;
    ctx.cacheOutcome = result.outcome === 'MEMO_HIT' ? 'HIT_FRESH' : result.outcome;
    ctx.fetchedAt = ctx.now(); // the returned payload was obtained NOW
  }
}

/** Stage 12 — estimate quota/cost and verify capacity/protected-reserve admission. */
export async function estimateQuotaAndAdmission(
  ctx: ToolCallContext,
  deps: CacheFlowDeps,
): Promise<void> {
  if (exited(ctx)) return;
  if (ctx.cacheResult !== null && ctx.cacheResult.outcome !== 'MISS') return;
  const base = {
    provider: ctx.keyComponents!.provider,
    operation: ctx.keyComponents!.operation,
    workloadClass: ctx.request.workloadClass,
  };

  let estimate;
  try {
    estimate = await deps.quota.estimate(base);
  } catch (error) {
    // Unknown cost refuses fail-closed (STRICT_FREE semantics arrive via the
    // seam — the pipeline only maps the refusal to its typed state).
    refuse(ctx, 'COST_BLOCKED', `UNKNOWN_COST:${(error as Error).message}`);
    return;
  }
  ctx.quotaEstimate = estimate;

  const admission = await deps.quota.admit({ ...base, estimate });
  ctx.quotaAdmission = admission;
  if (!admission.allowed) {
    if (admission.reason.startsWith('QUOTA_EXHAUSTED')) {
      ctx.backpressure = 'QUOTA_EXHAUSTED';
      refuse(ctx, 'QUOTA_BLOCKED', `BACKPRESSURE_QUOTA_EXHAUSTED:${admission.reason}`);
    } else if (admission.reason.startsWith('UNKNOWN_COST')) {
      refuse(ctx, 'COST_BLOCKED', `UNKNOWN_COST:${admission.reason}`);
    } else if (
      admission.reason.startsWith('BACKPRESSURE:DOWNGRADE')
    ) {
      ctx.backpressure = 'DOWNGRADE_DEPTH';
      refuse(ctx, 'QUOTA_BLOCKED', `BACKPRESSURE_DOWNGRADE_DEPTH:${admission.reason}`);
    } else if (admission.reason.startsWith('BACKPRESSURE:SKIP')) {
      ctx.backpressure = 'SKIP_LOW_PRIORITY';
      refuse(ctx, 'QUOTA_BLOCKED', `BACKPRESSURE_SKIP_LOW_PRIORITY:${admission.reason}`);
    } else {
      refuse(ctx, 'QUOTA_BLOCKED', `QUOTA_ADMISSIBILITY_REFUSED:${admission.reason}`);
    }
  }
}

/** Stage 13 — atomically reserve quota for the external call. */
export async function reserveQuotaAtomically(
  ctx: ToolCallContext,
  deps: CacheFlowDeps,
): Promise<void> {
  if (exited(ctx)) return;
  if (ctx.cacheResult !== null && ctx.cacheResult.outcome !== 'MISS') return;
  try {
    ctx.reservationId = await deps.quota.reserve({
      pipelineRunId: ctx.runId,
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: ctx.actor!.actorId,
      provider: ctx.keyComponents!.provider,
      operation: ctx.keyComponents!.operation,
      workloadClass: ctx.request.workloadClass,
      estimate: ctx.quotaEstimate!,
    });
  } catch (error) {
    refuse(
      ctx,
      'QUOTA_BLOCKED',
      `RESERVATION_REFUSED:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
