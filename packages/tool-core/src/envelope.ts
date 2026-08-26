/**
 * Pipeline stage 24 (FR-CORE-003; PRD §16.2/§16.3): assemble THE structured
 * ToolResult envelope — the ONLY shape callers receive.
 *
 * Success envelopes carry merged observation provenance, preserved provider
 * conflicts, quality codes, the quota usage summary, and explicit partial /
 * degradation truth. Blocked exits carry a §16.2 BlockedStatePayload whose
 * acquisition state stays distinguishable (a policy choice is never rendered
 * as a retrieval failure) with meta.partial=true — never a fabricated result.
 *
 * Every envelope produced here is validated against the authoritative
 * shared schema before it leaves the pipeline; an assembly bug refuses
 * loudly instead of emitting a malformed contract.
 */
import type { CacheOutcome } from '@foresift/domain';
import type {
  BlockedStatePayload,
  ProviderConflictRef,
  QuotaModel,
  ReservationState,
  ToolResultEnvelope,
} from '@foresift/shared-schemas';
import { ToolResultEnvelopeSchema } from '@foresift/shared-schemas';
import type { ObjectStoreAdapter } from '@foresift/object-store';
import type { NormalizedResult } from './provider-contract.ts';
import type { ToolRunContext } from './run-context.ts';

export interface EnvelopeStageDeps {
  readonly now: () => string;
  /** Required to materialize cached payloads back into full results. */
  readonly objectStore?: ObjectStoreAdapter | undefined;
}

function minBy<T>(items: readonly T[], pick: (item: T) => string): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    const value = pick(item);
    if (value === undefined) continue;
    if (best === undefined || value < best) best = value;
  }
  return best;
}

function maxBy<T>(items: readonly T[], pick: (item: T) => string): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    const value = pick(item);
    if (value === undefined) continue;
    if (best === undefined || value > best) best = value;
  }
  return best;
}

/** Blocked-exit envelope: data IS the blocked-state payload, meta.partial=true. */
export function buildBlockedEnvelope(ctx: ToolRunContext, now: string): ToolResultEnvelope {
  const blocked = ctx.blocked!;
  const payload: BlockedStatePayload = {
    acquisitionState: blocked.state,
    machineReason: blocked.machineReason,
    toolName: ctx.request.toolName,
    toolVersion: ctx.registryEntryVersion ?? ctx.request.toolVersion ?? 'unknown',
    pipelineRunId: ctx.runId,
    at: now,
  };
  const envelope: ToolResultEnvelope = {
    data: payload,
    meta: {
      toolName: ctx.request.toolName,
      toolVersion: payload.toolVersion,
      ...(ctx.route !== undefined
        ? { provider: ctx.route.provider, operation: ctx.route.operation }
        : {}),
      evidenceIds: [...ctx.evidenceIds],
      fetchedAt: now,
      cache: (ctx.cacheOutcome ?? 'MISS') as CacheOutcome,
      qualityCodes: [`BLOCKED:${blocked.state}`],
      conflicts: [],
      quota: {
        quotaModel: (ctx.estimate?.quotaModel ?? 'UNKNOWN_CONFIGURABLE') as QuotaModel,
        reservationState: (ctx.quotaState ?? 'PENDING') as ReservationState,
        estimatedUnits: ctx.estimate?.estimatedUnits ?? null,
        actualUnits: ctx.committedUnits ?? null,
      },
      partial: true,
    },
  };
  return envelope;
}

