import { marketCapMayHardReject, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { parseSupplySchema, type SupplyAssessment } from '@foresift/shared-schemas';

export interface PersistedSupplyAssessment extends SupplyAssessment {
  readonly assessmentId: string;
  readonly availableAt: UtcTimestamp;
}

/** Persist a complete §65.6 assessment; SQL immutability protects the audit row. */
export async function recordSupplyAssessment(
  engine: DatabaseEngine,
  input: PersistedSupplyAssessment,
): Promise<void> {
  const assessment = parseSupplySchema('SupplyAssessment', {
    assetRepresentationId: input.assetRepresentationId,
    asOf: input.asOf,
    totalSupplyRaw: input.totalSupplyRaw,
    ...(input.estimatedCirculatingSupplyRaw === undefined
      ? {}
      : { estimatedCirculatingSupplyRaw: input.estimatedCirculatingSupplyRaw }),
    ...(input.excludedSupplyRaw === undefined
      ? {}
      : { excludedSupplyRaw: input.excludedSupplyRaw }),
    source: input.source,
    method: input.method,
    confidence: input.confidence,
    exclusionEvidenceIds: input.exclusionEvidenceIds,
    qualityCodes: input.qualityCodes,
    marketCapBasis: input.marketCapBasis,
  });
  if (Date.parse(input.availableAt) < Date.parse(assessment.asOf)) {
    throw new RangeError('supply assessment cannot be available before its as-of time');
  }
  await engine.query(
    `INSERT INTO supply_assessments (
       assessment_id, asset_representation_id, as_of, total_supply_raw,
       estimated_circulating_supply_raw, excluded_supply_raw, source, method,
       confidence, exclusion_evidence_ids, quality_codes, market_cap_basis, available_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      input.assessmentId,
      assessment.assetRepresentationId,
      assessment.asOf,
      assessment.totalSupplyRaw,
      assessment.estimatedCirculatingSupplyRaw ?? null,
      assessment.excludedSupplyRaw ?? null,
      assessment.source,
      assessment.method,
      assessment.confidence,
      assessment.exclusionEvidenceIds,
      assessment.qualityCodes,
      assessment.marketCapBasis,
      input.availableAt,
    ],
  );
}

export async function loadSupplyAssessment(
  engine: DatabaseEngine,
  assessmentId: string,
): Promise<PersistedSupplyAssessment | undefined> {
  const result = await engine.query<{
    assessment_id: string;
    asset_representation_id: string;
    as_of: UtcTimestamp;
    total_supply_raw: string;
    estimated_circulating_supply_raw: string | null;
    excluded_supply_raw: string | null;
    source: string;
    method: string;
    confidence: number | string;
    exclusion_evidence_ids: string[];
    quality_codes: string[];
    market_cap_basis: SupplyAssessment['marketCapBasis'];
    available_at: UtcTimestamp;
  }>('SELECT * FROM supply_assessments WHERE assessment_id = $1', [assessmentId]);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    assessmentId: row.assessment_id,
    assetRepresentationId: row.asset_representation_id,
    asOf: row.as_of,
    totalSupplyRaw: row.total_supply_raw,
    ...(row.estimated_circulating_supply_raw === null
      ? {}
      : { estimatedCirculatingSupplyRaw: row.estimated_circulating_supply_raw }),
    ...(row.excluded_supply_raw === null ? {} : { excludedSupplyRaw: row.excluded_supply_raw }),
    source: row.source,
    method: row.method,
    confidence: Number(row.confidence),
    exclusionEvidenceIds: row.exclusion_evidence_ids,
    qualityCodes: row.quality_codes as SupplyAssessment['qualityCodes'],
    marketCapBasis: row.market_cap_basis,
    availableAt: row.available_at,
  };
}

export interface MarketCapFallbackGateInput {
  readonly decisionId: string;
  readonly assessmentId: string;
  readonly candidateId: string;
  readonly hardRejectRequested: boolean;
  readonly marketCapIsSoleHardRejection: boolean;
  readonly approvedLiquidityFallbackAvailable: boolean;
  readonly approvedActivityFallbackAvailable: boolean;
  readonly policyVersion: string;
  readonly decidedAt: UtcTimestamp;
}

export interface MarketCapFallbackGateResult {
  readonly hardRejected: boolean;
  readonly lowConfidenceMarketCap: boolean;
  readonly appliedFallback: 'LIQUIDITY' | 'ACTIVITY' | null;
  readonly outcome: 'ALLOWED' | 'FALLBACK_APPROVED' | 'HARD_REJECTED';
  readonly rationale: string;
}

/**
 * Apply FR-SUP-002 and persist the outcome atomically with assessment lookup.
 * A refused market-cap rejection returns a fallback outcome; it never escapes
 * without its audit row.
 */
export async function evaluateMarketCapFallbackGate(
  engine: DatabaseEngine,
  input: MarketCapFallbackGateInput,
): Promise<MarketCapFallbackGateResult> {
  return engine.transaction(async (tx) => {
    const assessment = await loadSupplyAssessment(tx, input.assessmentId);
    if (assessment === undefined) throw new RangeError(`unknown assessment ${input.assessmentId}`);
    const anyFallback =
      input.approvedLiquidityFallbackAvailable || input.approvedActivityFallbackAvailable;
    // With an approved fallback=true, the domain predicate returns false only
    // for low-confidence assessments. This keeps the threshold centralized.
    const lowConfidenceMarketCap = !marketCapMayHardReject(assessment, true);
    const mayRejectForMarketCap = marketCapMayHardReject(assessment, anyFallback);
    const refuseSoleMarketCapRejection =
      input.hardRejectRequested && input.marketCapIsSoleHardRejection && !mayRejectForMarketCap;
    const hardRejected = input.hardRejectRequested && !refuseSoleMarketCapRejection;
    const appliedFallback = refuseSoleMarketCapRejection
      ? input.approvedLiquidityFallbackAvailable
        ? 'LIQUIDITY'
        : 'ACTIVITY'
      : null;
    const outcome = hardRejected
      ? 'HARD_REJECTED'
      : appliedFallback === null
        ? 'ALLOWED'
        : 'FALLBACK_APPROVED';
    const rationale = refuseSoleMarketCapRejection
      ? `LOW_CONFIDENCE_MARKET_CAP_REFUSED:${appliedFallback}`
      : hardRejected
        ? 'HARD_REJECTION_PERMITTED'
        : 'NO_HARD_REJECTION_REQUESTED';
    await tx.query(
      `INSERT INTO market_cap_fallback_decisions (
         decision_id, assessment_id, candidate_id, low_confidence_market_cap,
         hard_rejected, market_cap_is_sole_hard_rejection,
         approved_liquidity_fallback_available,
         approved_activity_fallback_available, applied_fallback,
         policy_version, decided_at, rationale)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        input.decisionId,
        input.assessmentId,
        input.candidateId,
        lowConfidenceMarketCap,
        hardRejected,
        input.marketCapIsSoleHardRejection,
        input.approvedLiquidityFallbackAvailable,
        input.approvedActivityFallbackAvailable,
        appliedFallback,
        input.policyVersion,
        input.decidedAt,
        rationale,
      ],
    );
    return { hardRejected, lowConfidenceMarketCap, appliedFallback, outcome, rationale };
  });
}

export const applyMarketCapFallbackGate = evaluateMarketCapFallbackGate;
