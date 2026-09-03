import { compareTimestamps, utcTimestamp, type UtcTimestamp } from './timestamps.ts';

export const DependenceMethod = {
  DECLARED: 'DECLARED',
  EMPIRICAL: 'EMPIRICAL',
} as const;

export type DependenceMethod = (typeof DependenceMethod)[keyof typeof DependenceMethod];
export const ALL_DEPENDENCE_METHODS: readonly DependenceMethod[] = Object.values(DependenceMethod);

export function dependenceMethod(value: string): DependenceMethod {
  if (!(ALL_DEPENDENCE_METHODS as readonly string[]).includes(value)) {
    throw new RangeError(`unknown dependence method: ${JSON.stringify(value)}`);
  }
  return value as DependenceMethod;
}

export interface DependenceEdgeValidity {
  readonly validFrom: UtcTimestamp;
  readonly validUntil?: UtcTimestamp | null;
}

/** Validity intervals are closed at both ends. */
export function isEdgeValidAtTimestamp(
  edge: { readonly validFrom: string; readonly validUntil?: string | null },
  timestamp: string,
): boolean {
  const at = utcTimestamp(timestamp);
  const from = utcTimestamp(edge.validFrom);
  if (compareTimestamps(at, from) < 0) return false;
  return edge.validUntil == null || compareTimestamps(at, utcTimestamp(edge.validUntil)) <= 0;
}

export interface DependenceInputs {
  readonly sharedUpstreamLineage: boolean;
  readonly valueErrorTimingCorrelation: number;
  readonly outageOverlap: number;
  readonly firstSeenLagAgreement: number;
  readonly fingerprintSimilarity: number;
}

const MATERIAL_THRESHOLDS = {
  valueErrorTimingCorrelation: 0.8,
  outageOverlap: 0.5,
  firstSeenLagAgreement: 0.7,
  fingerprintSimilarity: 0.9,
} as const;

function assertUnitInterval(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must lie in [0,1]`);
  }
}

/**
 * Low-signal observations retain full credit. Once a material threshold is
 * crossed, credit falls monotonically with the strongest observed signal.
 */
export function calculateEffectiveIndependenceMultiplier(input: DependenceInputs): number {
  const correlation = Math.abs(input.valueErrorTimingCorrelation);
  assertUnitInterval(correlation, 'valueErrorTimingCorrelation');
  assertUnitInterval(input.outageOverlap, 'outageOverlap');
  assertUnitInterval(input.firstSeenLagAgreement, 'firstSeenLagAgreement');
  assertUnitInterval(input.fingerprintSimilarity, 'fingerprintSimilarity');

  const signals = [
    [correlation, MATERIAL_THRESHOLDS.valueErrorTimingCorrelation],
    [input.outageOverlap, MATERIAL_THRESHOLDS.outageOverlap],
    [input.firstSeenLagAgreement, MATERIAL_THRESHOLDS.firstSeenLagAgreement],
    [input.fingerprintSimilarity, MATERIAL_THRESHOLDS.fingerprintSimilarity],
  ] as const;
  const severity = Math.max(
    0,
    ...signals.map(([value, threshold]) =>
      value <= threshold ? 0 : (value - threshold) / (1 - threshold),
    ),
  );
  const empiricalCredit = 1 - 0.75 * severity;
  return input.sharedUpstreamLineage ? Math.min(0.25, empiricalCredit) : empiricalCredit;
}
