/**
 * Point-in-time source-dependence persistence (FR-DATA-013/014/015).
 * Edge versions and their empirical inputs are append-only. A realizable
 * resolver sees only versions actually available at the historical boundary.
 */
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

export const DependenceEdgeMethod = {
  DECLARED_UPSTREAM: 'DECLARED_UPSTREAM',
  EMPIRICAL: 'EMPIRICAL',
} as const;
export type DependenceEdgeMethod =
  (typeof DependenceEdgeMethod)[keyof typeof DependenceEdgeMethod];

export interface EmpiricalDependenceSignals {
  readonly valueCorrelation: number;
  readonly errorCorrelation: number;
  readonly updateTimingCorrelation: number;
  readonly firstSeenTimingCorrelation: number;
  readonly outageOverlap: number;
  readonly schemaFingerprintSimilarity: number;
  readonly roundingFingerprintSimilarity: number;
  readonly commonMissingness: number;
  readonly knownUpstreamRelationship: boolean;
}

export interface DependenceEdgeWrite {
  readonly edgeId: string;
  readonly sourceA: string;
  readonly sourceB: string;
  readonly validFrom: UtcTimestamp;
  readonly validTo?: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly method: DependenceEdgeMethod;
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
  /** Pair contribution after dependence adjustment: 0..1, where 1 is independent. */
  readonly effectiveCreditMultiplier: number;
  readonly materialDependence: boolean;
}

export interface EmpiricalDependenceObservationWrite {
  readonly observationId: string;
  readonly edgeId: string;
  readonly observedThrough: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly sampleSize: number;
  readonly signals: EmpiricalDependenceSignals;
  readonly evidenceIds: readonly string[];
}

function bounded(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}

function canonicalPair(sourceA: string, sourceB: string): readonly [string, string] {
  if (sourceA.length === 0 || sourceB.length === 0 || sourceA === sourceB) {
    throw new RangeError('dependence edge requires two distinct non-empty sources');
  }
  return sourceA < sourceB ? [sourceA, sourceB] : [sourceB, sourceA];
}

function validateSignals(signals: EmpiricalDependenceSignals): void {
  for (const [name, value] of Object.entries(signals)) {
    if (name !== 'knownUpstreamRelationship') bounded(value as number, name);
  }
}

/** Monotone materiality score over every FR-DATA-014 signal family. */
export function empiricalDependenceScore(signals: EmpiricalDependenceSignals): number {
  validateSignals(signals);
  if (signals.knownUpstreamRelationship) return 1;
  return Math.max(
    signals.valueCorrelation,
    signals.errorCorrelation,
    signals.updateTimingCorrelation,
    signals.firstSeenTimingCorrelation,
    signals.outageOverlap,
    signals.schemaFingerprintSimilarity,
    signals.roundingFingerprintSimilarity,
    signals.commonMissingness,
  );
}

/** Material empirical dependence automatically loses pairwise credit. */
export function effectiveCreditMultiplierFor(
  signals: EmpiricalDependenceSignals,
  materialThreshold = 0.75,
): number {
  bounded(materialThreshold, 'materialThreshold');
  const score = empiricalDependenceScore(signals);
  return score >= materialThreshold ? 1 - score : 1;
}

