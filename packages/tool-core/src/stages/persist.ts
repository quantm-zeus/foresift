/**
 * Pipeline stages 18–22 (FR-CORE-002, FR-CORE-007; PRD §16.2): commit or
 * release the actual quota/cost through the adapter per provider semantics;
 * persist evidence/artifact metadata + source fingerprint; update the exact
 * cache only when rights AND policy permit; release the single-flight lease
 * with fencing validation; complete the acquisition outcome with source,
 * cost, evidence ids, and decision impact.
 *
 * Every step here is IDEMPOTENT under retry (INV-009): reservation
 * settlement converges on terminal states, evidence writes dedupe by content,
 * lease release refuses stale tokens loudly but never corrupts, and retrieval
 * completion treats an already-completed decision as converged.
 */
import { AcquisitionState, ForesiftError } from '@foresift/domain';
import type { UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { canonicalJson, completeRetrieval } from '@foresift/persistence';
import type { ObjectStoreAdapter } from '@foresift/object-store';
import { freezeBundle } from '@foresift/evidence';
import type { QuotaReservationAdapter } from '../quota-contract.ts';
import type { CacheStageChain } from './cache.ts';
import { SingleFlightManager, StaleFencingTokenError } from '../single-flight.ts';
import type { ToolRunContext } from '../run-context.ts';
import type { NormalizedResult } from '../provider-contract.ts';
import { block } from './authn.ts';

export interface PersistStageDeps {
  readonly engine: DatabaseEngine;
  readonly quotaAdapter: QuotaReservationAdapter | undefined;
  readonly objectStore: ObjectStoreAdapter | undefined;
  readonly cacheChain: CacheStageChain;
  readonly singleFlight: SingleFlightManager;
  readonly now: () => UtcTimestamp;
}

async function materializeCachedResult(deps: PersistStageDeps, ctx: ToolRunContext): Promise<void> {
  if (!ctx.servedFromCache || ctx.result !== undefined) return;
  if (deps.objectStore === undefined || ctx.cachedPayloadRef === undefined) {
    block(
      ctx,
      'INVALID_RESPONSE',
      'CACHE_PAYLOAD_UNAVAILABLE: cache hit cannot be materialized',
      'PERSIST_OUTCOME',
    );
    return;
  }
  const found = await deps.objectStore.get({ contentHash: ctx.cachedPayloadRef });
  if (found === null) {
    block(
      ctx,
      'INVALID_RESPONSE',
      `CACHE_PAYLOAD_MISSING: ${ctx.cachedPayloadRef}`,
      'PERSIST_OUTCOME',
    );
    return;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(found.bytes)) as NormalizedResult;
    ctx.result = {
      observations: parsed.observations ?? [],
      conflicts: parsed.conflicts ?? [],
      partial: parsed.partial ?? false,
      missingCapabilities: parsed.missingCapabilities ?? [],
      ...(parsed.nextCursor !== undefined ? { nextCursor: parsed.nextCursor } : {}),
      ...(parsed.resourceUris !== undefined ? { resourceUris: parsed.resourceUris } : {}),
    };
    ctx.evidenceIds = ctx.result.observations.map((observation) => observation.evidenceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    block(ctx, 'INVALID_RESPONSE', `CACHE_PAYLOAD_INVALID: ${message}`, 'PERSIST_OUTCOME');
  }
}

/**
 * Idempotent commit: COMMITTED→COMMITTED is a legal retry replay — a guarded
 * UPDATE that matches zero rows because the row ALREADY carries our terminal
 * state converges silently; any other refusal propagates.
 */
export async function commitSettled(
  engine: DatabaseEngine,
  adapter: QuotaReservationAdapter | undefined,
  request: { readonly reservationId: string; readonly actualUnits: number },
): Promise<void> {
  try {
    await adapter?.commit(request);
    return;
  } catch (error) {
    if (!(error instanceof ForesiftError)) throw error;
    // Fall through to state inspection: maybe a prior attempt already committed.
  }
  await assertTerminalState(engine, request.reservationId, 'COMMITTED');
}

/** Idempotent release, mirroring commitSettled for RELEASED. */
export async function releaseSettled(
  engine: DatabaseEngine,
  adapter: QuotaReservationAdapter | undefined,
  request: { readonly reservationId: string },
): Promise<void> {
  try {
    await adapter?.release(request);
    return;
  } catch (error) {
    if (!(error instanceof ForesiftError)) throw error;
  }
  await assertTerminalState(engine, request.reservationId, 'RELEASED');
}

async function assertTerminalState(
  engine: DatabaseEngine,
  reservationId: string,
  expected: 'COMMITTED' | 'RELEASED',
): Promise<void> {
  const rows = await engine.query<{ state: string; actual_units: string | null }>(
    'SELECT state, actual_units FROM core.core_quota_reservations WHERE reservation_id = $1',
    [reservationId],
  );
  const row = rows.rows[0];
  if (row === undefined || row.state !== expected) {
    throw new ForesiftError(
      'QUOTA_RESERVATION_TRANSITION_ILLEGAL',
      `settlement retry found reservation ${reservationId} in ${row?.state ?? '<missing>'}, not ${expected}`,
      { reservationId },
    );
  }
}

/** Stage 18 — COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST. */
export function makeQuotaSettleStage(deps: PersistStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.reservationId === undefined) return; // nothing reserved — cache hit or earlier block
    const succeeded = !ctx.blocked && ctx.result !== undefined;
    if (succeeded) {
      const providerActual = ctx.rawResponse?.actualUnits;
      const actualUnits =
        providerActual !== undefined && Number.isFinite(providerActual) && providerActual >= 0
          ? providerActual
          : (ctx.estimate?.estimatedUnits ?? 0);
      await commitSettled(deps.engine, deps.quotaAdapter, {
        reservationId: ctx.reservationId,
        actualUnits,
      });
      ctx.committedUnits = actualUnits;
      ctx.quotaState = 'COMMITTED';
      ctx.cacheOutcome ??= 'REFRESHED';
    } else {
      await releaseSettled(deps.engine, deps.quotaAdapter, {
        reservationId: ctx.reservationId,
      });
      ctx.quotaState = 'RELEASED';
    }
  };
}

