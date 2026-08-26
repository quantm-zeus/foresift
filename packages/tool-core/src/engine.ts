/**
 * THE Shared Tool Core engine (FR-CORE-002; PRD §16). Binds the exact
 * 24-stage orchestrator to per-run contexts and guarantees that EVERY run —
 * success, blocked exit, or unexpected internal failure — still receives its
 * audit entry (stage 23) and structured envelope (stage 24).
 *
 * Composition is deny-closed by construction: an unbound quota adapter,
 * egress guard, authorization primitive, or license source refuses work at
 * the exact stage that needs it (COST_BLOCKED / PROVIDER_UNAVAILABLE /
 * RIGHTS_BLOCKED), never improvises an allow. The audit chain is the one
 * REQUIRED binding — a tool core without an audit sink must not exist,
 * because every exit must be auditable.
 */
import type { UtcTimestamp, PipelineStage, ActionClass } from '@foresift/domain';
import { isAdmissibleActionClass } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type { AuditChain } from '@foresift/security';
import type { ObjectStoreAdapter } from '@foresift/object-store';
import type { ToolResultEnvelope } from '@foresift/shared-schemas';
import {
  DenyClosedAuthn,
  DenyClosedAuthz,
  block,
  makeAuthenticateStage,
  makeAuthorizeStage,
  type AuthnPrimitive,
  type AuthzPrimitive,
} from './stages/authn.ts';
import {
  makeDecisionStage,
  makeValidateInputStage,
  type DecisionStageDeps,
} from './stages/validate.ts';
import { makePersistRequestedStage } from './stages/acquisition.ts';
import {
  makeCacheKeyStage,
  makeCacheLookupStages,
  makeLeaseAcquireStage,
  makePostLeaseRecheckStage,
} from './stages/cache-stages.ts';
import {
  makeQuotaEstimateStage,
  makeQuotaReserveStage,
  type BackpressurePolicy,
} from './stages/quota.ts';
import {
  classifyDispatchFailure,
  makeDispatchStage,
  makeNormalizeStage,
  makeNormalizedValidateStage,
  makeRawValidateStage,
  type EgressAuthorizer,
  type ExecutionGate,
} from './stages/dispatch.ts';
import {
  makeAcquisitionOutcomeStage,
  makeCacheUpdateStage,
  makeEvidenceStage,
  makeLeaseReleaseStage,
  makeQuotaSettleStage,
} from './stages/persist.ts';
import { SingleFlightManager } from './single-flight.ts';
import { makeAuditStage } from './stages/audit.ts';
import { makeEnvelopeStage } from './envelope.ts';
import { PipelineOrchestrator, RUNTIME_STAGE_SEQUENCE } from './pipeline.ts';
import { CacheStageChain } from './stages/cache.ts';
import { FreshnessEvaluator } from './freshness.ts';
import { ProhibitedCapabilityScreen } from './prohibited.ts';
import { ToolCoreRegistry } from './registry.ts';
import { UnverifiableRightsRefusedSource, type LicensePolicySource } from './license-contract.ts';
import type { QuotaReservationAdapter } from './quota-contract.ts';
import type { OperationRoute } from './provider-contract.ts';
import {
  newToolRunContext,
  type ToolExecutionRequest,
  type ToolRunContext,
} from './run-context.ts';

/** Binds one operation route to the tool (all versions when no version given). */
export interface ToolRouteBinding {
  readonly toolName: string;
  readonly toolVersion?: string | undefined;
  readonly route: OperationRoute;
}