export async function writeDependenceEdge(
  engine: DatabaseEngine,
  input: DependenceEdgeWrite,
): Promise<void> {
  const [sourceA, sourceB] = canonicalPair(input.sourceA, input.sourceB);
  bounded(input.confidence, 'confidence');
  bounded(input.effectiveCreditMultiplier, 'effectiveCreditMultiplier');
  if (input.evidenceIds.length === 0) throw new RangeError('dependence edge requires evidence');
  if (input.validTo !== undefined && Date.parse(input.validTo) <= Date.parse(input.validFrom)) {
    throw new RangeError('validTo must follow validFrom');
  }
  if (input.materialDependence && input.effectiveCreditMultiplier >= 1) {
    throw new RangeError('material dependence must reduce effective independence credit');
  }
  await engine.query(
    `INSERT INTO source_dependence_edge_versions (
       edge_id, source_a, source_b, valid_from, valid_to, available_at,
       method, evidence_ids, confidence, effective_credit_multiplier,
       material_dependence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.edgeId,
      sourceA,
      sourceB,
      input.validFrom,
      input.validTo ?? null,
      input.availableAt,
      input.method,
      [...input.evidenceIds],
      input.confidence,
      input.effectiveCreditMultiplier,
      input.materialDependence,
    ],
  );
}

export async function recordEmpiricalDependenceObservation(
  engine: DatabaseEngine,
  input: EmpiricalDependenceObservationWrite,
): Promise<void> {
  if (!Number.isInteger(input.sampleSize) || input.sampleSize <= 0) {
    throw new RangeError('sampleSize must be a positive integer');
  }
  validateSignals(input.signals);
  if (Date.parse(input.availableAt) < Date.parse(input.observedThrough)) {
    throw new RangeError('empirical observation cannot be available before its observation window');
  }
  await engine.query(
    `INSERT INTO source_dependence_empirical_observations (
       observation_id, edge_id, observed_through, available_at, sample_size,
       value_correlation, error_correlation, update_timing_correlation,
       first_seen_timing_correlation, outage_overlap,
       schema_fingerprint_similarity, rounding_fingerprint_similarity,
       common_missingness, known_upstream_relationship, evidence_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.observationId,
      input.edgeId,
      input.observedThrough,
      input.availableAt,
      input.sampleSize,
      input.signals.valueCorrelation,
      input.signals.errorCorrelation,
      input.signals.updateTimingCorrelation,
      input.signals.firstSeenTimingCorrelation,
      input.signals.outageOverlap,
      input.signals.schemaFingerprintSimilarity,
      input.signals.roundingFingerprintSimilarity,
      input.signals.commonMissingness,
      input.signals.knownUpstreamRelationship,
      [...input.evidenceIds],
    ],
  );
}

export type DependenceResolutionMode = 'REALIZABLE' | 'RETROSPECTIVE_DIAGNOSTIC';

export interface EffectiveCreditResolution {
  readonly resolvedAt: UtcTimestamp;
  readonly mode: DependenceResolutionMode;
  readonly rawSourceCount: number;
  readonly effectiveIndependentEvidenceCredit: number;
  readonly appliedEdgeIds: readonly string[];
}

interface EffectiveEdgeRow {
  edge_id: string;
  source_a: string;
  source_b: string;
  effective_credit_multiplier: number;
}

/**
 * ADR-3 point-in-time resolver. REALIZABLE has an availability predicate in
 * SQL itself (fail closed against future behavior); only an explicitly named
 * retrospective diagnostic mode may remove that predicate.
 */
export async function resolveEffectiveIndependenceCredit(
  engine: DatabaseEngine,
  input: {
    decisionAt: UtcTimestamp;
    sourceIds: readonly string[];
    mode?: DependenceResolutionMode;
  },
): Promise<EffectiveCreditResolution> {
  const decisionAt = utcTimestamp(String(input.decisionAt));
  const mode = input.mode ?? 'REALIZABLE';
  const sources = [...new Set(input.sourceIds)].sort();
  const rows = await engine.query<EffectiveEdgeRow>(
    `SELECT DISTINCT ON (source_a, source_b)
       edge_id, source_a, source_b, effective_credit_multiplier
     FROM source_dependence_edge_versions
     WHERE source_a = ANY($1::text[]) AND source_b = ANY($1::text[])
       AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)
       ${mode === 'REALIZABLE' ? 'AND available_at <= $2' : ''}
     ORDER BY source_a, source_b, available_at DESC, edge_id DESC`,
    [sources, decisionAt],
  );
  let credit = sources.length;
  for (const edge of rows.rows) {
    bounded(edge.effective_credit_multiplier, 'stored effectiveCreditMultiplier');
    credit -= 1 - edge.effective_credit_multiplier;
  }
  return {
    resolvedAt: decisionAt,
    mode,
    rawSourceCount: sources.length,
    effectiveIndependentEvidenceCredit: Math.max(0, credit),
    appliedEdgeIds: rows.rows.map((row) => row.edge_id),
  };
}

