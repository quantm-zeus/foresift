/**
 * Pipeline stages 3–4 (FR-CORE-002; PRD §16.2). Stage 3 validates and
 * canonicalizes input against the route's authoritative schema (ADR-0013:
 * Zod in production composition; the seam accepts any `.parse` validator).
 * Stage 4 derives THE deterministic acquisition decision from the artifacts
 * of stages 1–3 and validates the exact authorization envelope — every
 * artifact the later stages will rely on must be present and consistent
 * before anything is persisted or dispatched.
 *
 * Input-shape refusals exit NOT_REQUESTED_BY_POLICY with a machine reason:
 * nothing was ever requested, which is categorically different from a
 * retrieval failure (AC-242 substrate).
 */
import { ADMISSIBLE_ACTION_CLASSES } from '@foresift/domain';
import { canonicalJson } from '@foresift/persistence';
import type { AcquisitionState } from '@foresift/domain';
import type { ToolRunContext } from '../run-context.ts';
import type { SchemaLike } from '../provider-contract.ts';
import type { JsonSchemaObject } from '../json-schema.ts';
import { jsonSchemaValidator } from '../json-schema.ts';
import { block } from './authn.ts';

/** Compile the registration-declared input shape into a runtime validator. */
function validatorFor(routeInput: SchemaLike | undefined, schemaJson: unknown): SchemaLike {
  if (routeInput !== undefined) return routeInput;
  return jsonSchemaValidator((schemaJson ?? {}) as JsonSchemaObject);
}

export interface ValidateStageDeps {
  /** Definition metadata's declared input JSON shape (registration truth). */
  readonly inputSchemaJsonOf: (ctx: ToolRunContext) => unknown;
}

/** Stage 3 — VALIDATE_AND_CANONICALIZE_INPUT. */
export function makeValidateInputStage(deps: ValidateStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.blocked) return;
    const route = ctx.route;
    if (!route || !ctx.actor) throw new Error('validate ran without a routed, authorized call');
    const validator = validatorFor(route.inputSchema, deps.inputSchemaJsonOf(ctx));
    let parsed: unknown;
    try {
      parsed = validator.parse(ctx.request.arguments ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      block(ctx, 'NOT_REQUESTED_BY_POLICY', `INPUT_SCHEMA_INVALID: ${message}`, 'VALIDATE_INPUT');
      return;
    }
    // Freeze one byte-stable JSON value. Zod transforms/defaults have already
    // run; the canonical round-trip removes caller key-order as hidden state.
    ctx.canonicalInput = JSON.parse(canonicalJson(parsed)) as unknown;
  };
}

export interface DecisionStageDeps {
  /**
   * Deployment policy hook: may downgrade the decision to
   * NOT_REQUESTED_BY_POLICY (e.g. evidence family not requested for this
   * tenant). It can NEVER upgrade a refusal into a request.
   */
  readonly acquisitionPolicy?: ((ctx: ToolRunContext) => AcquisitionState) | undefined;
}

/**
 * Stage 4 — VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE.
 * Deterministic: the decision follows from already-computed authorization
 * artifacts plus the optional policy hook; no model output participates
 * (INV-002). The envelope check refuses to continue unless actor, route,
 * license verdict, admissible action class, and canonical input are all
 * present and mutually consistent.
 */
export function makeDecisionStage(deps: DecisionStageDeps = {}) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.blocked) return;

    // Exact authorization-envelope validation.
    const problems: string[] = [];
    if (!ctx.actor) problems.push('no authenticated actor');
    if (!ctx.route) problems.push('no operation route');
    if (!ctx.licenseVerdict?.allowed) problems.push('no verified rights verdict');
    if (ctx.registryEntryName === undefined) problems.push('no registry entry');
    if (
      ctx.actionClass === undefined ||
      !(ADMISSIBLE_ACTION_CLASSES as readonly string[]).includes(ctx.actionClass)
    ) {
      problems.push(`action class ${String(ctx.actionClass)} is inadmissible`);
    }
    if (ctx.canonicalInput === undefined) problems.push('input not canonicalized');
    if (problems.length > 0) {
      block(
        ctx,
        'RIGHTS_BLOCKED',
        `AUTHORIZATION_ENVELOPE_INVALID: ${problems.join('; ')}`,
        'DECISION',
      );
      return;
    }

    const envelopeProblems = validateExplicitEnvelope(ctx);
    if (envelopeProblems.length > 0) {
      block(
        ctx,
        'RIGHTS_BLOCKED',
        `AUTHORIZATION_ENVELOPE_INVALID: ${envelopeProblems.join('; ')}`,
        'DECISION',
      );
      return;
    }

    // Deterministic acquisition decision.
    let decided: AcquisitionState = ctx.request.acquisitionDecision?.state ?? 'REQUESTED';
    if (deps.acquisitionPolicy !== undefined) {
      const policyDecision = deps.acquisitionPolicy(ctx);
      if (policyDecision !== 'REQUESTED' && policyDecision !== 'NOT_REQUESTED_BY_POLICY') {
        block(
          ctx,
          'RIGHTS_BLOCKED',
          `ACQUISITION_POLICY_ILLEGAL: policy returned ${policyDecision}; only REQUESTED or NOT_REQUESTED_BY_POLICY are decidable here`,
          'DECISION',
        );
        return;
      }
      // A policy hook can narrow a request to not-requested, never upgrade a
      // planner refusal back into REQUESTED.
      if (policyDecision === 'NOT_REQUESTED_BY_POLICY') decided = policyDecision;
    }
    ctx.decidedState = decided;
  };
}

