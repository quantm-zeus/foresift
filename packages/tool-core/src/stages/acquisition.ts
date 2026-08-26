/**
 * Pipeline stage 5 (FR-CORE-002, FR-CORE-003; PRD §16.2): persist REQUESTED
 * or the applicable pre-execution blocked/not-requested state through the
 * landed acquisition repository BEFORE any external request exists. The
 * exact vocabulary — NOT_REQUESTED_BY_POLICY / COST_BLOCKED / QUOTA_BLOCKED /
 * CAPABILITY_UNAVAILABLE / RIGHTS_BLOCKED vs the retrieval-failure states —
 * stays distinguishable in storage (AC-242 substrate).
 *
 * Idempotent under retry (INV-009): the decision id derives from the run id,
 * an already-persisted identical decision converges instead of erroring.
 */
import { AcquisitionState } from '@foresift/domain';
import type { UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { recordAcquisitionDecision, recordProbeAssignment } from '@foresift/persistence';
import type { ToolRunContext } from '../run-context.ts';

export interface AcquisitionStageDeps {
  readonly engine: DatabaseEngine;
  /** Policy version stamped on persisted decisions. */
  readonly policyVersion: string;
  /**
   * Deterministic probe assignment for the data-truth lifecycle (AC-243:
   * assignment + impact exist BEFORE any retrieval). Composition supplies
   * it; the default is a fixed-stratum deterministic assignment.
   */
  readonly probeAssignment?:
    | ((ctx: ToolRunContext) => {
        readonly eligibilityStratum: string;
        readonly assignmentProbability: number;
        readonly seedProvenance: string;
        readonly requestedFields: readonly string[];
      })
    | undefined;
  readonly now: () => UtcTimestamp;
}

const DEFAULT_PROBE = {
  eligibilityStratum: 'tool-core-default',
  assignmentProbability: 0.5,
  seedProvenance: 'seed/tool-core-default-v1',
};

/** Stage 5 — PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE. */
export function makePersistRequestedStage(deps: AcquisitionStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    const decisionId = ctx.request.acquisitionDecision?.decisionId ?? `dec-${ctx.runId}`;
    ctx.acquisitionDecisionId = decisionId;

    const state = ctx.blocked?.state ?? ctx.decidedState ?? 'REQUESTED';
    const policyNotRequested = state === AcquisitionState.NOT_REQUESTED_BY_POLICY;

    // Retry convergence: an existing decision for this run id is never
    // re-inserted; its stored state must match or the retry is a different
    // logical call wearing a reused key — refused loudly.
    const existing = await deps.engine.query<{
      decision_id: string;
      state: string;
      requested_at: string | null;
    }>(
      'SELECT decision_id, state, requested_at FROM evidence_acquisition_decisions WHERE decision_id = $1',
      [decisionId],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      const retryOfRequested = state === AcquisitionState.REQUESTED && row.requested_at !== null;
      if (row.state !== state && !retryOfRequested) {
        throw new Error(
          `acquisition retry divergence: ${decisionId} persisted as ${existing.rows[0]!.state}, retry proposes ${state}`,
        );
      }
      ctx.requestedAtPersisted = row.requested_at !== null;
      ctx.outcomeState = row.state;
      return;
    }

    // Pre-execution blocks and not-requested carry NO request timestamp and
    // NO probe lifecycle: no external request existed to timestamp.
    const isPreExecutionBlock = ctx.blocked !== undefined;
    await recordAcquisitionDecision(deps.engine, {
      decisionId,
      candidateId: ctx.request.canonicalEntityIdentity,
      evidenceFamily:
        ctx.request.acquisitionDecision?.evidenceFamily ??
        ctx.route?.operation ??
        ctx.request.toolName,
      policyVersion: ctx.request.acquisitionDecision?.policyVersion ?? deps.policyVersion,
      state,
      ...(ctx.request.acquisitionDecision?.estimatedDecisionImpact !== undefined
        ? { estimatedDecisionImpact: ctx.request.acquisitionDecision.estimatedDecisionImpact }
        : {}),
      ...(ctx.request.acquisitionDecision?.estimatedInformationValue !== undefined
        ? { estimatedInformationValue: ctx.request.acquisitionDecision.estimatedInformationValue }
        : {}),
      ...(policyNotRequested || isPreExecutionBlock ? {} : { requestedAt: deps.now() }),
    });

    // REQUESTED decisions get their randomized-probe assignment + impact
    // BEFORE retrieval so stage 22 can complete lawfully (AC-243).
    if (!policyNotRequested && !isPreExecutionBlock) {
      ctx.requestedAtPersisted = true;
      const probe = deps.probeAssignment?.(ctx) ?? DEFAULT_PROBE;
      await recordProbeAssignment(deps.engine, {
        decisionId,
        assignment: {
          eligibilityStratum: probe.eligibilityStratum,
          assignmentProbability: probe.assignmentProbability,
          seedProvenance: probe.seedProvenance,
          selectionAt: deps.now(),
          requestedFields: [
            ...(ctx.request.acquisitionDecision?.requestedFields ??
              ctx.request.fieldProjection ??
              ctx.route?.fieldProjection ?? ['default']),
          ],
        },
        estimatedDecisionImpact: ctx.request.acquisitionDecision?.estimatedDecisionImpact ?? 0.1,
      });
    }
  };
}
