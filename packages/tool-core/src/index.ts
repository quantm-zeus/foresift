// Package entrypoint — the Shared Tool Core (PRD §16): registry + exact
// 24-stage execution pipeline + result envelope, with quota/cost and license
// semantics behind stable dependency-injection seams implemented OUTSIDE this
// package (FR-CORE-001…008).
//
// COMPOSITION ROOT (T701): `createToolCore` wires the engine with deny-closed
// defaults for every perimeter seam left unbound — an uncomposed core refuses
// authentication, authorization, rights verification, AND egress by default,
// so nothing can slip through a half-wired composition. The quota/cost
// reservation adapter is deliberately REQUIRED: even its deny-closed double
// lives outside this package (tests/fixtures/core), so no cost semantics can
// ever accrete inside src/.

export { PipelineOrchestrator, RUNTIME_STAGE_SEQUENCE } from './pipeline.ts';
export type { PipelineHandlers, PipelineRunState, StageHandler } from './pipeline.ts';

export {
  computeExactCacheKey,
  assertExactOnlyCaching,
  type ExactCacheKey,
  type SensitiveDataClass,
} from './cache-key.ts';
export { FreshnessEvaluator } from './freshness.ts';
export type { FreshnessOutcome } from './freshness.ts';
export { SingleFlightManager, StaleFencingTokenError } from './single-flight.ts';
export type { LeaseHandle } from './single-flight.ts';
export {
  insertPendingReservation,
  reserveReservation,
  commitReservation,
  releaseReservation,
  expireReservation,
} from './quota-contract.ts';
export type {
  QuotaReservationAdapter,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaAdmissionDecision,
  ReservationRequest,
} from './quota-contract.ts';
export type { LicensePolicySource, LicenseQuery } from './license-contract.ts';
export { UnverifiableRightsRefusedSource } from './license-contract.ts';
export { ProhibitedCapabilityScreen, PROHIBITED_EXECUTION_REASON } from './prohibited.ts';
export type {
  ProhibitedRefusalEvent,
  ProhibitedRefusalSink,
  ScreenVerdict,
  ScreenedDefinitionText,
} from './prohibited.ts';
export { ToolCoreRegistry } from './registry.ts';
export type {
  RegisteredTool,
  RegistryEntry,
  RegistrySnapshot,
  ToolCoreRegistryOptions,
} from './registry.ts';
export { ToolCoreEngine } from './engine.ts';
export type { ToolCoreEngineOptions, ToolCallExecutionResult } from './engine.ts';
export { CacheStageChain } from './stages/cache.ts';
export type { CachePolicy, CacheLookupResult } from './stages/cache.ts';
export type {
  AuthnPrimitive,
  AuthzPrimitive,
  AuthenticatedActor,
} from './stages/authn.ts';
export { DenyClosedAuthn, DenyClosedAuthz } from './stages/authn.ts';
export type { EgressGuardLike, NormalizedPayload } from './stages/dispatch.ts';
export { identityNormalizer, DispatchFailureError } from './stages/dispatch.ts';
export {
  createContext,
  block,
  exited,
  BLOCKED_ACQUISITION_STATES,
} from './run-context.ts';
export type {
  ToolCallContext,
  ToolCallRequest,
  AcquisitionDecision,
  StageExit,
} from './run-context.ts';
export {
  buildEnvelope,
  buildFallbackEnvelope,
  validateEnvelopeCompleteness,
  BLOCKED_QUALITY_CODE,
  INTERNAL_ERROR_QUALITY_CODE,
} from './envelope.ts';

import type { DatabaseEngine } from '@foresift/persistence';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import { AuditChain } from '@foresift/security';
import { UnverifiableRightsRefusedSource } from './license-contract.ts';
import { DenyClosedAuthn, DenyClosedAuthz } from './stages/authn.ts';
import { ToolCoreEngine, type ToolCoreEngineOptions } from './engine.ts';
import type { EgressGuardLike } from './stages/dispatch.ts';
import { ToolCoreRegistry } from './registry.ts';
import { CacheStageChain } from './stages/cache.ts';
import { SingleFlightManager } from './single-flight.ts';
import { FreshnessEvaluator } from './freshness.ts';
import { ProhibitedCapabilityScreen } from './prohibited.ts';

/** Composition inputs; only persistence and the quota adapter are required. */
export interface CreateToolCoreInput extends Partial<ToolCoreEngineOptions> {
  readonly engine: DatabaseEngine;
  readonly quota: ToolCoreEngineOptions['quota'];
  readonly clock?: () => string;
}

/**
 * THE composition root. Deny-closed defaults:
 *
 *   - authn/authz      → refuse everything until the security perimeter binds;
 *   - license source   → rights unverifiable ⇒ refused (no allow path);
 *   - egress guard     → denies every external endpoint on every plane;
 *   - audit chain      → built over the SAME database engine when not injected.
 */
export function createToolCore(input: CreateToolCoreInput): ToolCoreEngine {
  const rawClock = input.clock ?? (() => new Date().toISOString());
  const now = (): UtcTimestamp => utcTimestamp(rawClock());

  const denyAllEgress: EgressGuardLike = {
    async authorize(url: string, plane: string) {
      return {
        allowed: false,
        reason: `EGRESS_UNBOUND:no egress enforcer composed; refusing ${plane} egress to ${url}`,
      };
    },
  };

  return new ToolCoreEngine({
    engine: input.engine,
    registry:
      input.registry ??
      new ToolCoreRegistry({
        engine: input.engine,
        screen: input.screen ?? new ProhibitedCapabilityScreen(),
        now,
      }),
    auditChain: input.auditChain ?? new AuditChain({ engine: input.engine }),
    authn: input.authn ?? new DenyClosedAuthn(),
    authz: input.authz ?? new DenyClosedAuthz(),
    licenseSource: input.licenseSource ?? new UnverifiableRightsRefusedSource(),
    quota: input.quota,
    cacheChain:
      input.cacheChain ??
      new CacheStageChain({
        engine: input.engine,
        evaluator: new FreshnessEvaluator(),
        now,
      }),
    singleFlight:
      input.singleFlight ??
      new SingleFlightManager({
        engine: input.engine,
        now,
      }),
    screen: input.screen ?? new ProhibitedCapabilityScreen(),
    egress: input.egress ?? denyAllEgress,
    now,
    ...(input.deadlineMs !== undefined ? { deadlineMs: input.deadlineMs } : {}),
    ...(input.maxResponseBytes !== undefined
      ? { maxResponseBytes: input.maxResponseBytes }
      : {}),
    ...(input.cachingPermitted !== undefined
      ? { cachingPermitted: input.cachingPermitted }
      : {}),
    ...(input.resolveContentType !== undefined
      ? { resolveContentType: input.resolveContentType }
      : {}),
    ...(input.normalize !== undefined ? { normalize: input.normalize } : {}),
    ...(input.leaseWaitDeadlineMs !== undefined
      ? { leaseWaitDeadlineMs: input.leaseWaitDeadlineMs }
      : {}),
    ...(input.leaseTtlSeconds !== undefined
      ? { leaseTtlSeconds: input.leaseTtlSeconds }
      : {}),
  });
}
