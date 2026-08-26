/**
 * ToolCoreEngine (FR-CORE-002; PRD §16.2) — the composition of all 24 stage
 * handlers onto THE PipelineOrchestrator. The orchestrator guarantees the
 * exact pinned order and one execution per stage; this module guarantees:
 *
 *   - an unexpected throw in ANY stage becomes a typed INTERNAL_ERROR exit on
 *     the run context instead of breaking the sequence, so stages 23–24 still
 *     run — every exit is audited, every call returns a structured result;
 *   - envelope completeness is validated BEFORE the audit append so the
 *     audited outcome is exactly the returned outcome.
 */
import { randomUUID } from 'node:crypto';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type { AuditChain } from '@foresift/security';
import type { ToolResultEnvelope } from '@foresift/shared-schemas';
import type { PipelineRunState } from './pipeline.ts';
import { PipelineOrchestrator, type PipelineHandlers } from './pipeline.ts';
import {
  block,
  createContext,
  exited,
  type StageExit,
  type ToolCallContext,
  type ToolCallRequest,
} from './run-context.ts';
import type { AuthnPrimitive, AuthzPrimitive } from './stages/authn.ts';
import { authenticateActor, authorizeCall } from './stages/authn.ts';
import {
  validateAcquisitionDecisionAndEnvelope,
  validateAndCanonicalizeInput,
} from './stages/validate.ts';
import { persistPreExecutionState } from './stages/acquisition.ts';
import {
  acquireSingleFlightLease,
  calculateExactCacheKey,
  checkCacheStages,
  estimateQuotaAndAdmission,
  recheckCacheAfterLease,
  reserveQuotaAtomically,
  type CacheFlowDeps,
} from './stages/cacheflow.ts';
import {
  dispatchOperation,
  identityNormalizer,
  normalizeProviderResponse,
  validateContentTypeAndRawSchema,
  validateNormalizedInvariants,
  type DispatchDeps,
  type EgressGuardLike,
  type NormalizedPayload,
} from './stages/dispatch.ts';
import {
  persistAcquisitionOutcome,
  persistEvidenceMetadata,
  releaseLease,
  settleQuota,
  updateExactCache,
} from './stages/persist.ts';
import { writeAuditAndTrace } from './stages/audit.ts';
import {
  buildEnvelope,
  buildFallbackEnvelope,
  validateEnvelopeCompleteness,
} from './envelope.ts';
import type { CachePolicy, CacheStageChain } from './stages/cache.ts';
import type { SingleFlightManager } from './single-flight.ts';
import type { QuotaReservationAdapter } from './quota-contract.ts';
import type { LicensePolicySource } from './license-contract.ts';
import type { ProhibitedCapabilityScreen } from './prohibited.ts';
import type { ToolCoreRegistry } from './registry.ts';

export interface ToolCoreEngineOptions {
  readonly engine: DatabaseEngine;
  readonly registry: ToolCoreRegistry;
  readonly auditChain: AuditChain;

  // perimeter primitives (deny-closed defaults at composition)
  readonly authn: AuthnPrimitive;
  readonly authz: AuthzPrimitive;

  // seams
  readonly licenseSource?: LicensePolicySource;
  readonly quota: QuotaReservationAdapter;

  // cache/single-flight
  readonly cacheChain: CacheStageChain;
  readonly singleFlight: SingleFlightManager;
  /** When false, stage 20 never writes results to the exact cache. */
  readonly cachingPermitted?: boolean;

  // dispatch harness
  readonly screen: ProhibitedCapabilityScreen;
  readonly egress: EgressGuardLike;
  readonly deadlineMs?: number;
  readonly maxResponseBytes?: number;
  /** Per-operation response content type as validated at stage 15. */
  readonly resolveContentType?: () => string | undefined;
  /** Custom normalizer; defaults to identity normalization. */
  readonly normalize?: (raw: unknown) => NormalizedPayload;

  // timing
  readonly now?: () => UtcTimestamp;
  readonly leaseWaitDeadlineMs?: number;
  readonly leaseTtlSeconds?: number;
}

export interface ToolCallExecutionResult {
  readonly result: ToolResultEnvelope;
  readonly context: ToolCallContext;
}

const DEFAULT_DEADLINE_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_LEASE_WAIT_MS = 5_000;
const DEFAULT_LEASE_TTL_SECONDS = 60;

