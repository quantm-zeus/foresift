/**
 * Pipeline stage 5 (FR-CORE-002, FR-CORE-003; PRD §16.2 preamble; AC-242
 * substrate): persist REQUESTED or the applicable pre-execution
 * blocked/not-requested state through the landed acquisition repo BEFORE any
 * external request.
 *
 * The state set is exactly `@foresift/domain`'s AcquisitionState vocabulary;
 * NOT_REQUESTED_BY_POLICY / COST_BLOCKED / QUOTA_BLOCKED /
 * CAPABILITY_UNAVAILABLE / RIGHTS_BLOCKED stay distinguishable from retrieval
 * failures because they are persisted as the OPENING record — never as a
 * retrieval outcome dressed up after the fact. On the REQUESTED path the
 * randomized-probe assignment and decision impact are also recorded here so
 * no retrieval can complete without prior probe metadata (AC-243).
 */
import { AcquisitionState } from '@foresift/domain';
import {
  recordAcquisitionDecision,
  recordProbeAssignment,
} from '@foresift/persistence';
import type { DatabaseEngine } from '@foresift/persistence';
import type { ToolCallContext } from '../run-context.ts';

/** Stage 5 — persist REQUESTED or the applicable pre-execution state. */
export async function persistPreExecutionState(
  ctx: ToolCallContext,
  engine: DatabaseEngine,
): Promise<void> {
  // A retrieval-path completion may already have been requested? No — stage 5
  // runs before retrieval; an exit recorded earlier routes HERE when the exit
  // carries a genuine acquisition-level block.
  const exit = ctx.exit;

  if (exit !== null && !exit.persistAcquisitionRow) return;
  if (ctx.entry === null) return;

  const at = ctx.now();
  const decision = ctx.acquisitionDecision;
  const policyVersion =
    decision?.policyVersion ?? ctx.licenseVerdict?.policyVersion ?? 'core-unversioned';

  if (exit !== null) {
    // Pre-execution blocked / not-requested: the opening record IS the
    // terminal policy verdict. No lifecycle timestamps ride on it.
    await recordAcquisitionDecision(engine, {
      decisionId: ctx.decisionId,
      candidateId: `${ctx.entry.metadata.name}:${ctx.canonicalEntityIdentity}`,
      evidenceFamily: operationOf(ctx),
      policyVersion,
      state: exit.payload.acquisitionState,
    });
    ctx.acquisitionPersistedAs = exit.payload.acquisitionState;
    return;
  }

  await recordAcquisitionDecision(engine, {
    decisionId: ctx.decisionId,
    candidateId: `${ctx.entry.metadata.name}:${ctx.canonicalEntityIdentity}`,
    evidenceFamily: operationOf(ctx),
    policyVersion,
    state: AcquisitionState.REQUESTED,
    requestedAt: at,
    estimatedDecisionImpact:
      decision?.estimatedDecisionImpact ?? /* fixture-grade default */ 0.5,
  });
  // AC-243 substrate: probe metadata + impact BEFORE any retrieval.
  await recordProbeAssignment(engine, {
    decisionId: ctx.decisionId,
    assignment: {
      eligibilityStratum: ctx.request.workloadClass,
      assignmentProbability: decision?.assignmentProbability ?? 0.5,
      seedProvenance: `core/pipeline/${ctx.runId}`,
      selectionAt: at,
      requestedFields: [...(ctx.request.fieldProjection ?? [])],
    },
    estimatedDecisionImpact: decision?.estimatedDecisionImpact ?? 0.5,
  });
  ctx.acquisitionPersistedAs = AcquisitionState.REQUESTED;
}

/**
 * True when stage 22 may complete the retrieval for this run: only rows
 * OPENED as REQUESTED carry a request timestamp + probe assignment, which is
 * what the acquisition repo's completion boundary demands. Rows opened as a
 * pre-execution blocked/not-requested state are already terminal policy
 * verdicts and are never completed.
 */
export function canCompleteRetrieval(ctx: ToolCallContext): boolean {
  return ctx.acquisitionPersistedAs === AcquisitionState.REQUESTED;
}

function operationOf(ctx: ToolCallContext): string {
  return ctx.request.operation ?? ctx.request.toolName;
}
