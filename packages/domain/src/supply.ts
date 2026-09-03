import type { QualityCode } from './quality.ts';

export const SupplyMethod = {
  TOTAL: 'TOTAL',
  PROVIDER_CIRCULATING: 'PROVIDER_CIRCULATING',
  ESTIMATED_CIRCULATING: 'ESTIMATED_CIRCULATING',
} as const;

export type SupplyMethod = (typeof SupplyMethod)[keyof typeof SupplyMethod];
export const ALL_SUPPLY_METHODS: readonly SupplyMethod[] = Object.values(SupplyMethod);

export function supplyMethod(value: string): SupplyMethod {
  if (!(ALL_SUPPLY_METHODS as readonly string[]).includes(value)) {
    throw new RangeError(`unknown supply method: ${JSON.stringify(value)}`);
  }
  return value as SupplyMethod;
}

export const MarketCapBasis = {
  TOTAL: 'TOTAL',
  PROVIDER_CIRCULATING: 'PROVIDER_CIRCULATING',
  ESTIMATED_CIRCULATING: 'ESTIMATED_CIRCULATING',
} as const;
export type MarketCapBasis = (typeof MarketCapBasis)[keyof typeof MarketCapBasis];
export const ALL_MARKET_CAP_BASES: readonly MarketCapBasis[] = Object.values(MarketCapBasis);

export function marketCapBasis(value: string): MarketCapBasis {
  if (!(ALL_MARKET_CAP_BASES as readonly string[]).includes(value)) {
    throw new RangeError(`unknown market-cap basis: ${JSON.stringify(value)}`);
  }
  return value as MarketCapBasis;
}

export interface MarketCapAssessmentLike {
  readonly confidence: number;
  readonly qualityCodes: readonly (QualityCode | string)[];
  /** Profile-declared minimum; defaults to the conservative domain baseline. */
  readonly minimumConfidenceForHardRejection?: number;
}

export const DEFAULT_MIN_CONFIDENCE_FOR_HARD_REJECTION = 0.5;

export function marketCapMayHardReject(
  assessment: MarketCapAssessmentLike,
  approvedFallbackAvailable: boolean,
): boolean {
  if (
    !Number.isFinite(assessment.confidence) ||
    assessment.confidence < 0 ||
    assessment.confidence > 1
  ) {
    throw new RangeError('supply confidence must lie in [0,1]');
  }
  const threshold =
    assessment.minimumConfidenceForHardRejection ?? DEFAULT_MIN_CONFIDENCE_FOR_HARD_REJECTION;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('minimum hard-rejection confidence must lie in [0,1]');
  }
  const lowConfidence =
    assessment.confidence < threshold || assessment.qualityCodes.includes('SUPPLY_UNCERTAIN');
  return !(lowConfidence && approvedFallbackAvailable);
}