/** Success envelope: provenance + conflicts + quota summary from the run context. */
export function buildSuccessEnvelope(ctx: ToolRunContext, now: string): ToolResultEnvelope {
  const result = ctx.result!;
  const observations = result.observations;

  const conflictRefs: ProviderConflictRef[] = result.conflicts.map((conflict, index) => ({
    conflictId: `conflict-${ctx.runId}-${String(index)}`,
    providers: [...conflict.providers],
    fieldPath: conflict.fieldPath,
    evidenceIds: (() => {
      const matching = observations
        .filter((o) => conflict.providers.includes(o.provider))
        .map((o) => o.evidenceId);
      return matching.length > 0 ? matching : observations.map((o) => o.evidenceId);
    })(),
  }));

  const qualityCodes = [
    ...new Set(observations.flatMap((o) => o.qualityCodes)),
    ...(result.missingCapabilities.length > 0 ? ['DEGRADED'] : []),
  ];

  const envelope: ToolResultEnvelope = {
    data: {
      observations: observations.map(
        ({
          evidenceId,
          provider,
          observedAt,
          availableAt,
          fetchedAt,
          fields,
          qualityCodes: codes,
        }) => ({
          evidenceId,
          provider,
          observedAt,
          availableAt,
          fetchedAt,
          fields,
          ...(codes.length > 0 ? { qualityCodes: codes } : {}),
        }),
      ),
      ...(result.missingCapabilities.length > 0
        ? { missingCapabilities: [...result.missingCapabilities] }
        : {}),
      ...(conflictRefs.length > 0 ? { conflicts: conflictRefs } : {}),
    },
    meta: {
      toolName: ctx.request.toolName,
      toolVersion: ctx.registryEntryVersion ?? ctx.request.toolVersion ?? 'unknown',
      ...(ctx.route !== undefined
        ? { provider: ctx.route.provider, operation: ctx.route.operation }
        : {}),
      evidenceIds:
        ctx.evidenceIds.length > 0 ? [...ctx.evidenceIds] : observations.map((o) => o.evidenceId),
      ...(observations.length > 0 ? { observedAt: minBy(observations, (o) => o.observedAt) } : {}),
      ...(observations.length > 0
        ? { availableAt: minBy(observations, (o) => o.availableAt) }
        : {}),
      fetchedAt: maxBy(observations, (o) => o.fetchedAt) ?? now,
      cache: (ctx.cacheOutcome ??
        (ctx.servedFromCache ? 'HIT_FRESH' : 'REFRESHED')) as CacheOutcome,
      ...(ctx.cachedFreshnessSeconds !== undefined && ctx.servedFromCache
        ? { freshnessSeconds: ctx.cachedFreshnessSeconds }
        : {}),
      qualityCodes,
      conflicts: conflictRefs,
      quota: {
        quotaModel: (ctx.estimate?.quotaModel ?? 'UNKNOWN_CONFIGURABLE') as QuotaModel,
        reservationState: (ctx.quotaState ??
          (ctx.servedFromCache ? 'PENDING' : 'COMMITTED')) as ReservationState,
        estimatedUnits: ctx.estimate?.estimatedUnits ?? null,
        actualUnits: ctx.committedUnits ?? null,
      },
      partial: result.partial,
      ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
      ...(result.resourceUris !== undefined && result.resourceUris.length > 0
        ? { resourceUris: [...result.resourceUris] }
        : {}),
    },
  };
  return envelope;
}

/**
 * Stage 24 — RETURN_STRUCTURED_RESULT. Cache-served runs materialize their
 * cached payload back into a full result first, so a cache hit carries real
 * provenance plus freshnessSeconds. The final envelope is SCHEMA-VALIDATED;
 * a malformed envelope is a hard internal error, never sent.
 */
export async function makeEnvelopeStageRun(
  deps: EnvelopeStageDeps,
  ctx: ToolRunContext,
): Promise<void> {
  if (ctx.servedFromCache && ctx.result === undefined) {
    if (deps.objectStore === undefined || ctx.cachedPayloadRef === undefined) {
      throw new Error(
        `cache-served run ${ctx.runId} cannot materialize payload ${ctx.cachedPayloadRef ?? '<missing>'} without an object store`,
      );
    }
    const found = await deps.objectStore.get({ contentHash: ctx.cachedPayloadRef });
    if (found === null) {
      throw new Error(`cached payload ${ctx.cachedPayloadRef} vanished before materialization`);
    }
    const parsed = JSON.parse(new TextDecoder().decode(found.bytes)) as NormalizedResult;
    ctx.result = {
      observations: parsed.observations ?? [],
      conflicts: parsed.conflicts ?? [],
      partial: parsed.partial ?? false,
      missingCapabilities: parsed.missingCapabilities ?? [],
      ...(parsed.nextCursor !== undefined ? { nextCursor: parsed.nextCursor } : {}),
      ...(parsed.resourceUris !== undefined ? { resourceUris: parsed.resourceUris } : {}),
    };
    // Freshness = age of the newest underlying fetch at serve time.
    const newestFetched = maxBy(ctx.result.observations, (o) => o.fetchedAt);
    if (newestFetched !== undefined) {
      ctx.cachedFreshnessSeconds = Math.max(
        0,
        Math.floor((Date.parse(deps.now()) - Date.parse(newestFetched)) / 1000),
      );
    }
  }
  const now = deps.now();
  const envelope =
    ctx.blocked !== undefined ? buildBlockedEnvelope(ctx, now) : buildSuccessEnvelope(ctx, now);
  const validated = ToolResultEnvelopeSchema.safeParse(envelope);
  if (!validated.success) {
    throw new Error(`stage 24 assembled an invalid envelope: ${validated.error.message}`);
  }
  ctx.envelope = validated.data;
}

export function makeEnvelopeStage(deps: EnvelopeStageDeps) {
  return (ctx: ToolRunContext): Promise<void> => makeEnvelopeStageRun(deps, ctx);
}
