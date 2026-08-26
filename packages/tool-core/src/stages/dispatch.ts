/**
 * Pipeline stages 14–17 (FR-CORE-002, FR-CORE-003; PRD §16.2):
 *
 *   14. call the allowlisted provider/collector operation with deadline,
 *       byte limit, and egress policy
 *   15. validate content type and raw schema
 *   16. normalize identity, units, timestamps, availability, source
 *       lineage, and quality codes
 *   17. validate normalized schema and semantic invariants
 *
 * Dispatch wraps the perimeter controls: egress authorization runs BEFORE any
 * adapter call when an external endpoint is declared, the deadline races the
 * adapter, and the byte limit caps the serialized response. Provider-failure
 * paths map to exactly TIMED_OUT / PROVIDER_UNAVAILABLE / INVALID_RESPONSE —
 * never invented vocabularies. The execution-time prohibited-financial gate
 * runs at the top of stage 14 regardless of registration state (FR-CORE-005).
 */
import { sha256Text } from '@foresift/persistence';
import { block, exited, type ToolCallContext } from '../run-context.ts';
import { PROHIBITED_EXECUTION_REASON, type ProhibitedCapabilityScreen } from '../prohibited.ts';

/**
 * Minimal egress seam consumed by stage 14 — the composition root adapts THE
 * security perimeter's EgressGuard onto this shape. An unbound guard is
 * modeled by a deny-everything implementation at composition.
 */
export interface EgressGuardLike {
  authorize(url: string, plane: string): Promise<{ allowed: boolean; reason: string }>;
}

/** What stage 16 produces; stage 17 validates it before anything persists. */
export interface NormalizedPayload {
  readonly data: unknown;
  readonly observedAt?: string;
  readonly availableAt?: string;
  readonly qualityCodes?: readonly string[];
  /** Source-lineage refs preserved for downstream independence analysis. */
  readonly lineageRefs?: readonly string[];
  readonly conflicts?: NormalizedPayloadConflicts;
  /** Provider-reported usage units when the operation exposes them. */
  readonly actualUnits?: number;
  readonly nextCursor?: string;
  readonly resourceUris?: readonly string[];
  readonly partial?: boolean;
}

type NormalizedPayloadConflicts = import('@foresift/shared-schemas').ProviderConflictRef[];

export interface DispatchDeps {
  readonly screen: ProhibitedCapabilityScreen;
  readonly egress: EgressGuardLike;
  readonly deadlineMs: number;
  readonly maxResponseBytes: number;
}

/** Retrieval-failure vocabulary — the §16 AcquisitionState subset for dispatch. */
export type RetrievalFailureCode = 'TIMED_OUT' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RESPONSE';

/**
 * Internal dispatch failure carrier. Deliberately NOT a ForesiftError: the
 * §16 retrieval-failure states are acquisition vocabulary, not ErrorCode
 * vocabulary — stage handlers translate this into the typed blocked exit.
 */
export class DispatchFailureError extends Error {
  readonly code: RetrievalFailureCode;
  constructor(code: RetrievalFailureCode, message: string) {
    super(message);
    this.name = 'DispatchFailureError';
    this.code = code;
  }
}

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/json',
  'application/octet-stream',
]);

function retrievalFailure(ctx: ToolCallContext, error: DispatchFailureError): void {
  block(ctx, {
    payload: {
      acquisitionState: error.code,
      machineReason: `${error.code}:${error.message}`,
      toolName: ctx.request.toolName,
      toolVersion: ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown',
      pipelineRunId: ctx.runId,
      at: ctx.now(),
    },
    auditOutcome: 'BLOCKED',
    persistAcquisitionRow: false,
  });
}

/**
 * Stage 14 — call the allowlisted read-only operation through the guarded
 * harness. `execute` is the registry entry's own function; the harness adds
 * egress authorization, deadline racing, and byte-limit enforcement around it.
 */
export async function dispatchOperation(
  ctx: ToolCallContext,
  deps: DispatchDeps,
): Promise<void> {
  if (exited(ctx)) return;
  const entry = ctx.entry!;
  if (entry.execute === undefined) {
    retrievalFailure(
      ctx,
      new DispatchFailureError('PROVIDER_UNAVAILABLE', 'OPERATION_ADAPTER_UNBOUND'),
    );
    return;
  }

  // Execution-time prohibited-financial gate (T609): re-check BEFORE dispatch.
  const gateVerdict = deps.screen.screenResolvedOperation(
    {
      toolName: entry.metadata.name,
      toolVersion: entry.metadata.version,
      actionClass: entry.metadata.actionClass,
      operationName: ctx.keyComponents?.operation ?? entry.metadata.name,
      description: entry.metadata.description,
      schemaJson: entry.metadata.inputSchemaJson,
    },
    ctx.now(),
  );
  if (!gateVerdict.ok) {
    block(ctx, {
      payload: {
        acquisitionState: 'CAPABILITY_UNAVAILABLE',
        machineReason: `${PROHIBITED_EXECUTION_REASON}:${gateVerdict.event.reasons.join(';')}`,
        toolName: entry.metadata.name,
        toolVersion: entry.metadata.version,
        pipelineRunId: ctx.runId,
        at: ctx.now(),
      },
      auditOutcome: 'BLOCKED',
      persistAcquisitionRow: false,
    });
    return;
  }

  // Egress policy wraps the perimeter controls whenever an endpoint declared.
  const declaredEgress = ctx.request.egress;
  if (declaredEgress !== undefined) {
    const decision = await deps.egress.authorize(declaredEgress.url, declaredEgress.plane);
    if (!decision.allowed) {
      retrievalFailure(
        ctx,
        new DispatchFailureError('PROVIDER_UNAVAILABLE', `EGRESS_REFUSED:${decision.reason}`),
      );
      return;
    }
  }

  let raw: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    raw = await Promise.race([
      entry.execute(ctx.canonicalInput),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DispatchFailureError('TIMED_OUT', 'DEADLINE_EXCEEDED')),
          Math.max(1, deps.deadlineMs),
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof DispatchFailureError) {
      retrievalFailure(ctx, error);
      return;
    }
    // Adapter failures are PROVIDER failures — mapped, never propagated raw.
    retrievalFailure(
      ctx,
      new DispatchFailureError('PROVIDER_UNAVAILABLE', `ADAPTER_FAILURE:${(error as Error).message}`),
    );
    return;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  ctx.rawResponse = raw;
  ctx.fetchedAt = ctx.now(); // the payload was fetched from the provider NOW
  ctx.rawByteLength = Buffer.byteLength(JSON.stringify(raw ?? null));
  if (ctx.rawByteLength > deps.maxResponseBytes) {
    retrievalFailure(
      ctx,
      new DispatchFailureError('INVALID_RESPONSE', `BYTE_LIMIT_EXCEEDED:${ctx.rawByteLength}`),
    );
  }
}