/** Stage 19 — PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT. */
export function makeEvidenceStage(deps: PersistStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.servedFromCache || ctx.blocked || ctx.result === undefined) return;
    ctx.evidenceIds = ctx.result.observations.map((observation) => observation.evidenceId);
    if (deps.objectStore === undefined) {
      // Deny-closed degradation: without an evidence store nothing is
      // silently dropped — the envelope marks the gap explicitly.
      ctx.result = {
        ...ctx.result,
        partial: true,
        missingCapabilities: [...ctx.result.missingCapabilities, 'EVIDENCE_STORE'],
      };
    } else {
      for (const [index, observation] of ctx.result.observations.entries()) {
        const artifactId = `evidence-${ctx.runId}-${String(index)}`;
        const stored = await deps.objectStore.put({
          artifactId,
          bytes: new TextEncoder().encode(
            canonicalJson(observation as unknown as Record<string, unknown>),
          ),
          metadata: {
            contentType: 'application/json',
            compression: 'NONE',
            encryptionStatus: 'PLAINTEXT',
            rightsRef: ctx.licenseVerdict?.policyVersion ?? null,
            retentionClass: 'EVIDENCE_PERMANENT',
            tenantId: ctx.request.tenantId,
            availabilityClass: 'DECISION_EVIDENCE',
          },
        });
        ctx.artifactIds.push(stored.artifactId);
      }
    }

    // Freeze the reconstruction manifest in SQL even when the physical
    // object store is unavailable. It binds source fingerprint, artifacts,
    // evidence identities, operation version, and actual usage immutably.
    await freezeBundle(deps.engine, {
      bundleId: `tool-run-${ctx.runId}`,
      manifest: {
        runId: ctx.runId,
        toolName: ctx.request.toolName,
        toolVersion: ctx.registryEntryVersion ?? ctx.request.toolVersion ?? 'unknown',
        provider: ctx.route?.provider ?? null,
        operation: ctx.route?.operation ?? null,
        operationVersion: ctx.route?.operationVersion ?? null,
        sourceFingerprint: ctx.sourceFingerprint ?? null,
        evidenceIds: [...ctx.evidenceIds],
        artifactIds: [...ctx.artifactIds],
        licensePolicyVersion: ctx.licenseVerdict?.policyVersion ?? null,
        estimatedUnits: ctx.estimate?.estimatedUnits ?? null,
        actualUnits: ctx.committedUnits ?? null,
      },
      frozenAt: deps.now(),
    });
  };
}

