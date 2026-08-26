/**
 * Pipeline stages 14–17 (FR-CORE-002, FR-CORE-003; PRD §16.2): call the
 * injected allowlisted READ-ONLY operation adapter behind the perimeter's
 * egress controls with deadline and byte-limit enforcement; validate content
 * type + raw schema; normalize identity/units/timestamps/availability/
 * lineage/quality codes; validate the normalized shape and its semantic
 * invariants.
 *
 * The execution-time prohibited-financial gate (FR-CORE-005, T609) re-checks
 * the resolved action class + operation identity HERE — immediately before
 * any adapter call — so a prohibited call is refused and audited regardless
 * of registration state. Provider failures map to TIMED_OUT /
 * PROVIDER_UNAVAILABLE / INVALID_RESPONSE.
 */
import { sha256Text } from '@foresift/persistence';
import type { EgressPlane } from '@foresift/security';
import type { EgressDecision } from '@foresift/shared-schemas';
import type { ToolRunContext } from '../run-context.ts';
import { block } from './authn.ts';
import { normalizeRawPayload, validateNormalizedInvariants } from '../normalize.ts';
import type { NormalizedResult, ProviderCallRequest } from '../provider-contract.ts';

/**
 * The ONLY egress surface dispatch needs: authorize one URL on one plane
 * immediately before any byte moves. The real EgressGuard satisfies this
 * structurally; tests inject permissive/refusing stand-ins.
 */
export interface EgressAuthorizer {
  authorize(url: string, plane: EgressPlane): Promise<EgressDecision>;
  /** Real EgressGuard supplies response-side policy enforcement. */
  inspectResponse?(response: {
    readonly bytes?: number;
    readonly timeMs?: number;
    readonly decompressedBytes?: number;
    readonly contentType?: string;
  }): EgressDecision;
}

export interface DispatchStageDeps {
  readonly egressGuard: EgressAuthorizer | undefined;
  readonly executionGate: ExecutionGate;
  readonly now: () => string;
}

/**
 * Execution-time prohibited-financial gate inputs: everything the canary
 * screen needs to classify the RESOLVED operation at call time. Composition
 * injects the same ProhibitedCapabilityScreen used at registration.
 */
export interface ExecutionGateInput {
  readonly toolName: string;
  readonly toolVersion: string;
  readonly actionClass: string | undefined;
  readonly descriptionText: string;
  readonly schemaJsonText: string;
}

export type ExecutionGate = (input: ExecutionGateInput) => string[];

/** Classify an unexpected dispatch failure into THE typed exit state. */
export function classifyDispatchFailure(error: unknown): {
  state: 'TIMED_OUT' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RESPONSE';
  reason: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DeadlineExceededError || /deadline exceeded/i.test(message)) {
    return { state: 'TIMED_OUT', reason: `DISPATCH_DEADLINE: ${message}` };
  }
  if (
    error instanceof EgressRefusedError ||
    /egress|allowlist|dns|connect|unreachable/i.test(message)
  ) {
    return { state: 'PROVIDER_UNAVAILABLE', reason: `EGRESS_OR_CONNECT: ${message}` };
  }
  return { state: 'PROVIDER_UNAVAILABLE', reason: `ADAPTER_FAILURE: ${message}` };
}

export class DeadlineExceededError extends Error {
  constructor(ms: number) {
    super(`provider deadline exceeded after ${String(ms)}ms`);
    this.name = 'DeadlineExceededError';
  }
}

export class EgressRefusedError extends Error {
  constructor(reason: string) {
    super(`egress refused: ${reason}`);
    this.name = 'EgressRefusedError';
  }
}