/**
 * Wrap a stage function so an unexpected error becomes a typed ERROR exit
 * (first exit wins) instead of aborting the pinned sequence. The remaining
 * stages then no-op or settle, and stages 23–24 still audit + return.
 */
function guarded(stage: string, fn: (ctx: ToolCallContext) => Promise<void> | void) {
  return async (state: PipelineRunState): Promise<void> => {
    const ctx = state.context as ToolCallContext;
    try {
      await fn(ctx);
    } catch (error) {
      internalErrorExit(ctx, stage, error);
    }
  };
}

function internalErrorExit(ctx: ToolCallContext, stage: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const exit: StageExit = {
    payload: {
      acquisitionState: 'CAPABILITY_UNAVAILABLE',
      machineReason: `INTERNAL_ERROR:${stage}:${message}`,
      toolName: ctx.entry?.metadata.name ?? ctx.request.toolName,
      toolVersion: ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown',
      pipelineRunId: ctx.runId,
      at: ctx.now(),
    },
    auditOutcome: 'ERROR',
    persistAcquisitionRow: false,
  };
  block(ctx, exit);
  ctx.degradedMarkers.push(`STAGE_FAULT:${stage}`);
}

export class ToolCoreEngine {
  private readonly orchestrator: PipelineOrchestrator;
  private readonly opts: Required<
    Pick<
      ToolCoreEngineOptions,
      'deadlineMs' | 'maxResponseBytes' | 'leaseWaitDeadlineMs' | 'leaseTtlSeconds'
    >
  > &
    ToolCoreEngineOptions;

  constructor(opts: ToolCoreEngineOptions) {
    this.opts = {
      deadlineMs: DEFAULT_DEADLINE_MS,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
      leaseWaitDeadlineMs: DEFAULT_LEASE_WAIT_MS,
      leaseTtlSeconds: DEFAULT_LEASE_TTL_SECONDS,
      ...opts,
    };
    this.orchestrator = new PipelineOrchestrator(this.buildHandlers());
  }

  get stageSequence() {
    return this.orchestrator.stageSequence;
  }

  /**
   * Execute one tool call through the exact 24-stage pipeline. Always resolves
   * with a structured result — blocked exits and internal faults included.
   */
  async execute(request: ToolCallRequest): Promise<ToolCallExecutionResult> {
    const now =
      this.opts.now ?? ((): UtcTimestamp => utcTimestamp(new Date().toISOString()));
    const ctx = createContext(`run-${randomUUID()}`, request, now);
    await this.orchestrator.run(ctx.runId, ctx);
    return { result: ctx.result!, context: ctx };
  }