/** Stage 15 — validate content type and raw schema (fail-closed on both). */
export function validateContentTypeAndRawSchema(
  ctx: ToolCallContext,
  deps: { contentType?: string },
): void {
  if (exited(ctx)) return;
  const contentType = deps.contentType ?? 'application/json';
  ctx.rawContentType = contentType;
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    retrievalFailure(
      ctx,
      new DispatchFailureError('INVALID_RESPONSE', `CONTENT_TYPE_REFUSED:${contentType}`),
    );
    return;
  }
  const outputSchema = ctx.entry?.outputSchema;
  if (outputSchema === undefined) {
    retrievalFailure(
      ctx,
      new DispatchFailureError('INVALID_RESPONSE', 'OUTPUT_SCHEMA_UNBOUND'),
    );
    return;
  }
  const parsed = outputSchema.safeParse(ctx.rawResponse);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    retrievalFailure(
      ctx,
      new DispatchFailureError(
        'INVALID_RESPONSE',
        `RAW_SCHEMA_INVALID:${issue?.path.join('.') ?? '<root>'} ${issue?.message ?? ''}`,
      ),
    );
  }
}

/** Default normalizer: identity normalization with envelope field extraction. */
export function identityNormalizer(raw: unknown): NormalizedPayload {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    ['observedAt', 'availableAt', 'qualityCodes', 'lineageRefs', 'conflicts'].some((k) =>
      k in (raw as Record<string, unknown>),
    )
  ) {
    const r = raw as Record<string, unknown>;
    return {
      data: 'data' in r ? r.data : raw,
      ...(typeof r.observedAt === 'string' ? { observedAt: r.observedAt } : {}),
      ...(typeof r.availableAt === 'string' ? { availableAt: r.availableAt } : {}),
      ...(Array.isArray(r.qualityCodes) ? { qualityCodes: r.qualityCodes as string[] } : {}),
      ...(Array.isArray(r.lineageRefs) ? { lineageRefs: r.lineageRefs as string[] } : {}),
      ...(Array.isArray(r.conflicts) ? { conflicts: r.conflicts as NormalizedPayloadConflicts } : {}),
      ...(typeof r.actualUnits === 'number' ? { actualUnits: r.actualUnits } : {}),
      ...(typeof r.nextCursor === 'string' ? { nextCursor: r.nextCursor } : {}),
      ...(Array.isArray(r.resourceUris) ? { resourceUris: r.resourceUris as string[] } : {}),
      ...(typeof r.partial === 'boolean' ? { partial: r.partial } : {}),
    };
  }
  return { data: raw };
}

/** Stage 16 — normalize identity/units/timestamps/availability/lineage/quality. */
export function normalizeProviderResponse(
  ctx: ToolCallContext,
  normalize: (raw: unknown) => NormalizedPayload,
): void {
  if (exited(ctx)) return;
  ctx.normalized = normalize(ctx.rawResponse);
  ctx.sourceFingerprint = sha256Text(
    JSON.stringify([
      ctx.keyComponents?.provider,
      ctx.keyComponents?.operation,
      ctx.keyComponents?.operationVersion,
      JSON.stringify(ctx.rawResponse ?? null),
    ]),
  );
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Stage 17 — validate normalized schema and semantic invariants. */
export function validateNormalizedInvariants(ctx: ToolCallContext): void {
  if (exited(ctx)) return;
  const normalized = ctx.normalized!;

  // Semantic invariants over event-time fields.
  for (const [field, value] of [
    ['observedAt', normalized.observedAt],
    ['availableAt', normalized.availableAt],
  ] as const) {
    if (value !== undefined && !ISO_UTC.test(value)) {
      retrievalFailure(ctx, new DispatchFailureError('INVALID_RESPONSE', `TIMESTAMP_MALFORMED:${field}`));
      return;
    }
  }
  if (
    normalized.observedAt !== undefined &&
    normalized.availableAt !== undefined &&
    normalized.availableAt < normalized.observedAt
  ) {
    // Availability cannot precede event time — backdating is refused here so
    // a normalized response can never smuggle one into the cache/envelope.
    retrievalFailure(
      ctx,
      new DispatchFailureError('INVALID_RESPONSE', 'AVAILABILITY_PRECEDES_OBSERVATION'),
    );
    return;
  }
  if (normalized.actualUnits !== undefined && normalized.actualUnits < 0) {
    retrievalFailure(ctx, new DispatchFailureError('INVALID_RESPONSE', 'NEGATIVE_USAGE_UNITS'));
  }
}