/** Stage 14 — CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION. */
export function makeDispatchStage(deps: DispatchStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.servedFromCache || ctx.blocked) return;
    const route = ctx.route!;

    if (
      route.adapter.provider !== route.provider ||
      !route.adapter.operations.includes(route.operation)
    ) {
      block(
        ctx,
        'CAPABILITY_UNAVAILABLE',
        'ADAPTER_OPERATION_NOT_ALLOWLISTED: resolved route is not declared by its adapter',
        'DISPATCH',
      );
      return;
    }
    if (ctx.actionClass !== 'EXTERNAL_READ') {
      block(
        ctx,
        'RIGHTS_BLOCKED',
        ctx.actionClass === 'PROHIBITED_FINANCIAL'
          ? 'PROHIBITED_FINANCIAL_EXECUTION_REFUSED: prohibited action class'
          : `READ_ONLY_DISPATCH_REFUSED: provider routes require EXTERNAL_READ, got ${String(ctx.actionClass)}`,
        'DISPATCH',
      );
      return;
    }

    // T609: the prohibited-financial re-check runs on EVERY dispatch —
    // regardless of what registration admitted — against the resolved
    // operation's identity text.
    const findings = deps.executionGate({
      toolName: ctx.request.toolName,
      toolVersion: ctx.request.toolVersion ?? '*',
      actionClass: ctx.actionClass,
      descriptionText: `${route.operation}\n${ctx.toolDescription ?? ''}`,
      schemaJsonText: JSON.stringify(ctx.inputSchemaJson ?? {}),
    });
    if (findings.length > 0) {
      block(
        ctx,
        'RIGHTS_BLOCKED',
        `PROHIBITED_FINANCIAL_EXECUTION_REFUSED: ${findings.join('; ') || 'prohibited action class'}`,
        'DISPATCH',
      );
      return;
    }

    // Perimeter control: authorize the exact endpoint before any byte moves.
    if (deps.egressGuard === undefined) {
      block(
        ctx,
        'PROVIDER_UNAVAILABLE',
        'EGRESS_UNCONFIGURED: no egress guard is composed',
        'DISPATCH',
      );
      return;
    }
    let decision: EgressDecision;
    try {
      decision = await deps.egressGuard.authorize(route.endpointUrl, route.egressPlane);
    } catch (error) {
      const classified = classifyDispatchFailure(error);
      block(ctx, classified.state, classified.reason, 'DISPATCH');
      return;
    }
    if (decision.decision !== 'ALLOW') {
      block(
        ctx,
        'PROVIDER_UNAVAILABLE',
        `EGRESS_REFUSED: ${decision.reason}: ${decision.detail}`,
        'DISPATCH',
      );
      return;
    }

    const controller = new AbortController();
    const plannerDeadline = ctx.request.authorizationEnvelope?.deadlineAt;
    const remaining =
      plannerDeadline === undefined
        ? route.deadlineMs
        : Math.max(0, Date.parse(plannerDeadline) - Date.parse(deps.now()));
    const deadlineMs = Math.max(1, Math.min(route.deadlineMs, remaining));
    const request: ProviderCallRequest = {
      provider: route.provider,
      operation: route.operation,
      operationVersion: route.operationVersion,
      canonicalInput: ctx.canonicalInput,
      pinnedAddresses: decision.pinnedAddresses,
      deadlineMs,
      byteLimit: route.byteLimit,
      signal: controller.signal,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const callStartedAt = Date.now();
    try {
      const call = route.adapter.call(request);
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(new DeadlineExceededError(deadlineMs));
          reject(new DeadlineExceededError(deadlineMs));
        }, deadlineMs);
      });
      ctx.rawResponse = await Promise.race([call, deadline]);
      const responseDecision = deps.egressGuard.inspectResponse?.({
        bytes: Buffer.byteLength(ctx.rawResponse.bodyText, 'utf8'),
        timeMs: Date.now() - callStartedAt,
        contentType: ctx.rawResponse.contentType,
      });
      if (responseDecision?.decision === 'REFUSE') {
        const state =
          responseDecision.reason === 'RESPONSE_TIME_EXCEEDED'
            ? 'TIMED_OUT'
            : responseDecision.reason === 'CONTENT_TYPE_REFUSED' ||
                responseDecision.reason === 'RESPONSE_BYTES_EXCEEDED' ||
                responseDecision.reason === 'DECOMPRESSION_RATIO_EXCEEDED'
              ? 'INVALID_RESPONSE'
              : 'PROVIDER_UNAVAILABLE';
        block(
          ctx,
          state,
          `EGRESS_RESPONSE_REFUSED: ${responseDecision.reason}: ${responseDecision.detail}`,
          'DISPATCH',
        );
      }
    } catch (error) {
      const classified = classifyDispatchFailure(error);
      block(ctx, classified.state, classified.reason, 'DISPATCH');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

const DEFAULT_ADMITTED_CONTENT_TYPES = ['application/json'];

/** Stage 15 — VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA. */
export function makeRawValidateStage() {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.servedFromCache || ctx.blocked) return;
    const raw = ctx.rawResponse!;
    const route = ctx.route!;
    const contentType = raw.contentType.split(';')[0]!.trim().toLowerCase();
    const admitted = (route.allowedContentTypes ?? DEFAULT_ADMITTED_CONTENT_TYPES).map((value) =>
      value.toLowerCase(),
    );
    if (!admitted.includes(contentType)) {
      block(
        ctx,
        'INVALID_RESPONSE',
        `CONTENT_TYPE_REFUSED: ${raw.contentType} (admitted: ${admitted.join(',')})`,
        'RAW_VALIDATE',
      );
      return;
    }
    const bodyBytes = Buffer.byteLength(raw.bodyText, 'utf8');
    if (bodyBytes > route.byteLimit) {
      block(
        ctx,
        'INVALID_RESPONSE',
        `BYTE_LIMIT_EXCEEDED: ${String(bodyBytes)} > ${String(route.byteLimit)}`,
        'RAW_VALIDATE',
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.bodyText) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      block(ctx, 'INVALID_RESPONSE', `PAYLOAD_NOT_JSON: ${message}`, 'RAW_VALIDATE');
      return;
    }
    if (route.rawSchema !== undefined) {
      try {
        parsed = route.rawSchema.parse(parsed);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        block(ctx, 'INVALID_RESPONSE', `RAW_SCHEMA_INVALID: ${message}`, 'RAW_VALIDATE');
        return;
      }
    }
    // Source fingerprint over the exact bytes received (INV-004).
    ctx.sourceFingerprint = sha256Text(raw.bodyText);
    ctx.rawParsed = parsed;
  };
}

