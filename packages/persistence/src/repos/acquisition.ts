/**
 * Evidence acquisition repository (§13.8, FR-DATA-003/005).
 *
 * Lifecycle ordering is enforced at this boundary AND structurally in SQL,
 * with per-rule attribution:
 * - randomized probes persist eligibility stratum, nonzero assignment
 *   probability, seed provenance, selection time, requested fields, and the
 *   decision impact BEFORE retrieval completion (AC-243) — enforced at this
 *   boundary;
 * - retrieval cannot complete without a prior probe assignment — enforced at
 *   this boundary;
 * - completion is one-way — completed decisions are never re-opened; the
 *   boundary guard refuses re-completion, while frozen counts hold by query
 *   construction (they are read through replay-resolved windows);
 * - historical evidence counts resolved through a replay boundary are frozen:
 *   later dependence estimates are stored DIAGNOSTIC_RETROSPECTIVE only and
 *   can never alter them (AC-247).
 */
import {
  AcquisitionState,
  ForesiftError,
  ErrorCode,
  acquisitionState,
  compareTimestamps,
  utcTimestamp,
  type EvidenceAcquisitionDecision,
  type ProbeAssignment,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

const LIFECYCLE_CODE = ErrorCode.ACQUISITION_WRITE_BEFORE_RETRIEVAL_VIOLATED;

export interface CreateDecisionInput {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly evidenceFamily: string;
  readonly policyVersion: string;
  readonly state: AcquisitionState;
  readonly requestedAt?: UtcTimestamp | undefined;
  readonly estimatedDecisionImpact?: number | undefined;
  readonly estimatedInformationValue?: number | undefined;
}

/** Open an acquisition record. Completion happens only via completeRetrieval. */
export async function recordAcquisitionDecision(
  engine: DatabaseEngine,
  input: CreateDecisionInput,
): Promise<void> {
  const state = acquisitionState(input.state);
  if (state === AcquisitionState.NOT_REQUESTED_BY_POLICY && input.requestedAt !== undefined) {
    throw new ForesiftError(
      LIFECYCLE_CODE,
      'NOT_REQUESTED_BY_POLICY carries no lifecycle timestamps',
      { decisionId: input.decisionId },
    );
  }
  if (
    input.estimatedDecisionImpact !== undefined &&
    (input.estimatedDecisionImpact < 0 || input.estimatedDecisionImpact > 1)
  ) {
    throw new ForesiftError(LIFECYCLE_CODE, 'decision impact must lie in [0,1]', {
      decisionId: input.decisionId,
    });
  }
  if (
    input.estimatedInformationValue !== undefined &&
    (input.estimatedInformationValue < 0 || input.estimatedInformationValue > 1)
  ) {
    throw new ForesiftError(LIFECYCLE_CODE, 'information value must lie in [0,1]', {
      decisionId: input.decisionId,
    });
  }
  await engine.query(
    `INSERT INTO evidence_acquisition_decisions (
       decision_id, candidate_id, evidence_family, policy_version, state,
       requested_at, estimated_decision_impact, estimated_information_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.decisionId,
      input.candidateId,
      input.evidenceFamily,
      input.policyVersion,
      state,
      input.requestedAt ?? null,
      input.estimatedDecisionImpact ?? null,
      input.estimatedInformationValue ?? null,
    ],
  );
}

export interface ProbeAssignmentInput {
  readonly decisionId: string;
  readonly assignment: ProbeAssignment;
  /** Decision impact fixed at selection time, stored BEFORE retrieval. */
  readonly estimatedDecisionImpact?: number | undefined;
}

/**
 * Persist the randomized-probe assignment (and impact) before any retrieval.
 * Assignments outside (0,1) are refusals — a probe that cannot be assigned
 * must not masquerade as randomization, and probability ≥ 1 is certainty,
 * not randomization.
 */
export async function recordProbeAssignment(
  engine: DatabaseEngine,
  input: ProbeAssignmentInput,
): Promise<void> {
  const { assignment } = input;
  if (!(assignment.assignmentProbability > 0)) {
    throw new ForesiftError(LIFECYCLE_CODE, 'assignment probability must be strictly positive', {
      decisionId: input.decisionId,
    });
  }
  if (assignment.assignmentProbability >= 1) {
    throw new ForesiftError(LIFECYCLE_CODE, 'assignment probability must be below 1', {
      decisionId: input.decisionId,
    });
  }
  await engine.transaction(async (tx) => {
    const decision = await tx.query<{ state: string; completed_at: string | null }>(
      'SELECT state, completed_at FROM evidence_acquisition_decisions WHERE decision_id = $1',
      [input.decisionId],
    );
    const d = decision.rows[0];
    if (d === undefined) {
      throw new ForesiftError(LIFECYCLE_CODE, `unknown decision ${input.decisionId}`, {});
    }
    if (d.completed_at !== null) {
      throw new ForesiftError(
        LIFECYCLE_CODE,
        'probe assignment cannot be recorded after retrieval completion',
        { decisionId: input.decisionId },
      );
    }
    await tx.query(
      `INSERT INTO probe_assignments (
         decision_id, eligibility_stratum, assignment_probability,
         seed_provenance, selection_at, requested_fields)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.decisionId,
        assignment.eligibilityStratum,
        assignment.assignmentProbability,
        assignment.seedProvenance,
        assignment.selectionAt,
        [...assignment.requestedFields],
      ],
    );
    await tx.query(
      `UPDATE evidence_acquisition_decisions
       SET assignment_probability = $2,
           estimated_decision_impact = COALESCE($3, estimated_decision_impact),
           impact_recorded_at = COALESCE(impact_recorded_at, $4)
       WHERE decision_id = $1`,
      [
        input.decisionId,
        assignment.assignmentProbability,
        input.estimatedDecisionImpact ?? null,
        assignment.selectionAt,
      ],
    );
  });
}