function validateExplicitEnvelope(ctx: ToolRunContext): string[] {
  const envelope = ctx.request.authorizationEnvelope;
  if (envelope === undefined) return [];
  const request = ctx.request;
  const route = ctx.route!;
  const problems: string[] = [];
  const toolAllowed = envelope.allowedTools.some(
    (tool) =>
      tool.name === request.toolName &&
      (tool.version === undefined ||
        tool.version === (request.toolVersion ?? ctx.registryEntryVersion)),
  );
  if (!toolAllowed) problems.push('tool/version exceeds planner envelope');
  if (envelope.tenantId !== request.tenantId) problems.push('tenant exceeds planner envelope');
  if (!envelope.allowedEntities.includes(request.canonicalEntityIdentity)) {
    problems.push('entity exceeds planner envelope');
  }
  const fields = request.fieldProjection ?? route.fieldProjection;
  const unauthorizedFields = fields.filter((field) => !envelope.allowedFields.includes(field));
  if (unauthorizedFields.length > 0) {
    problems.push(`fields exceed planner envelope: ${unauthorizedFields.join(',')}`);
  }
  const asOf = request.asOf ?? ctx.startedAt;
  if (Number.isNaN(Date.parse(asOf))) problems.push('as-of is not a valid timestamp');
  if (envelope.earliestAsOf !== undefined) {
    if (Number.isNaN(Date.parse(envelope.earliestAsOf))) {
      problems.push('planner earliest time bound is invalid');
    } else if (Date.parse(asOf) < Date.parse(envelope.earliestAsOf)) {
      problems.push('as-of precedes planner time bound');
    }
  }
  if (envelope.latestAsOf !== undefined) {
    if (Number.isNaN(Date.parse(envelope.latestAsOf))) {
      problems.push('planner latest time bound is invalid');
    } else if (Date.parse(asOf) > Date.parse(envelope.latestAsOf)) {
      problems.push('as-of exceeds planner time bound');
    }
  }
  if (!Number.isFinite(envelope.maxBytes) || envelope.maxBytes < route.byteLimit) {
    problems.push('byte limit exceeds planner envelope');
  }
  const providerClass = route.providerClass ?? route.provider;
  if (!envelope.allowedProviderClasses.includes(providerClass)) {
    problems.push('provider class exceeds planner envelope');
  }
  const deadlineAt = Date.parse(envelope.deadlineAt);
  if (!Number.isFinite(deadlineAt) || deadlineAt < Date.parse(ctx.startedAt) + route.deadlineMs) {
    problems.push('dispatch deadline exceeds planner envelope');
  }
  if (envelope.maxPageSize !== undefined) {
    const input = ctx.canonicalInput;
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      const record = input as Record<string, unknown>;
      const pageSize = record.pageSize ?? record.pageLimit ?? record.limit;
      if (typeof pageSize === 'number' && pageSize > envelope.maxPageSize) {
        problems.push('page limit exceeds planner envelope');
      }
    }
  }
  const decision = request.acquisitionDecision;
  if (decision !== undefined) {
    const missingDecisionFields = decision.requestedFields.filter(
      (field) => !fields.includes(field),
    );
    const extraCallFields = fields.filter((field) => !decision.requestedFields.includes(field));
    if (missingDecisionFields.length > 0 || extraCallFields.length > 0) {
      problems.push('acquisition decision fields do not exactly match the call projection');
    }
    if (!decision.evidenceFamily || !decision.policyVersion) {
      problems.push('acquisition decision identity is incomplete');
    }
  }
  return problems;
}
