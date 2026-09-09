/** §19.10 derived-feature lineage and point-in-time claim-support laws. */
import { supportsPopulationClaim, type FeatureValue } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export const FeatureLineageErrorCode = {
  INCOMPLETE: 'SIG_LINEAGE_INCOMPLETE',
  INVALID_REPLAY_BOUNDARY: 'SIG_LINEAGE_INVALID_REPLAY_BOUNDARY',
} as const;

export class FeatureLineageError extends Error {
  readonly code: (typeof FeatureLineageErrorCode)[keyof typeof FeatureLineageErrorCode];

  constructor(
    code: (typeof FeatureLineageErrorCode)[keyof typeof FeatureLineageErrorCode],
    message: string,
  ) {
    super(message);
    this.name = 'FeatureLineageError';
    this.code = code;
  }
}

export interface SignalFeatureLineage {
  readonly lineageId: string;
  readonly featureId: string;
  readonly featureVersion: number;
  readonly entityId: string;
  readonly profileId: string;
  readonly windowStart?: string;
  readonly windowEnd: string;
  readonly inputObservationIds: readonly string[];
  readonly inputEvidenceIds: readonly string[];
  readonly inputHashes: readonly string[];
  readonly calculationCodeVersion: string;
  readonly calculatedAt: string;
  readonly qualityCodes: readonly string[];
  /** Replay boundary T against which every required input was resolved. */
  readonly eventTimeResolvedAt: string;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;

function timestamp(value: string): number {
  return Date.parse(value);
}

export function assertFeatureLineageComplete(lineage: SignalFeatureLineage): void {
  const references = lineage.inputObservationIds.length + lineage.inputEvidenceIds.length;
  if (
    lineage.lineageId.trim().length === 0 ||
    lineage.featureId.trim().length === 0 ||
    !Number.isInteger(lineage.featureVersion) ||
    lineage.featureVersion < 1 ||
    lineage.entityId.trim().length === 0 ||
    lineage.profileId.trim().length === 0 ||
    references === 0 ||
    lineage.inputHashes.length === 0 ||
    lineage.inputHashes.some((hash) => !SHA256.test(hash)) ||
    lineage.calculationCodeVersion.trim().length === 0
  ) {
    throw new FeatureLineageError(
      FeatureLineageErrorCode.INCOMPLETE,
      `lineage ${lineage.lineageId || '<missing>'} does not identify and hash every required input`,
    );
  }
  const windowStart =
    lineage.windowStart === undefined ? undefined : timestamp(lineage.windowStart);
  const windowEnd = timestamp(lineage.windowEnd);
  const calculatedAt = timestamp(lineage.calculatedAt);
  const resolvedAt = timestamp(lineage.eventTimeResolvedAt);
  if (
    !Number.isFinite(windowEnd) ||
    !Number.isFinite(calculatedAt) ||
    !Number.isFinite(resolvedAt) ||
    (windowStart !== undefined && (!Number.isFinite(windowStart) || windowStart >= windowEnd)) ||
    resolvedAt > calculatedAt
  ) {
    throw new FeatureLineageError(
      FeatureLineageErrorCode.INVALID_REPLAY_BOUNDARY,
      `lineage ${lineage.lineageId} has invalid event/window or replay-boundary ordering`,
    );
  }
}

export async function recordFeatureLineage(
  engine: DatabaseEngine,
  lineage: SignalFeatureLineage,
): Promise<void> {
  assertFeatureLineageComplete(lineage);
  await engine.query(
    `INSERT INTO sig.feature_lineage (
       lineage_id, feature_id, feature_version, entity_id, profile_id,
       window_start, window_end, input_observation_ids, input_evidence_ids,
       input_hashes, calculation_code_version, calculated_at, quality_codes,
       event_time_resolved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      lineage.lineageId,
      lineage.featureId,
      lineage.featureVersion,
      lineage.entityId,
      lineage.profileId,
      lineage.windowStart ?? null,
      lineage.windowEnd,
      [...lineage.inputObservationIds],
      [...lineage.inputEvidenceIds],
      [...lineage.inputHashes],
      lineage.calculationCodeVersion,
      lineage.calculatedAt,
      [...lineage.qualityCodes],
      lineage.eventTimeResolvedAt,
    ],
  );
}

export interface ClaimLineageInput {
  readonly lineage?: SignalFeatureLineage;
  readonly decisionTime: string;
  readonly requiredInputObservationIds: readonly string[];
  readonly requiredInputEvidenceIds: readonly string[];
  /** Availability time for each required input id. Missing entries fail closed. */
  readonly inputAvailableAt: Readonly<Record<string, string>>;
}

/** Returns false for missing or hindsight-only inputs; malformed lineage is never claim support. */
export function lineageSupportsClaim(input: ClaimLineageInput): boolean {
  const { lineage } = input;
  if (lineage === undefined) return false;
  try {
    assertFeatureLineageComplete(lineage);
  } catch {
    return false;
  }
  const decisionTime = timestamp(input.decisionTime);
  const resolvedAt = timestamp(lineage.eventTimeResolvedAt);
  if (
    !Number.isFinite(decisionTime) ||
    resolvedAt > decisionTime ||
    timestamp(lineage.calculatedAt) > decisionTime
  ) {
    return false;
  }
  const observations = new Set(lineage.inputObservationIds);
  const evidence = new Set(lineage.inputEvidenceIds);
  const required = [
    ...input.requiredInputObservationIds.map((id) => [id, observations] as const),
    ...input.requiredInputEvidenceIds.map((id) => [id, evidence] as const),
  ];
  return required.every(([id, recorded]) => {
    const availableAt = input.inputAvailableAt[id];
    return (
      recorded.has(id) &&
      availableAt !== undefined &&
      Number.isFinite(timestamp(availableAt)) &&
      timestamp(availableAt) <= resolvedAt
    );
  });
}

/** Extends the G0 population-provenance seam with §19.10 lineage visibility. */
export function supportsSignalPopulationClaim(
  value: FeatureValue,
  lineageInput: ClaimLineageInput,
): boolean {
  return (
    lineageInput.lineage !== undefined &&
    value.populationProvenance.lineageRefs.includes(lineageInput.lineage.lineageId) &&
    supportsPopulationClaim(value) &&
    lineageSupportsClaim(lineageInput)
  );
}
