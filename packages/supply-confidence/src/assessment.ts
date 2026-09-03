import type { SupplyAssessment } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export async function recordSupplyAssessment(
  engine: DatabaseEngine,
  assessment: SupplyAssessment,
): Promise<void> {
  if (!DECIMAL.test(assessment.circulatingSupply))
    throw new Error('circulatingSupply must be a canonical nonnegative decimal');
  if (!Number.isFinite(assessment.confidence) || assessment.confidence < 0 || assessment.confidence > 1)
    throw new RangeError('supply confidence must lie in [0,1]');
  for (const excluded of assessment.excludedSupply) {
    if (!DECIMAL.test(excluded.amount))
      throw new Error(`excluded supply ${excluded.category} must be a canonical nonnegative decimal`);
  }
  await engine.query(
    `INSERT INTO supply_assessments (
       assessment_id, asset_id, source, method, circulating_supply,
       excluded_supply, confidence, exclusion_evidence_ids, quality_codes,
       market_cap_basis, assessed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      assessment.assessmentId,
      assessment.assetId,
      assessment.source,
      assessment.method,
      assessment.circulatingSupply,
      assessment.excludedSupply,
      assessment.confidence,
      [...assessment.exclusionEvidenceIds],
      [...assessment.qualityCodes],
      assessment.marketCapBasis,
      assessment.assessedAt,
    ],
  );
}

export async function getSupplyAssessment(
  engine: DatabaseEngine,
  assessmentId: string,
): Promise<SupplyAssessment | null> {
  const result = await engine.query<Record<string, unknown>>(
    'SELECT * FROM supply_assessments WHERE assessment_id = $1',
    [assessmentId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    assessmentId: row.assessment_id as string,
    assetId: row.asset_id as string,
    source: row.source as string,
    method: row.method as string,
    circulatingSupply: row.circulating_supply as string,
    excludedSupply: row.excluded_supply as SupplyAssessment['excludedSupply'],
    confidence: Number(row.confidence),
    exclusionEvidenceIds: row.exclusion_evidence_ids as string[],
    qualityCodes: row.quality_codes as SupplyAssessment['qualityCodes'],
    marketCapBasis: row.market_cap_basis as SupplyAssessment['marketCapBasis'],
    assessedAt: new Date(row.assessed_at as string).toISOString() as SupplyAssessment['assessedAt'],
  };
}
