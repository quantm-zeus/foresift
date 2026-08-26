/**
 * Pipeline stages 12–13 (FR-CORE-002, FR-CORE-007; PRD §16.2, §16.8): quota
 * cost estimation with capacity admission, then atomic reservation — both
 * delegated ENTIRELY through the injected QuotaReservationAdapter seam. This
 * module contains zero cost semantics: unknown cost, refusal reasons, and
 * protected-reserve admission all arrive as adapter verdicts.
 *
 * Backpressure outcomes are explicit typed exits (§16.8): QUEUE was resolved
 * at the lease stage; here RETURN_CACHE / DOWNGRADE_DEPTH /
 * SKIP_LOW_PRIORITY / QUOTA_EXHAUSTED each produce a distinct blocked state
 * carrying its action.
 */
import type {
  QuotaAdmissionDecision,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaReservationAdapter,
} from '../quota-contract.ts';
import type { ToolRunContext } from '../run-context.ts';
import { block } from './authn.ts';
import { computeExactCacheKey } from '../cache-key.ts';

/** Explicit §16.8 backpressure decision for one admission refusal. */
export type BackpressureDecision =
  | { readonly action: 'QUEUE' }
  | { readonly action: 'RETURN_CACHE' }
  | { readonly action: 'DOWNGRADE_DEPTH' }
  | { readonly action: 'SKIP_LOW_PRIORITY' }
  | { readonly action: 'QUOTA_EXHAUSTED' };

export type BackpressurePolicy = (
  refusal: QuotaAdmissionDecision & { readonly estimate: QuotaEstimate },
  ctx: ToolRunContext,
) => BackpressureDecision;

/** Default policy: any admission refusal exhausts the run (deny-closed). */
export const defaultBackpressurePolicy: BackpressurePolicy = () => ({
  action: 'QUOTA_EXHAUSTED',
});

export interface QuotaStageDeps {
  readonly quotaAdapter: QuotaReservationAdapter | undefined;
  readonly backpressurePolicy?: BackpressurePolicy | undefined;
}

function estimateRequestOf(ctx: ToolRunContext): QuotaEstimateRequest {
  return {
    provider: ctx.route!.provider,
    operation: ctx.route!.operation,
    workloadClass: ctx.request.workloadClass,
  };
}

/**
 * Stage 12 — ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION. An unbound
 * adapter is itself deny-closed: nothing has a known cost, so nothing
 * reserves.
 */
