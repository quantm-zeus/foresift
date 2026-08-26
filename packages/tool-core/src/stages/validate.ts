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
import type { AcquisitionState } from '@foresift/domain';
import type { ToolRunContext } from '../run-context.ts';
import type { SchemaLike } from '../provider-contract.ts';
import type { JsonSchemaObject } from '../json-schema.ts';
import { jsonSchemaValidator } from '../json-schema.ts';

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
    ctx.canonicalInput = parsed;
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
      block(ctx, 'RIGHTS_BLOCKED', `AUTHORIZATION_ENVELOPE_INVALID: ${problems.join('; ')}`, 'DECISION');
      return;
    }

    // Deterministic acquisition decision.
    let decided: AcquisitionState = 'REQUESTED';
    if (deps.acquisitionPolicy !== undefined) {
      decided = deps.acquisitionPolicy(ctx);
      if (decided !== 'REQUESTED' && decided !== 'NOT_REQUESTED_BY_POLICY') {
        block(
          ctx,
          'RIGHTS_BLOCKED',
          `ACQUISITION_POLICY_ILLEGAL: policy returned ${decided}; only REQUESTED or NOT_REQUESTED_BY_POLICY are decidable here`,
          'DECISION',
        );
        return;
      }
    }
    ctx.decidedState = decided;
  };
}
