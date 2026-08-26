/**
 * Pipeline stage 24 (FR-CORE-003; PRD §16.2/§16.3): return THE structured
 * ToolResultEnvelope. Every run returns one — success carries normalized data
 * with complete meta (evidence IDs ≥ 1, observed/available/fetched times,
 * cache outcome + freshness, quota summary); every blocked exit carries its
 * BlockedStatePayload as `data` with `partial:true` and degraded quality
 * codes so a policy refusal is never rendered as a retrieval failure.
 *
 * The engine validates envelope completeness BEFORE stage 23's audit append
 * (pure preparation — no observable state changes) so the audited outcome is
 * exactly the returned outcome; the envelope itself is built and schema-parsed
 * here at stage 24, last.
 */
import { ToolResultEnvelopeSchema, type ToolResultEnvelope } from '@foresift/shared-schemas';
import type { CacheOutcome, QuotaModel, ReservationState } from '@foresift/domain';
import { exited, type ToolCallContext } from './run-context.ts';

/**
 * Runs without a reservation (cache hits, early blocked exits) must still
 * report a lifecycle state; RELEASED is the terminal zero-consumption value —
 * nothing was reserved and nothing will be committed. Units stay null.
 */
const NO_RESERVATION_STATE: ReservationState = 'RELEASED';
const NO_QUOTA_MODEL: QuotaModel = 'UNKNOWN_CONFIGURABLE';

/** Quality codes marking blocked / degraded results in meta.qualityCodes. */
export const BLOCKED_QUALITY_CODE = 'PIPELINE_BLOCKED';
export const INTERNAL_ERROR_QUALITY_CODE = 'PIPELINE_INTERNAL_ERROR';

function freshnessSeconds(ctx: ToolCallContext): number | undefined {
  const storedAt = ctx.cacheResult?.storedAt;
  if (storedAt === undefined) return undefined;
  if (ctx.cacheOutcome !== 'HIT_FRESH' && ctx.cacheOutcome !== 'HIT_STALE') return undefined;
  const seconds = Math.max(0, Math.floor((Date.parse(ctx.now()) - Date.parse(storedAt)) / 1000));
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Pure completeness gate over the final context: on the success path the
 * §16.3 meta cannot be assembled honestly without event times and evidence.
 * Called by the engine before audit so any violation flips the run to an
 * ERROR exit that stage 23 then audits faithfully.
 */
export function validateEnvelopeCompleteness(ctx: ToolCallContext): string | null {
  if (exited(ctx)) return null; // blocked envelopes are always assemblable
  if (ctx.evidenceIds.length === 0) return 'ENVELOPE_INCOMPLETE:no evidence bundle frozen';
  if (ctx.fetchedAt === null) return 'ENVELOPE_INCOMPLETE:fetchedAt missing';
  if (ctx.normalized === null) return 'ENVELOPE_INCOMPLETE:normalization missing';
  if (ctx.normalized.partial === true && ctx.observedAt === null) {
    // Partial success still needs event time for independence analysis.
    return 'ENVELOPE_INCOMPLETE:partial result without observedAt';
  }
  return null;
}

/**
 * Stage 24 — assemble THE envelope and parse it against THE shared schema
 * (a parse failure here is a programming error, never a runtime condition).
 */
export function buildEnvelope(ctx: ToolCallContext): ToolResultEnvelope {
  const exit = ctx.exit;
  const toolName = ctx.entry?.metadata.name ?? ctx.request.toolName;
  const toolVersion = ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown';
  const now = ctx.now();

  let data: unknown;
  let qualityCodes: string[];
  let partial: boolean;
  let cacheOutcome: CacheOutcome;
  let evidenceIds: string[];
  if (exit === null) {
    data = ctx.normalized!.data;
    qualityCodes = [...(ctx.normalized?.qualityCodes ?? [])];
    partial = ctx.normalized?.partial ?? false;
    cacheOutcome = ctx.cacheOutcome;
    evidenceIds = [...ctx.evidenceIds];
  } else {
    data = exit.payload;
    qualityCodes = [
      exit.auditOutcome === 'ERROR' ? INTERNAL_ERROR_QUALITY_CODE : BLOCKED_QUALITY_CODE,
      ...ctx.degradedMarkers,
    ];
    partial = true;
    cacheOutcome = ctx.cacheOutcome;
    evidenceIds = [];
  }
  if (ctx.degradedMarkers.length > 0 && exit === null) {
    qualityCodes = [...new Set([...qualityCodes, ...ctx.degradedMarkers])];
  }

  const envelope = {
    data,
    meta: {
      toolName,
      toolVersion,
      ...(ctx.keyComponents !== null &&
      ctx.keyComponents.provider !== 'composite'
        ? { provider: ctx.keyComponents.provider, operation: ctx.keyComponents.operation }
        : {}),
      evidenceIds,
      ...(ctx.normalized?.observedAt !== undefined ? { observedAt: ctx.normalized.observedAt } : {}),
      ...(ctx.normalized?.availableAt !== undefined
        ? { availableAt: ctx.normalized.availableAt }
        : {}),
      fetchedAt: exit === null ? ctx.fetchedAt! : now,
      cache: cacheOutcome,
      ...(freshnessSeconds(ctx) !== undefined ? { freshnessSeconds: freshnessSeconds(ctx)! } : {}),
      qualityCodes,
      conflicts: [...(ctx.normalized?.conflicts ?? [])],
      quota: {
        quotaModel: ctx.quotaEstimate?.quotaModel ?? NO_QUOTA_MODEL,
        reservationState: ctx.reservationSettledAs ?? NO_RESERVATION_STATE,
        estimatedUnits: ctx.quotaEstimate?.estimatedUnits ?? null,
        actualUnits: ctx.actualUnits,
      },
      partial,
      ...(ctx.normalized?.nextCursor !== undefined ? { nextCursor: ctx.normalized.nextCursor } : {}),
      ...(ctx.normalized?.resourceUris !== undefined
        ? { resourceUris: [...ctx.normalized.resourceUris] }
        : {}),
    },
  };
  return ToolResultEnvelopeSchema.parse(envelope);
}

/**
 * Last-resort stage-24 product: used only when the primary assembly itself
 * failed (an internal fault after audit). Built entirely from controlled
 * literals so it always parses; the run is still audited and still returns a
 * structured, schema-valid result.
 */
export function buildFallbackEnvelope(
  ctx: ToolCallContext,
  machineReason: string,
): ToolResultEnvelope {
  return ToolResultEnvelopeSchema.parse({
    data: {
      acquisitionState: 'CAPABILITY_UNAVAILABLE',
      machineReason,
      toolName: ctx.entry?.metadata.name ?? ctx.request.toolName,
      toolVersion: ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown',
      pipelineRunId: ctx.runId,
      at: ctx.now(),
    },
    meta: {
      toolName: ctx.entry?.metadata.name ?? ctx.request.toolName,
      toolVersion: ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown',
      evidenceIds: [],
      fetchedAt: ctx.now(),
      cache: 'MISS',
      qualityCodes: [INTERNAL_ERROR_QUALITY_CODE],
      conflicts: [],
      quota: {
        quotaModel: NO_QUOTA_MODEL,
        reservationState: NO_RESERVATION_STATE,
        estimatedUnits: null,
        actualUnits: null,
      },
      partial: true,
    },
  });
}