export function makeQuotaEstimateStage(deps: QuotaStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.servedFromCache || ctx.blocked) return;
    if (deps.quotaAdapter === undefined) {
      block(
        ctx,
        'COST_BLOCKED',
        'QUOTA_ADAPTER_UNBOUND: no cost semantics are composed',
        'QUOTA_ESTIMATE',
      );
      return;
    }
    let estimate: QuotaEstimate;
    try {
      estimate = await deps.quotaAdapter.estimate(estimateRequestOf(ctx));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      block(
        ctx,
        'COST_BLOCKED',
        `UNKNOWN_COST: ${message.includes('UNKNOWN_COST') ? message.slice('UNKNOWN_COST: '.length) : message}`,
        'QUOTA_ESTIMATE',
      );
      return;
    }
    ctx.estimate = estimate;
    if (!Number.isFinite(estimate.estimatedUnits) || estimate.estimatedUnits < 0) {
      block(
        ctx,
        'COST_BLOCKED',
        'UNKNOWN_COST: adapter returned an invalid estimate',
        'QUOTA_ESTIMATE',
      );
      return;
    }
    const maximum = ctx.request.authorizationEnvelope?.maxEstimatedUnits;
    if (maximum !== undefined && estimate.estimatedUnits > maximum) {
      block(
        ctx,
        'COST_BLOCKED',
        `AUTHORIZATION_COST_EXCEEDED: ${String(estimate.estimatedUnits)} > ${String(maximum)}`,
        'QUOTA_ESTIMATE',
      );
      return;
    }

    let admission: QuotaAdmissionDecision;
    try {
      admission = await deps.quotaAdapter.admit({ ...estimateRequestOf(ctx), estimate });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      block(
        ctx,
        'QUOTA_BLOCKED',
        `CAPACITY_ADMISSION_FAILED: ${message}`,
        'QUOTA_ESTIMATE',
        'QUOTA_EXHAUSTED',
      );
      return;
    }
    if (admission.allowed) return;

    // Capacity refused: resolve THE explicit backpressure exit.
    const policy = deps.backpressurePolicy ?? (() => ({ action: 'QUOTA_EXHAUSTED' }) as const);
    const decision = policy({ ...admission, estimate }, ctx);
    switch (decision.action) {
      case 'DOWNGRADE_DEPTH': {
        // One downgrade attempt with the narrower projection; a second
        // refusal cannot downgrade again.
        const route = ctx.route!;
        const narrowed = route.downgradedFieldProjection;
        if (narrowed !== undefined && !ctx.downgradedProjection) {
          ctx.downgradedProjection = true;
          ctx.request = { ...ctx.request, fieldProjection: narrowed };
          if (ctx.cacheComponents !== undefined) {
            ctx.cacheComponents = { ...ctx.cacheComponents, fieldProjection: [...narrowed] };
            ctx.cacheKey = computeExactCacheKey(ctx.cacheComponents);
          }
          const retryEstimate = await deps.quotaAdapter.estimate(estimateRequestOf(ctx));
          const retryAdmission = await deps.quotaAdapter.admit({
            provider: route.provider,
            operation: route.operation,
            workloadClass: ctx.request.workloadClass,
            estimate: retryEstimate,
          });
          if (retryAdmission.allowed) {
            ctx.estimate = retryEstimate;
            return;
          }
        }
        block(
          ctx,
          'QUOTA_BLOCKED',
          `DOWNGRADE_REFUSED: ${admission.reason}`,
          'QUOTA_ESTIMATE',
          'DOWNGRADE_DEPTH',
        );
        return;
      }
      case 'QUEUE':
        block(
          ctx,
          'QUOTA_BLOCKED',
          `CAPACITY_QUEUED: ${admission.reason}`,
          'QUOTA_ESTIMATE',
          'QUEUE',
        );
        return;
      case 'RETURN_CACHE':
        block(
          ctx,
          'QUOTA_BLOCKED',
          `RETURN_CACHE_UNAVAILABLE: ${admission.reason}`,
          'QUOTA_ESTIMATE',
          'RETURN_CACHE',
        );
        return;
      case 'SKIP_LOW_PRIORITY':
        block(
          ctx,
          'QUOTA_BLOCKED',
          `SKIP_LOW_PRIORITY: ${admission.reason}`,
          'QUOTA_ESTIMATE',
          'SKIP_LOW_PRIORITY',
        );
        return;
      case 'QUOTA_EXHAUSTED':
      default:
        block(
          ctx,
          'QUOTA_BLOCKED',
          `QUOTA_EXHAUSTED: ${admission.reason}`,
          'QUOTA_ESTIMATE',
          'QUOTA_EXHAUSTED',
        );
        return;
    }
  };
}

/**
 * Stage 13 — ATOMICALLY_RESERVE_QUOTA through the adapter (the guarded SQL
 * state machine underneath makes concurrent reserve races converge).
 */
export function makeQuotaReserveStage(deps: QuotaStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.servedFromCache || ctx.blocked) return;
    const adapter = deps.quotaAdapter;
    if (adapter === undefined || ctx.estimate === undefined) {
      throw new Error('reserve ran without an adapter or estimate');
    }
    try {
      const reservationId = await adapter.reserve({
        ...estimateRequestOf(ctx),
        actorId: ctx.actor?.actorId ?? ctx.runId,
        pipelineRunId: ctx.runId,
        stage: 'ATOMICALLY_RESERVE_QUOTA',
        estimate: ctx.estimate,
      });
      ctx.reservationId = reservationId;
      ctx.quotaState = 'RESERVED';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      block(
        ctx,
        'QUOTA_BLOCKED',
        `RESERVATION_REFUSED: ${message}`,
        'QUOTA_RESERVE',
        'QUOTA_EXHAUSTED',
      );
    }
  };
}