  private buildHandlers(): PipelineHandlers {
    const o = this.opts;
    const cacheFlowDeps: CacheFlowDeps = {
      chain: o.cacheChain,
      singleFlight: o.singleFlight,
      quota: o.quota,
      leaseWaitDeadlineMs: o.leaseWaitDeadlineMs,
      leaseTtlSeconds: o.leaseTtlSeconds,
    };
    const dispatchDeps: DispatchDeps = {
      screen: o.screen,
      egress: o.egress,
      deadlineMs: o.deadlineMs,
      maxResponseBytes: o.maxResponseBytes,
    };
    const cachePolicy: CachePolicy = { cachingPermitted: o.cachingPermitted ?? true };

    return {
      AUTHENTICATE_ACTOR: guarded('AUTHENTICATE_ACTOR', (ctx) =>
        authenticateActor(ctx, o.authn),
      ),
      AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS: guarded(
        'AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS',
        (ctx) =>
          authorizeCall(ctx, {
            resolveEntry: () =>
              o.registry.resolve(ctx.request.toolName, ctx.request.toolVersion) ?? null,
            authz: o.authz,
            licenseVerdict: async () => {
              const entry = ctx.entry!;
              const query = {
                licensePolicyId: entry.metadata.licensePolicyId,
                provider: ctx.request.provider ?? 'composite',
                operation: ctx.request.operation ?? ctx.request.toolName,
              };
              if (o.licenseSource === undefined) {
                return { allowed: false, policyVersion: 'unbound', reason: 'LICENSE_SOURCE_UNBOUND' };
              }
              return o.licenseSource.verdict(query);
            },
          }),
      ),
      VALIDATE_AND_CANONICALIZE_INPUT: guarded('VALIDATE_AND_CANONICALIZE_INPUT', (ctx) =>
        validateAndCanonicalizeInput(ctx),
      ),
      VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE: guarded(
        'VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE',
        (ctx) => validateAcquisitionDecisionAndEnvelope(ctx),
      ),
      PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE: guarded(
        'PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE',
        (ctx) => persistPreExecutionState(ctx, o.engine),
      ),
      CALCULATE_EXACT_CACHE_KEY: guarded('CALCULATE_EXACT_CACHE_KEY', (ctx) =>
        calculateExactCacheKey(ctx),
      ),
      CHECK_REQUEST_LOCAL_MEMOIZATION: guarded('CHECK_REQUEST_LOCAL_MEMOIZATION', (ctx) =>
        checkCacheStages(ctx, cacheFlowDeps),
      ),
      CHECK_FRESH_CACHE: guarded('CHECK_FRESH_CACHE', () => {
        // Stages 7–9 are ONE short-circuiting chain evaluation surfaced as
        // three pinned stages; 7 already ran memo → fresh → stale.
      }),
      CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED: guarded(
        'CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED',
        () => {},
      ),
      ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE: guarded(
        'ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE',
        (ctx) => acquireSingleFlightLease(ctx, cacheFlowDeps),
      ),
      RECHECK_CACHE_AFTER_LEASE: guarded('RECHECK_CACHE_AFTER_LEASE', (ctx) =>
        recheckCacheAfterLease(ctx, cacheFlowDeps),
      ),
      ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION: guarded(
        'ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION',
        (ctx) => estimateQuotaAndAdmission(ctx, cacheFlowDeps),
      ),
      ATOMICALLY_RESERVE_QUOTA: guarded('ATOMICALLY_RESERVE_QUOTA', (ctx) =>
        reserveQuotaAtomically(ctx, cacheFlowDeps),
      ),
      CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION: guarded(
        'CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION',
        (ctx) => dispatchOperation(ctx, dispatchDeps),
      ),
      VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA: guarded('VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA', (ctx) => {
        const contentType = o.resolveContentType?.();
        validateContentTypeAndRawSchema(
          ctx,
          contentType === undefined ? {} : { contentType },
        );
      }),
      NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY: guarded(
        'NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY',
        (ctx) => normalizeProviderResponse(ctx, o.normalize ?? identityNormalizer),
      ),
      VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS: guarded(
        'VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS',
        (ctx) => validateNormalizedInvariants(ctx),
      ),
      COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST: guarded('COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST', (ctx) =>
        settleQuota(ctx, cacheFlowDeps),
      ),
      PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT: guarded(
        'PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT',
        (ctx) => persistEvidenceMetadata(ctx, o.engine),
      ),
      UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT: guarded(
        'UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT',
        (ctx) => updateExactCache(ctx, cacheFlowDeps, cachePolicy),
      ),
      RELEASE_LEASE_WITH_FENCING_VALIDATION: guarded(
        'RELEASE_LEASE_WITH_FENCING_VALIDATION',
        (ctx) => releaseLease(ctx, cacheFlowDeps),
      ),
      PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT: guarded(
        'PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT',
        (ctx) => persistAcquisitionOutcome(ctx, o.engine),
      ),
      WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT: guarded(
        'WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT',
        async (ctx) => {
          // Completeness gate BEFORE audit: a success that cannot produce an
          // honest §16.3 meta flips to a typed ERROR here so the audited
          // outcome matches the returned outcome exactly.
          const incomplete = validateEnvelopeCompleteness(ctx);
          if (incomplete !== null && !exited(ctx)) {
            internalErrorExit(ctx, 'RETURN_STRUCTURED_RESULT', new Error(incomplete));
          }
          await writeAuditAndTrace(ctx, { chain: o.auditChain });
        },
      ),
      RETURN_STRUCTURED_RESULT: guarded('RETURN_STRUCTURED_RESULT', (ctx) => {
        try {
          ctx.result = buildEnvelope(ctx);
        } catch (error) {
          // The guard below must never own stage 24 — a structured result is
          // returned even when assembly itself faults (post-audit).
          ctx.degradedMarkers.push('ENVELOPE_ASSEMBLY_FAULT');
          ctx.result = buildFallbackEnvelope(
            ctx,
            `ENVELOPE_ASSEMBLY_REFUSED:${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    };
  }
}