/** Stage 16 — NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY. */
export function makeNormalizeStage(deps: Pick<DispatchStageDeps, 'now'>) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.servedFromCache || ctx.blocked) return;
    const route = ctx.route!;
    let normalized: NormalizedResult;
    try {
      normalized =
        route.normalizer?.(ctx.rawParsed, {
          provider: route.provider,
          fetchedAt: deps.now(),
          runId: ctx.runId,
        }) ??
        normalizeRawPayload(ctx.rawParsed, {
          provider: route.provider,
          fetchedAt: deps.now(),
          runId: ctx.runId,
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      block(ctx, 'INVALID_RESPONSE', `NORMALIZATION_FAILED: ${message}`, 'NORMALIZE');
      return;
    }
    ctx.result = normalized;
  };
}

/** Stage 17 — VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS. */
export function makeNormalizedValidateStage(deps: Pick<DispatchStageDeps, 'now'>) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.servedFromCache || ctx.blocked) return;
    const route = ctx.route!;
    if (route.normalizedSchema !== undefined) {
      try {
        ctx.result = route.normalizedSchema.parse(ctx.result) as NormalizedResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        block(
          ctx,
          'INVALID_RESPONSE',
          `NORMALIZED_SCHEMA_INVALID: ${message}`,
          'NORMALIZED_VALIDATE',
        );
        return;
      }
    }
    const problems = validateNormalizedInvariants(ctx.result!, { now: deps.now() });
    if (problems.length > 0) {
      block(
        ctx,
        'INVALID_RESPONSE',
        `SEMANTIC_INVARIANT_VIOLATED: ${problems.join('; ')}`,
        'NORMALIZED_VALIDATE',
      );
    }
  };
}