export interface RetrievalCompletionInput {
  readonly decisionId: string;
  readonly completedAt: UtcTimestamp;
  /** Terminal outcome state of the retrieval attempt. */
  readonly state: AcquisitionState;
  readonly evidenceIds?: readonly string[];
  readonly actualDecisionChanged?: boolean | undefined;
}

/**
 * Complete the retrieval. Refuses when no probe assignment was persisted
 * beforehand — retrieval without prior assignment is rejected, not patched up.
 */
export async function completeRetrieval(
  engine: DatabaseEngine,
  input: RetrievalCompletionInput,
): Promise<void> {
  const state = acquisitionState(input.state);
  await engine.transaction(async (tx) => {
    const rows = await tx.query<{
      requested_at: string | null;
      completed_at: string | null;
      assignment_probability: number | null;
      impact_recorded_at: string | null;
    }>(
      `SELECT requested_at, completed_at, assignment_probability, impact_recorded_at
       FROM evidence_acquisition_decisions WHERE decision_id = $1`,
      [input.decisionId],
    );
    const d = rows.rows[0];
    if (d === undefined) {
      throw new ForesiftError(LIFECYCLE_CODE, `unknown decision ${input.decisionId}`, {});
    }
    if (d.completed_at !== null) {
      throw new ForesiftError(
        LIFECYCLE_CODE,
        `decision ${input.decisionId} is already completed and is immutable`,
        { decisionId: input.decisionId },
      );
    }
    if (state === AcquisitionState.NOT_REQUESTED_BY_POLICY) {
      throw new ForesiftError(
        LIFECYCLE_CODE,
        'NOT_REQUESTED_BY_POLICY outcomes carry no retrieval completion',
        { decisionId: input.decisionId },
      );
    }
    if (d.requested_at === null) {
      throw new ForesiftError(
        LIFECYCLE_CODE,
        `decision ${input.decisionId} has no request timestamp to complete against`,
        { decisionId: input.decisionId },
      );
    }
    // AC-243: no retrieval without prior assignment (+ recorded impact).
    if (d.assignment_probability === null || d.impact_recorded_at === null) {
      const assigned = await tx.query<{ decision_id: string }>(
        'SELECT decision_id FROM probe_assignments WHERE decision_id = $1',
        [input.decisionId],
      );
      if (assigned.rows.length === 0) {
        throw new ForesiftError(
          ErrorCode.ACQUISITION_PROBE_ASSIGNMENT_MISSING,
          `retrieval refused: no probe assignment was recorded for ${input.decisionId} before retrieval`,
          { decisionId: input.decisionId },
        );
      }
      throw new ForesiftError(
        LIFECYCLE_CODE,
        `decision ${input.decisionId} has an assignment but no recorded decision impact`,
        { decisionId: input.decisionId },
      );
    }
    // Chronological compare by epoch ms — lexical `<` mis-orders ISO strings
    // with differing fractional precision (convention: recovery/backfill guards).
    if (
      d.requested_at !== null &&
      compareTimestamps(input.completedAt, utcTimestamp(toIso(d.requested_at))) < 0
    ) {
      throw new ForesiftError(
        LIFECYCLE_CODE,
        `completion precedes request for ${input.decisionId}`,
        { decisionId: input.decisionId },
      );
    }
    await tx.query(
      `UPDATE evidence_acquisition_decisions
       SET completed_at = $2, state = $3, evidence_ids = $4,
           actual_decision_changed = $5
       WHERE decision_id = $1`,
      [
        input.decisionId,
        input.completedAt,
        state,
        [...(input.evidenceIds ?? [])],
        input.actualDecisionChanged ?? null,
      ],
    );
  });
}

