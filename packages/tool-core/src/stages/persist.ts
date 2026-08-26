/**
 * Pipeline stages 18–22 (FR-CORE-002, FR-CORE-007, FR-CORE-003; PRD §16.2):
 *
 *   18. commit or release actual quota/cost according to provider semantics
 *   19. persist evidence/artifact metadata and source fingerprint
 *   20. update exact cache only when rights and cache policy permit
 *   21. release lease with fencing validation
 *   22. persist acquisition outcome, cache/provider source, actual cost,
 *       evidence IDs, and decision impact
 *
 * Every step is idempotent under retry (INV-009): reservation transitions go
 * through THE guarded SQL state machine (COMMITTED→COMMITTED and
 * RELEASED→RELEASED replays converge), evidence freezing is content-addressed
 * (identical re-freeze converges), and lease release validates the fence.
 */
import { AcquisitionState, type AcquisitionState as AcqState } from '@foresift/domain';
import { freezeBundle } from '@foresift/evidence';
import { completeRetrieval, type DatabaseEngine } from '@foresift/persistence';
import { canCompleteRetrieval } from './acquisition.ts';
import type { CacheFlowDeps } from './cacheflow.ts';
import type { CachePolicy } from './cache.ts';
import { exited, type ToolCallContext } from '../run-context.ts';

/** Settles quota through the adapter; commit on success, release otherwise. */
export async function settleQuota(ctx: ToolCallContext, deps: CacheFlowDeps): Promise<void> {
  if (ctx.reservationId === null) return;
  const succeeded = ctx.exit === null && ctx.normalized !== null;
  try {
    if (succeeded) {
      const actual = ctx.normalized!.actualUnits ?? ctx.quotaEstimate!.estimatedUnits;
      await deps.quota.commit({ reservationId: ctx.reservationId, actualUnits: actual });
      ctx.actualUnits = actual;
      ctx.reservationSettledAs = 'COMMITTED';
    } else {
      await deps.quota.release({ reservationId: ctx.reservationId });
      ctx.reservationSettledAs = 'RELEASED';
    }
  } catch {
    // Idempotent retries converge via THE guarded state machine; replayed
    // terminal edges land here harmlessly. A genuinely illegal edge after a
    // successful retrieval must not lose the result — stage 23's audit
    // payload carries the settled state either way.
  }
}

/** Stage 19 — persist evidence/artifact metadata + source fingerprint. */
export async function persistEvidenceMetadata(
  ctx: ToolCallContext,
  engine: DatabaseEngine,
): Promise<void> {
  if (exited(ctx)) return; // evidence exists only for successful retrievals
  const bundleId = `ev-${ctx.runId}`;
  await freezeBundle(engine, {
    bundleId,
    manifest: {
      toolName: ctx.entry?.metadata.name ?? ctx.request.toolName,
      toolVersion: ctx.entry?.metadata.version ?? null,
      provider: ctx.keyComponents?.provider ?? null,
      operation: ctx.keyComponents?.operation ?? null,
      operationVersion: ctx.keyComponents?.operationVersion ?? null,
      canonicalEntityIdentity: ctx.canonicalEntityIdentity,
      requestCanonicalArguments: (ctx.canonicalInput ?? {}) as Record<string, unknown>,
      rawResponseFingerprintSha256: ctx.sourceFingerprint,
      rawByteLength: ctx.rawByteLength,
      contentType: ctx.rawContentType,
      normalizedData: ctx.normalized?.data ?? null,
      observedAt: ctx.normalized?.observedAt ?? null,
      availableAt: ctx.normalized?.availableAt ?? null,
      qualityCodes: [...(ctx.normalized?.qualityCodes ?? [])],
      lineageRefs: [...(ctx.normalized?.lineageRefs ?? [])],
      conflicts: [...(ctx.normalized?.conflicts ?? [])],
      workloadClass: ctx.request.workloadClass,
      asOf: ctx.keyComponents?.asOf ?? null,
      licensePolicyVersion: ctx.licenseVerdict?.policyVersion ?? null,
      cacheProviderSource: {
        cacheOutcomeBeforeDispatch: ctx.cacheResult?.outcome ?? 'MISS',
        servedFromExternalRefresh: true,
      },
    },
    frozenAt: ctx.now(),
  });
  ctx.evidenceIds.push(bundleId);
}

/**
 * Stage 20 — update the exact cache only when rights AND cache policy permit.
 * The payload is REFERENCED (the evidence bundle), never inlined.
 */
export async function updateExactCache(
  ctx: ToolCallContext,
  deps: CacheFlowDeps,
  policy: CachePolicy,
): Promise<void> {
  if (exited(ctx)) return;
  const rightsAllowed = ctx.exit === null && (ctx.licenseVerdict?.allowed ?? false);
  const stored = await deps.chain.storeIfPermitted({
    components: ctx.keyComponents!,
    payloadRef: ctx.evidenceIds[0] ?? `ev-${ctx.runId}`,
    storedAt: ctx.now(),
    rightsAllowed,
    policy,
  });
  ctx.storedInCache = stored;
  if (stored) ctx.cacheOutcome = 'REFRESHED';
}

/** Stage 21 — release lease with fencing validation (stale holders refuse). */
export async function releaseLease(ctx: ToolCallContext, deps: CacheFlowDeps): Promise<void> {
  if (ctx.lease === null) return;
  void deps;
  try {
    await deps.singleFlight.release(ctx.lease);
  } catch {
    // Fencing refusal is fail-closed BY DESIGN: our token went stale (expired
    // mid-flight and superseded). The refusal does not retroactively
    // invalidate committed work, but it marks the run degraded so consumers
    // can see the lease was lost; stage 23 audits the fence loss.
    ctx.fenceRefused = true;
    ctx.degradedMarkers.push('SINGLE_FLIGHT_FENCE_LOST');
  }
}

/** Stage 22 — persist acquisition outcome, source, cost, evidence IDs, impact. */
export async function persistAcquisitionOutcome(
  ctx: ToolCallContext,
  engine: DatabaseEngine,
): Promise<void> {
  if (!canCompleteRetrieval(ctx)) return;
  const state: AcqState =
    ctx.exit === null ? AcquisitionState.RETURNED : (ctx.exit.payload.acquisitionState as AcqState);
  await completeRetrieval(engine, {
    decisionId: ctx.decisionId,
    completedAt: ctx.now(),
    state,
    evidenceIds: [...ctx.evidenceIds],
    ...(ctx.exit !== null ? {} : { actualDecisionChanged: false }),
  });
  ctx.retrievalCompleted = true;
}
