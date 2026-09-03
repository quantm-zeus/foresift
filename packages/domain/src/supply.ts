/** Supply confidence and market-cap fallback policy (FR-SUP-001/002). */
import type { QualityCode } from './quality.ts';
import type { UtcTimestamp } from './timestamps.ts';

export interface ExcludedSupply {
  readonly category: string;
  readonly amount: string;
  readonly reason: string;
}

export interface MarketCapBasis {
  readonly priceSource: string;
  readonly price: string;
  readonly supply: string;
  readonly currency: string;
  readonly methodVersion: string;
}

export interface SupplyAssessment {
  readonly assessmentId: string;
  readonly assetId: string;
  readonly source: string;
  readonly method: string;
  readonly circulatingSupply: string;
  readonly excludedSupply: readonly ExcludedSupply[];
  readonly confidence: number;
  readonly exclusionEvidenceIds: readonly string[];
  readonly qualityCodes: readonly QualityCode[];
  readonly marketCapBasis: MarketCapBasis;
  readonly assessedAt: UtcTimestamp;
}

export interface MarketCapFallbackAvailability {
  readonly marketCapConfidence: number;
  readonly minimumConfidence: number;
  readonly approvedLiquidityFallback: boolean;
  readonly approvedActivityFallback: boolean;
}

/** False is the normative refusal to hard-reject on market cap alone. */
export function lowConfidenceMarketCapMayHardReject(
  input: MarketCapFallbackAvailability,
): boolean {
  assertConfidence(input.marketCapConfidence, 'marketCapConfidence');
  assertConfidence(input.minimumConfidence, 'minimumConfidence');
  if (input.marketCapConfidence >= input.minimumConfidence) return false;
  return !input.approvedLiquidityFallback && !input.approvedActivityFallback;
}

export function hasApprovedMarketCapFallback(input: MarketCapFallbackAvailability): boolean {
  return input.approvedLiquidityFallback || input.approvedActivityFallback;
}

function assertConfidence(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new RangeError(`${field} must lie in [0,1]`);
}
