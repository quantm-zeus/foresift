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

export const DependenceInputAvailability = {
  AVAILABLE_AT_THE_TIME: 'AVAILABLE_AT_THE_TIME',
  DIAGNOSTIC_RETROSPECTIVE: 'DIAGNOSTIC_RETROSPECTIVE',
} as const;

export type DependenceInputAvailability =
  (typeof DependenceInputAvailability)[keyof typeof DependenceInputAvailability];

export interface SourceDependenceEdgeLike extends DependenceEdgeValidity {
  readonly confidence: number;
  readonly effectiveIndependenceMultiplier: number;
  readonly inputAvailability: DependenceInputAvailability;
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

/** Appendix O.8 materiality thresholds, versioned with the domain policy. */
export const DEPENDENCE_MATERIAL_THRESHOLDS = {
  correlatedValues: 0.8,
  correlatedErrors: 0.8,
  updateTimingSync: 0.7,
  firstSeenSync: 0.7,
  outageOverlap: 0.5,
  schemaFingerprintSimilarity: 0.9,
  roundingFingerprintSimilarity: 0.9,
  commonMissingness: 0.6,
  valueErrorTimingCorrelation: 0.8,
  firstSeenLagAgreement: 0.7,
  fingerprintSimilarity: 0.9,
} as const;

export interface EmpiricalDependenceInputs {
  readonly correlatedValues: number;
  readonly correlatedErrors: number;
  readonly updateTimingSync: number;
  readonly firstSeenSync: number;
  readonly outageOverlap: number;
  readonly schemaFingerprintSimilarity: number;
  readonly roundingFingerprintSimilarity: number;
  readonly commonMissingness: number;
  readonly knownUpstreamRelationship: boolean;
}

function assertUnitInterval(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must lie in [0,1]`);
  }
}

/**
 * Low-signal observations retain full credit. Once a material threshold is
 * crossed, credit falls monotonically with the strongest observed signal.
 */
export function calculateEffectiveIndependenceMultiplier(
  input: DependenceInputs | EmpiricalDependenceInputs,
): number {
  const legacy = 'valueErrorTimingCorrelation' in input;
  const signals: ReadonlyArray<readonly [number, number, string]> = legacy
    ? [
        [
          Math.abs(input.valueErrorTimingCorrelation),
          DEPENDENCE_MATERIAL_THRESHOLDS.valueErrorTimingCorrelation,
          'valueErrorTimingCorrelation',
        ],
        [input.outageOverlap, DEPENDENCE_MATERIAL_THRESHOLDS.outageOverlap, 'outageOverlap'],
        [
          input.firstSeenLagAgreement,
          DEPENDENCE_MATERIAL_THRESHOLDS.firstSeenLagAgreement,
          'firstSeenLagAgreement',
        ],
        [
          input.fingerprintSimilarity,
          DEPENDENCE_MATERIAL_THRESHOLDS.fingerprintSimilarity,
          'fingerprintSimilarity',
        ],
      ]
    : [
        [
          Math.abs(input.correlatedValues),
          DEPENDENCE_MATERIAL_THRESHOLDS.correlatedValues,
          'correlatedValues',
        ],
        [
          Math.abs(input.correlatedErrors),
          DEPENDENCE_MATERIAL_THRESHOLDS.correlatedErrors,
          'correlatedErrors',
        ],
        [
          input.updateTimingSync,
          DEPENDENCE_MATERIAL_THRESHOLDS.updateTimingSync,
          'updateTimingSync',
        ],
        [input.firstSeenSync, DEPENDENCE_MATERIAL_THRESHOLDS.firstSeenSync, 'firstSeenSync'],
        [input.outageOverlap, DEPENDENCE_MATERIAL_THRESHOLDS.outageOverlap, 'outageOverlap'],
        [
          input.schemaFingerprintSimilarity,
          DEPENDENCE_MATERIAL_THRESHOLDS.schemaFingerprintSimilarity,
          'schemaFingerprintSimilarity',
        ],
        [
          input.roundingFingerprintSimilarity,
          DEPENDENCE_MATERIAL_THRESHOLDS.roundingFingerprintSimilarity,
          'roundingFingerprintSimilarity',
        ],
        [
          input.commonMissingness,
          DEPENDENCE_MATERIAL_THRESHOLDS.commonMissingness,
          'commonMissingness',
        ],
      ];
  for (const [value, , field] of signals) assertUnitInterval(value, field);
  const severity = Math.max(
    0,
    ...signals.map(([value, threshold]) =>
      value <= threshold ? 0 : (value - threshold) / (1 - threshold),
    ),
  );
  const empiricalCredit = 1 - 0.75 * severity;
  const sharedLineage = legacy ? input.sharedUpstreamLineage : input.knownUpstreamRelationship;
  return sharedLineage ? Math.min(0.25, empiricalCredit) : empiricalCredit;
}

/** ADR-3: only contemporaneously available, valid edges may alter credit at T. */
export function edgeMayAffectCreditAt(edge: SourceDependenceEdgeLike, timestamp: string): boolean {
  assertUnitInterval(edge.confidence, 'confidence');
  assertUnitInterval(edge.effectiveIndependenceMultiplier, 'effectiveIndependenceMultiplier');
  return (
    edge.inputAvailability === DependenceInputAvailability.AVAILABLE_AT_THE_TIME &&
    isEdgeValidAtTimestamp(edge, timestamp)
  );
}
