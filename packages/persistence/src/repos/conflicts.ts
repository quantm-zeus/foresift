/** Append-only provider conflicts preserving every raw observation (FR-DATA-016). */
import type { UtcTimestamp } from '@foresift/domain';
import { canonicalJson, sha256Text } from '../canonical-json.ts';
import type { DatabaseEngine } from '../db.ts';

export const ProviderConflictClassification = {
  BENIGN_LATENCY_OR_ROUNDING_VARIANCE: 'BENIGN_LATENCY_OR_ROUNDING_VARIANCE',
  COMMON_UPSTREAM_DUPLICATION: 'COMMON_UPSTREAM_DUPLICATION',
  MATERIAL_DISAGREEMENT: 'MATERIAL_DISAGREEMENT',
  UNRESOLVED_DECISION_CRITICAL_CONFLICT: 'UNRESOLVED_DECISION_CRITICAL_CONFLICT',
} as const;
export type ProviderConflictClassification =
  (typeof ProviderConflictClassification)[keyof typeof ProviderConflictClassification];

export interface RawConflictObservation {
  readonly observationId: string;
  readonly sourceId: string;
  readonly observedAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly fieldPath: string;
  readonly rawValue: unknown;
}

export interface ProviderConflictWrite {
  readonly conflictId: string;
  readonly subjectKey: string;
  readonly classification: ProviderConflictClassification;
  readonly decisionCritical: boolean;
  readonly classifiedAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly evidenceIds: readonly string[];
  readonly observations: readonly RawConflictObservation[];
}

/** One atomic append: the classification and all originals survive together. */
export async function appendProviderConflict(
  engine: DatabaseEngine,
  input: ProviderConflictWrite,
): Promise<void> {
  if (input.observations.length < 2) {
    throw new RangeError('provider conflict requires at least two raw observations');
  }
  if (
    input.classification === ProviderConflictClassification.UNRESOLVED_DECISION_CRITICAL_CONFLICT &&
    !input.decisionCritical
  ) {
    throw new RangeError('unresolved decision-critical classification must be decision critical');
  }
  if (Date.parse(input.availableAt) < Date.parse(input.classifiedAt)) {
    throw new RangeError('conflict cannot be available before it was classified');
  }
  await engine.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO provider_conflicts (
         conflict_id, subject_key, classification, decision_critical,
         classified_at, available_at, evidence_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.conflictId,
        input.subjectKey,
        input.classification,
        input.decisionCritical,
        input.classifiedAt,
        input.availableAt,
        [...input.evidenceIds],
      ],
    );
    for (const observation of input.observations) {
      const rawJson = canonicalJson(observation.rawValue);
      await tx.query(
        `INSERT INTO provider_conflict_observations (
           conflict_id, observation_id, source_id, observed_at, available_at,
           field_path, raw_value, raw_value_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [
          input.conflictId,
          observation.observationId,
          observation.sourceId,
          observation.observedAt,
          observation.availableAt,
          observation.fieldPath,
          rawJson,
          sha256Text(rawJson),
        ],
      );
    }
  });
}

export interface StoredProviderConflict extends ProviderConflictWrite {}

/** Historical conflict view; future classifications and observations cannot leak in. */
export async function providerConflictsAt(
  engine: DatabaseEngine,
  decisionAt: UtcTimestamp,
  subjectKey?: string,
): Promise<readonly StoredProviderConflict[]> {
  const conflictRows = await engine.query<{
    conflict_id: string;
    subject_key: string;
    classification: ProviderConflictClassification;
    decision_critical: boolean;
    classified_at: UtcTimestamp;
    available_at: UtcTimestamp;
    evidence_ids: string[];
  }>(
    `SELECT conflict_id, subject_key, classification, decision_critical,
            classified_at, available_at, evidence_ids
     FROM provider_conflicts
     WHERE available_at <= $1 ${subjectKey === undefined ? '' : 'AND subject_key = $2'}
     ORDER BY available_at, conflict_id`,
    subjectKey === undefined ? [decisionAt] : [decisionAt, subjectKey],
  );
  const output: StoredProviderConflict[] = [];
  for (const conflict of conflictRows.rows) {
    const observations = await engine.query<{
      observation_id: string;
      source_id: string;
      observed_at: UtcTimestamp;
      available_at: UtcTimestamp;
      field_path: string;
      raw_value: unknown;
    }>(
      `SELECT observation_id, source_id, observed_at, available_at, field_path, raw_value
       FROM provider_conflict_observations
       WHERE conflict_id = $1 AND available_at <= $2
       ORDER BY observation_id`,
      [conflict.conflict_id, decisionAt],
    );
    output.push({
      conflictId: conflict.conflict_id,
      subjectKey: conflict.subject_key,
      classification: conflict.classification,
      decisionCritical: conflict.decision_critical,
      classifiedAt: conflict.classified_at,
      availableAt: conflict.available_at,
      evidenceIds: conflict.evidence_ids,
      observations: observations.rows.map((row) => ({
        observationId: row.observation_id,
        sourceId: row.source_id,
        observedAt: row.observed_at,
        availableAt: row.available_at,
        fieldPath: row.field_path,
        rawValue: row.raw_value,
      })),
    });
  }
  return output;
}