export interface ToolCoreConfig {
  /** Persistence engine over a database with the g0 migrations applied. */
  readonly engine: DatabaseEngine;
  /**
   * REQUIRED tamper-evident audit sink. There is no default: a pipeline that
   * cannot guarantee an audit entry for every exit must refuse to compose.
   */
  readonly auditChain: AuditChain;
  /** Unbound ⇒ every dispatch exits PROVIDER_UNAVAILABLE (EGRESS_UNCONFIGURED). */
  readonly egressGuard?: EgressAuthorizer | undefined;
  /** Unbound ⇒ DenyClosedAuthn/DenyClosedAuthz refuse every actor. */
  readonly authn?: AuthnPrimitive | undefined;
  readonly authz?: AuthzPrimitive | undefined;
  /** Unbound ⇒ COST_BLOCKED for every non-cached execution. */
  readonly quotaAdapter?: QuotaReservationAdapter | undefined;
  /** Unbound ⇒ rights are unverifiable and every call is refused. */
  readonly licenseSource?: LicensePolicySource | undefined;
  /** Unbound ⇒ explicit EVIDENCE_STORE degradation; cache never stores. */
  readonly objectStore?: ObjectStoreAdapter | undefined;
  /** Operation routes bound to registered tools. */
  readonly routes?: readonly ToolRouteBinding[] | undefined;
  /** §16.8 backpressure resolution; defaults to QUOTA_EXHAUSTED exits. */
  readonly backpressurePolicy?: BackpressurePolicy | undefined;
  /** Deterministic probe assignment override (AC-243 lifecycle). */
  readonly probeAssignment?: Parameters<typeof makePersistRequestedStage>[0]['probeAssignment'];
  /** Policy version stamped on persisted acquisition decisions. */
  readonly policyVersion?: string | undefined;
  /** Deterministic acquisition policy; may only choose REQUESTED/not-requested. */
  readonly acquisitionPolicy?: DecisionStageDeps['acquisitionPolicy'];
  /** Lease QUEUE wait cadence (tests shrink this). */
  readonly leaseWaitPollMs?: number | undefined;
  /**
   * Read-only per-run observer invoked just before the envelope returns —
   * conformance suites assert on the journal/audit record without touching
   * product behavior.
   */
  readonly observeRun?: (ctx: Readonly<ToolRunContext>) => void;
  /** Injected clock. */
  readonly now?: () => UtcTimestamp;
}

export interface ToolCore {
  /** The immutable registry this composition registers tools into. */
  readonly registry: ToolCoreRegistry;
  /** THE pinned §16.2 runtime sequence (introspection/tests). */
  readonly stageSequence: readonly PipelineStage[];
  /** Execute one logical tool call through all 24 stages. */
  execute(request: ToolExecutionRequest): Promise<ToolResultEnvelope>;
}

function routeFor(
  bindings: readonly ToolRouteBinding[],
  request: ToolExecutionRequest,
): OperationRoute | undefined {
  const exact = bindings.find(
    (b) => b.toolName === request.toolName && b.toolVersion === request.toolVersion,
  );
  if (exact !== undefined) return exact.route;
  // Versionless bindings apply to any version of the tool.
  return bindings.find((b) => b.toolName === request.toolName && b.toolVersion === undefined)
    ?.route;
}

/** First stage of THE sequence that never completed — the failure point. */
function failedStageOf(ctx: ToolRunContext): PipelineStage {
  const reached = new Set(ctx.journal.map((entry) => entry.stage));
  return RUNTIME_STAGE_SEQUENCE.find((stage) => !reached.has(stage)) ?? 'RETURN_STRUCTURED_RESULT';
}

/**
 * Build THE composition root. Construction performs no I/O; database access
 * begins on first register/execute.
 */