/** Domain-shaped view of a stored acquisition decision. */
export function toDomainDecision(row: {
  decision_id: string;
  candidate_id: string;
  evidence_family: string;
  policy_version: string;
  state: string;
  requested_at: string | null;
  completed_at: string | null;
  assignment_probability: number | null;
  estimated_decision_impact: number | null;
  estimated_information_value: number | null;
  actual_decision_changed: boolean | null;
  evidence_ids: string[];
}): EvidenceAcquisitionDecision {
  return {
    id: row.decision_id,
    candidateId: row.candidate_id,
    evidenceFamily: row.evidence_family,
    policyVersion: row.policy_version,
    state: acquisitionState(row.state),
    ...(row.requested_at === null ? {} : { requestedAt: toIso(row.requested_at) }),
    ...(row.completed_at === null ? {} : { completedAt: toIso(row.completed_at) }),
    ...(row.assignment_probability === null
      ? {}
      : { assignmentProbability: row.assignment_probability }),
    ...(row.estimated_decision_impact === null
      ? {}
      : { estimatedDecisionImpact: row.estimated_decision_impact }),
    ...(row.estimated_information_value === null
      ? {}
      : { estimatedInformationValue: row.estimated_information_value }),
    ...(row.actual_decision_changed === null
      ? {}
      : { actualDecisionChanged: row.actual_decision_changed }),
    evidenceIds: row.evidence_ids,
  };
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

// --- Frozen counts (AC-247) -------------------------------------------------

/**
 * Historical matured-evidence count resolved AT a replay boundary. Only
 * RETURNED decisions COMPLETED at or before t contribute. Later dependence
 * estimates are not consulted by construction — post-hoc knowledge cannot
 * reach into a resolved past.
 */
export async function maturedEvidenceCountAt(
  engine: DatabaseEngine,
  input: { candidateId: string; evidenceFamily?: string; t: UtcTimestamp },
): Promise<number> {
  const params: unknown[] = [input.candidateId, input.t];
  let familyClause = '';
  if (input.evidenceFamily !== undefined) {
    params.push(input.evidenceFamily);
    familyClause = 'AND evidence_family = $3';
  }
  const rows = await engine.query<{ n: string }>(
    `SELECT COUNT(DISTINCT evidence_id) AS n FROM evidence_acquisition_decisions,
            unnest(evidence_ids) AS evidence_id
     WHERE candidate_id = $1 AND state = 'RETURNED'
       AND completed_at IS NOT NULL AND completed_at <= $2 ${familyClause}`,
    params,
  );
  return Number(rows.rows[0]?.n ?? 0);
}