/** Stage 20 — UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT. */
export function makeCacheUpdateStage(deps: PersistStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.servedFromCache || ctx.blocked || ctx.result === undefined) return;
    if (deps.objectStore === undefined || ctx.evidenceIds.length === 0) return;
    const route = ctx.route!;
    // The cache payload is the COMPLETE normalized result (every observation,
    // conflicts, degradation truth) so a later hit reproduces the full
    // answer, not just its first evidence artifact.
    const stored = await deps.objectStore.put({
      artifactId: `payload-${ctx.runId}`,
      bytes: new TextEncoder().encode(
        canonicalJson(ctx.result as unknown as Record<string, unknown>),
      ),
      metadata: {
        contentType: 'application/json',
        compression: 'NONE',
        encryptionStatus: 'PLAINTEXT',
        rightsRef: ctx.licenseVerdict?.policyVersion ?? null,
        retentionClass: 'CACHE_DERIVED',
        tenantId: ctx.request.tenantId,
        availabilityClass: 'DERIVED_CACHE',
      },
    });
    await deps.cacheChain.storeIfPermitted({
      components: ctx.cacheComponents!,
      // Content hash, not artifact id: ObjectStoreAdapter reads back BY HASH.
      payloadRef: stored.contentHash,
      storedAt: ctx.result.observations[0]?.fetchedAt ?? deps.now(),
      rightsAllowed: ctx.licenseVerdict?.allowed === true,
      policy: { cachingPermitted: route.cachingPermitted },
    });
  };
}

/**
 * Stage 21 — RELEASE_LEASE_WITH_FENCING_VALIDATION. A stale token refuses
 * LOUDLY: the typed StaleFencingTokenError is recorded in the run journal and
 * the lease is left for its new holder — but it never rolls back the
 * already-persisted result or crashes the post-settle stages.
 */
export function makeLeaseReleaseStage(deps: PersistStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.lease === undefined || ctx.leaseReleased) return;
    try {
      await deps.singleFlight.release(ctx.lease);
      ctx.leaseReleased = true;
    } catch (error) {
      if (error instanceof StaleFencingTokenError) {
        ctx.journal.push({
          stage: 'RELEASE_LEASE_WITH_FENCING_VALIDATION',
          at: deps.now(),
          note: `STALE_FENCING_TOKEN: ${error.message}`,
        });
        return;
      }
      throw error;
    }
  };
}

/** Stage 22 — PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT. */
export function makeAcquisitionOutcomeStage(deps: PersistStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.acquisitionDecisionId === undefined) return;
    await materializeCachedResult(deps, ctx);

    // Pre-execution blocks were persisted as their own state at stage 5 and
    // have no retrieval lifecycle to complete.
    if (
      ctx.blocked?.state === AcquisitionState.NOT_REQUESTED_BY_POLICY ||
      (ctx.blocked !== undefined && ctx.requestedAtPersisted !== true)
    ) {
      return;
    }
    if (ctx.requestedAtPersisted !== true) return;

    const outcome: AcquisitionState = ctx.blocked
      ? (ctx.blocked.state as AcquisitionState)
      : AcquisitionState.RETURNED;
    try {
      await completeRetrieval(deps.engine, {
        decisionId: ctx.acquisitionDecisionId,
        completedAt: deps.now(),
        state: outcome,
        ...(outcome === AcquisitionState.RETURNED ? { evidenceIds: ctx.evidenceIds } : {}),
        ...(outcome === AcquisitionState.RETURNED ? { actualDecisionChanged: false } : {}),
      });
    } catch (error) {
      // Retry convergence: an immutable completed decision IS the outcome.
      if (error instanceof ForesiftError && /already completed/.test(error.message)) return;
      throw error;
    }
    ctx.outcomeState = outcome;
  };
}