export function createToolCore(config: ToolCoreConfig): ToolCore {
  if (config.auditChain === undefined) {
    // Runtime backstop beside the type-level requirement: no audit sink, no
    // tool core — every exit must be auditable before anything can run.
    throw new Error(
      'createToolCore requires an auditChain: unauditable pipelines refuse to compose',
    );
  }
  const now = config.now ?? (() => new Date().toISOString() as UtcTimestamp);

  const registry = new ToolCoreRegistry({
    engine: config.engine,
    now,
    refusalSink: {
      async recordProhibitedRefusal(event) {
        await config.auditChain.append({
          occurredAt: event.at as UtcTimestamp,
          actor: 'tool-core-registry',
          actionClass: 'BLOCKED_OPERATION',
          subject: `${event.toolName}@${event.toolVersion}`,
          payload: {
            event: 'tool.registration.refused',
            toolName: event.toolName,
            toolVersion: event.toolVersion,
            reasons: [...event.reasons],
            findingCount: event.findings.length,
          },
        });
      },
    },
  });

  const authn = config.authn ?? new DenyClosedAuthn();
  const authz = config.authz ?? new DenyClosedAuthz();
  const licenseSource = config.licenseSource ?? new UnverifiableRightsRefusedSource();
  const routes = config.routes ?? [];

  const singleFlight = new SingleFlightManager({ engine: config.engine, now });
  const cacheChain = new CacheStageChain({
    engine: config.engine,
    evaluator: new FreshnessEvaluator(),
    now,
    resolveFamily: (components) =>
      routes.find(
        (b) =>
          b.route.provider === components.provider && b.route.operation === components.operation,
      )?.route.freshnessFamily ?? 'metadata',
  });

  // T609 gate: the SAME prohibited screen used at registration re-classifies
  // the resolved operation identity text on EVERY dispatch.
  const screen = new ProhibitedCapabilityScreen();
  const executionGate: ExecutionGate = (input) => {
    let inputSchemaJson: unknown = {};
    try {
      inputSchemaJson = JSON.parse(input.schemaJsonText);
    } catch {
      inputSchemaJson = {};
    }
    const verdict = screen.screenWithReport(
      {
        name: input.toolName,
        description: input.descriptionText,
        inputSchemaJson,
        outputSchemaJson: {},
        actionClass:
          input.actionClass !== undefined &&
          isAdmissibleActionClass(input.actionClass as ActionClass)
            ? (input.actionClass as ActionClass)
            : 'PROHIBITED_FINANCIAL',
        toolVersion: input.toolVersion,
      },
      now(),
    );
    if (verdict.ok) return [];
    return [...verdict.event.reasons];
  };

  const cacheDeps = {
    chain: cacheChain,
    singleFlight,
    now,
    ...(config.leaseWaitPollMs !== undefined ? { leaseWaitPollMs: config.leaseWaitPollMs } : {}),
  };
  const lookups = makeCacheLookupStages(cacheDeps);

  const persistDeps = {
    engine: config.engine,
    quotaAdapter: config.quotaAdapter,
    objectStore: config.objectStore,
    cacheChain,
    singleFlight,
    now,
  };

  // Stage factories bound once; only the context varies per run.
  const boundStages = {
    authenticate: makeAuthenticateStage({ registry, authn, authz }),
    decide: makeDecisionStage({
      ...(config.acquisitionPolicy !== undefined
        ? { acquisitionPolicy: config.acquisitionPolicy }
        : {}),
    }),
    persistRequested: makePersistRequestedStage({
      engine: config.engine,
      policyVersion: config.policyVersion ?? 'tool-core-default-1',
      ...(config.probeAssignment !== undefined ? { probeAssignment: config.probeAssignment } : {}),
      now,
    }),
    cacheKey: makeCacheKeyStage(cacheDeps),
    memo: lookups.memoStage,
    fresh: lookups.freshStage,
    stale: lookups.staleStage,
    leaseAcquire: makeLeaseAcquireStage(cacheDeps),
    postLeaseRecheck: makePostLeaseRecheckStage(cacheDeps),
    quotaEstimate: makeQuotaEstimateStage({
      quotaAdapter: config.quotaAdapter,
      ...(config.backpressurePolicy !== undefined
        ? { backpressurePolicy: config.backpressurePolicy }
        : {}),
    }),
    quotaReserve: makeQuotaReserveStage({ quotaAdapter: config.quotaAdapter }),
    dispatch: makeDispatchStage({ egressGuard: config.egressGuard, executionGate, now }),
    rawValidate: makeRawValidateStage(),
    normalize: makeNormalizeStage({ now }),
    normalizedValidate: makeNormalizedValidateStage({ now }),
    quotaSettle: makeQuotaSettleStage(persistDeps),
    evidence: makeEvidenceStage(persistDeps),
    cacheUpdate: makeCacheUpdateStage(persistDeps),
    leaseRelease: makeLeaseReleaseStage(persistDeps),
    outcome: makeAcquisitionOutcomeStage(persistDeps),
    audit: makeAuditStage({ auditChain: config.auditChain, now }),
    envelope: makeEnvelopeStage({
      now,
      ...(config.objectStore !== undefined ? { objectStore: config.objectStore } : {}),
    }),
  };

  return {
    registry,
    stageSequence: RUNTIME_STAGE_SEQUENCE,
    async execute(request: ToolExecutionRequest): Promise<ToolResultEnvelope> {
      const ctx = newToolRunContext(request, now());

      const record =
        (stage: PipelineStage, fn: (c: ToolRunContext) => Promise<void> | void) =>
        async (): Promise<void> => {
          await fn(ctx);
          ctx.journal.push({ stage, at: now() });
        };

      const orchestrator = new PipelineOrchestrator({
        AUTHENTICATE_ACTOR: record('AUTHENTICATE_ACTOR', boundStages.authenticate),
        AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS: record(
          'AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS',
          makeAuthorizeStage({
            registry,
            authn,
            authz,
            licenseSource,
            resolveRoute: () => routeFor(routes, ctx.request),
          }),
        ),
        VALIDATE_AND_CANONICALIZE_INPUT: record(
          'VALIDATE_AND_CANONICALIZE_INPUT',
          makeValidateInputStage({
            inputSchemaJsonOf: (c) =>
              registry.resolve(c.request.toolName, c.request.toolVersion)?.metadata.inputSchemaJson,
          }),
        ),
        VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE: record(
          'VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE',
          boundStages.decide,
        ),
        PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE: record(
          'PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE',
          boundStages.persistRequested,
        ),
        CALCULATE_EXACT_CACHE_KEY: record('CALCULATE_EXACT_CACHE_KEY', boundStages.cacheKey),
        CHECK_REQUEST_LOCAL_MEMOIZATION: record(
          'CHECK_REQUEST_LOCAL_MEMOIZATION',
          boundStages.memo,
        ),
        CHECK_FRESH_CACHE: record('CHECK_FRESH_CACHE', boundStages.fresh),
        CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED: record(
          'CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED',
          boundStages.stale,
        ),
        ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE: record(
          'ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE',
          boundStages.leaseAcquire,
        ),
        RECHECK_CACHE_AFTER_LEASE: record(
          'RECHECK_CACHE_AFTER_LEASE',
          boundStages.postLeaseRecheck,
        ),
        ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION: record(
          'ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION',
          boundStages.quotaEstimate,
        ),
        ATOMICALLY_RESERVE_QUOTA: record('ATOMICALLY_RESERVE_QUOTA', boundStages.quotaReserve),
        CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION: record(
          'CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION',
          boundStages.dispatch,
        ),
        VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA: record(
          'VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA',
          boundStages.rawValidate,
        ),
        NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY: record(
          'NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY',
          boundStages.normalize,
        ),
        VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS: record(
          'VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS',
          boundStages.normalizedValidate,
        ),
        COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST: record(
          'COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST',
          boundStages.quotaSettle,
        ),
        PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT: record(
          'PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT',
          boundStages.evidence,
        ),
        UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT: record(
          'UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT',
          boundStages.cacheUpdate,
        ),
        RELEASE_LEASE_WITH_FENCING_VALIDATION: record(
          'RELEASE_LEASE_WITH_FENCING_VALIDATION',
          boundStages.leaseRelease,
        ),
        PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT: record(
          'PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT',
          boundStages.outcome,
        ),
        WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT: record(
          'WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT',
          boundStages.audit,
        ),
        RETURN_STRUCTURED_RESULT: record('RETURN_STRUCTURED_RESULT', boundStages.envelope),
      });

      try {
        await orchestrator.run(ctx.runId);
      } catch (error) {
        // Unexpected internal failure: convert to a typed blocked exit so the
        // settle/audit/envelope duties below ALWAYS complete. The classifier
        // keeps dispatch-origin precision (deadline/egress/adapter); the
        // failing stage id and the raw message land in the journal either way.
        if (!ctx.blocked) {
          const failedStage = failedStageOf(ctx);
          const message = error instanceof Error ? error.message : String(error);
          const classified = classifyDispatchFailure(error);
          block(ctx, classified.state, classified.reason, failedStage);
          ctx.journal.push({ stage: failedStage, at: now(), note: `UNEXPECTED_ERROR: ${message}` });
        }

        // Preserve the mandatory settle/persist/release/outcome tail even
        // when a stage threw instead of returning a typed block. Each duty is
        // attempted independently so a cleanup refusal cannot hide the
        // original failure or strand the next cleanup obligation.
        const cleanupStages: readonly [PipelineStage, (c: ToolRunContext) => Promise<void>][] = [
          ['COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST', boundStages.quotaSettle],
          ['PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT', boundStages.evidence],
          ['UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT', boundStages.cacheUpdate],
          ['RELEASE_LEASE_WITH_FENCING_VALIDATION', boundStages.leaseRelease],
          ['PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT', boundStages.outcome],
        ];
        const alreadyReached = new Set(ctx.journal.map((entry) => entry.stage));
        for (const [stage, cleanup] of cleanupStages) {
          if (alreadyReached.has(stage)) continue;
          try {
            await cleanup(ctx);
            ctx.journal.push({ stage, at: now(), note: 'FAILURE_CLEANUP' });
          } catch (cleanupError) {
            const message =
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
            ctx.journal.push({ stage, at: now(), note: `CLEANUP_FAILED: ${message}` });
          }
        }
      }

      // Duties that must survive any earlier failure: audit first (fail-closed
      // — an audit sink failure propagates and the caller gets NOTHING), then
      // the schema-validated envelope.
      if (!ctx.audited) await boundStages.audit(ctx);
      if (!ctx.envelope) await boundStages.envelope(ctx);
      if (ctx.envelope === undefined) {
        throw new Error(`run ${ctx.runId} produced no envelope`);
      }
      config.observeRun?.(ctx);
      return ctx.envelope;
    },
  };
}
