/** Immutable candidate decision timelines (FR-DATA-009, AC-240). */
import {
  assertDecisionTimeline,
  utcTimestamp,
  type CandidateDecisionTimeline,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

export async function recordDecisionTimeline(
  engine: DatabaseEngine,
  input: CandidateDecisionTimeline,
): Promise<void> {
  assertDecisionTimeline(input);
  const nonDelivered = input.deliveredAt === null;
  await engine.query(
    `INSERT INTO candidate_decision_timelines (
       decision_id, candidate_id, decision_ready_at, policy_decided_at,
       workflow_completed_at, delivery_eligible_at, delivered_at,
       counterfactual_delivery_at, counterfactual_delivery_version,
       comparison_entry_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.decisionId,
      input.candidateId,
      input.decisionReadyAt,
      input.policyDecidedAt,
      input.workflowCompletedAt,
      input.deliveryEligibleAt,
      input.deliveredAt,
      nonDelivered ? input.counterfactualDeliveryAt : null,
      nonDelivered ? input.counterfactualDeliveryVersion : null,
      nonDelivered ? input.comparisonEntryAt : null,
    ],
  );
}

export async function decisionTimeline(
  engine: DatabaseEngine,
  decisionId: string,
): Promise<CandidateDecisionTimeline | null> {
  const result = await engine.query<Record<string, unknown>>(
    'SELECT * FROM candidate_decision_timelines WHERE decision_id = $1',
    [decisionId],
  );
  const row = result.rows[0] as any;
  if (row === undefined) return null;
  const common = {
    decisionId: row.decision_id as string,
    candidateId: row.candidate_id as string,
    decisionReadyAt: utcTimestamp(new Date(row.decision_ready_at as string).toISOString()),
    policyDecidedAt: utcTimestamp(new Date(row.policy_decided_at as string).toISOString()),
    workflowCompletedAt: utcTimestamp(new Date(row.workflow_completed_at as string).toISOString()),
    deliveryEligibleAt: utcTimestamp(new Date(row.delivery_eligible_at as string).toISOString()),
  };
  if (row.delivered_at !== null) {
    return {
      ...common,
      deliveredAt: utcTimestamp(new Date(row.delivered_at as string).toISOString()),
    };
  }
  return {
    ...common,
    deliveredAt: null,
    counterfactualDeliveryAt: utcTimestamp(
      new Date(row.counterfactual_delivery_at as string).toISOString(),
    ),
    counterfactualDeliveryVersion: row.counterfactual_delivery_version as string,
    comparisonEntryAt: utcTimestamp(new Date(row.comparison_entry_at as string).toISOString()),
  };
}
