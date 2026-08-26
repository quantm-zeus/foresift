/**
 * Pipeline stages 3–4 (FR-CORE-002; PRD §16.2; ADR-0013):
 *
 *   3. validate and canonicalize input
 *   4. validate the deterministic acquisition decision and exact
 *      authorization envelope
 *
 * Input validation runs THE authoritative Zod schema bound on the registered
 * definition (fail-closed: a definition without a bound input schema refuses),
 * then canonicalizes through canonical JSON so every later stage sees one
 * stable byte form. Stage 4 re-derives the upstream acquisition decision's
 * determinism surface and checks the exact authorization envelope before any
 * state is written.
 */
import { canonicalJson } from '@foresift/persistence';
import { sha256Text } from '@foresift/persistence';
import { block, exited, type ToolCallContext } from '../run-context.ts';

function refuse(ctx: ToolCallContext, reason: string): void {
  block(ctx, {
    payload: {
      acquisitionState: 'CAPABILITY_UNAVAILABLE',
      machineReason: reason,
      toolName: ctx.request.toolName,
      toolVersion: ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown',
      pipelineRunId: ctx.runId,
      at: ctx.now(),
    },
    auditOutcome: 'BLOCKED',
    // A call whose input never validated has no well-formed acquisition
    // target — nothing is persisted to the acquisition repo.
    persistAcquisitionRow: false,
  });
}

/** Stage 3 — validate and canonicalize input against the bound Zod schema. */
export function validateAndCanonicalizeInput(ctx: ToolCallContext): void {
  if (exited(ctx)) return;
  const schema = ctx.entry?.inputSchema;
  if (schema === undefined) {
    refuse(
      ctx,
      'INPUT_SCHEMA_UNBOUND:definition carries no input schema; refusing fail-closed',
    );
    return;
  }
  const parsed = schema.safeParse(ctx.request.input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    refuse(
      ctx,
      `INPUT_SCHEMA_INVALID:${issue?.path.join('.') ?? '<root>'} ${issue?.message ?? 'failed validation'}`,
    );
    return;
  }
  // Canonicalize: key-sorted canonical JSON round-trip gives every downstream
  // stage (cache keys, fingerprints, evidence) ONE stable byte form.
  ctx.canonicalInput = JSON.parse(canonicalJson(parsed.data));

  // Canonical entity identity: explicit request data wins; otherwise it is
  // deterministically derived from the canonicalized arguments.
  ctx.canonicalEntityIdentity =
    ctx.request.canonicalEntityIdentity ??
    `input-derived:${sha256Text(canonicalJson(parsed.data))}`;
}

/** Stage 4 — deterministic acquisition decision + exact authorization envelope. */
export function validateAcquisitionDecisionAndEnvelope(ctx: ToolCallContext): void {
  if (exited(ctx)) return;

  // Exact authorization envelope: every fact stage 2 authorized must still be
  // attached and internally consistent (defense in depth against drift).
  if (ctx.actor === null || ctx.entry === null || ctx.licenseVerdict === null) {
    refuse(ctx, 'AUTHORIZATION_ENVELOPE_INCOMPLETE:actor, entry, and license verdict required');
    return;
  }

  const decision = ctx.request.acquisitionDecision;
  if (decision !== undefined) {
    // Deterministic-decision validation: known action, non-empty policy
    // version and reason. The decision is DATA from upstream policy (INV-002)
    // — the pipeline verifies structure and consistency, never invents one.
    if (decision.action !== 'REQUEST' && decision.action !== 'NOT_REQUESTED') {
      refuse(ctx, 'ACQUISITION_DECISION_INVALID:unknown action');
      return;
    }
    if (decision.policyVersion.length === 0 || decision.reason.length === 0) {
      refuse(ctx, 'ACQUISITION_DECISION_INVALID:policy version and reason are required');
      return;
    }
    if (
      decision.assignmentProbability !== undefined &&
      !(decision.assignmentProbability > 0 && decision.assignmentProbability < 1)
    ) {
      refuse(ctx, 'ACQUISITION_DECISION_INVALID:assignment probability outside (0,1)');
      return;
    }
    if (
      decision.estimatedDecisionImpact !== undefined &&
      !(decision.estimatedDecisionImpact >= 0 && decision.estimatedDecisionImpact <= 1)
    ) {
      refuse(ctx, 'ACQUISITION_DECISION_INVALID:decision impact outside [0,1]');
      return;
    }
    ctx.acquisitionDecision = decision;
    if (decision.action === 'NOT_REQUESTED') {
      block(ctx, {
        payload: {
          acquisitionState: 'NOT_REQUESTED_BY_POLICY',
          machineReason: `NOT_REQUESTED_BY_POLICY:${decision.policyVersion}:${decision.reason}`,
          toolName: ctx.entry.metadata.name,
          toolVersion: ctx.entry.metadata.version,
          pipelineRunId: ctx.runId,
          at: ctx.now(),
        },
        auditOutcome: 'BLOCKED',
        persistAcquisitionRow: true,
      });
    }
  }
}
