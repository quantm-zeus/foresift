import {
  ActorResolutionState,
  QualityCode,
  actorUncertaintyFactor,
  actorResolutionState,
  type ActorResolutionState as ActorState,
  type QualityCode as Quality,
} from '@foresift/domain';

export interface NumericStabilityPolicy {
  readonly minimumAbsoluteActivity: number;
  readonly minimumDenominator: number;
  readonly minimumObservations: number;
  readonly winsorLowerQuantile: number;
  readonly winsorUpperQuantile: number;
  readonly priorMean: number;
  readonly priorStrength: number;
  readonly maximumContribution: number;
}

export interface StableNumericResult {
  readonly value: number | null;
  readonly effectiveSampleSize: number;
  readonly qualityCodes: readonly Quality[];
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${field} must be finite`);
  return value;
}

function unitInterval(value: number, field: string): number {
  finite(value, field);
  if (value < 0 || value > 1) throw new RangeError(`${field} must lie in [0,1]`);
  return value;
}

export function assertNumericStabilityPolicy(policy: NumericStabilityPolicy): void {
  if (policy.minimumAbsoluteActivity < 0 || !Number.isFinite(policy.minimumAbsoluteActivity)) {
    throw new RangeError('minimumAbsoluteActivity must be finite and non-negative');
  }
  if (policy.minimumDenominator <= 0 || !Number.isFinite(policy.minimumDenominator)) {
    throw new RangeError('minimumDenominator must be finite and positive');
  }
  if (!Number.isInteger(policy.minimumObservations) || policy.minimumObservations < 1) {
    throw new RangeError('minimumObservations must be a positive integer');
  }
  unitInterval(policy.winsorLowerQuantile, 'winsorLowerQuantile');
  unitInterval(policy.winsorUpperQuantile, 'winsorUpperQuantile');
  if (policy.winsorLowerQuantile > policy.winsorUpperQuantile) {
    throw new RangeError('winsor quantiles are reversed');
  }
  finite(policy.priorMean, 'priorMean');
  if (policy.priorStrength < 0 || !Number.isFinite(policy.priorStrength)) {
    throw new RangeError('priorStrength must be finite and non-negative');
  }
  if (policy.maximumContribution <= 0 || !Number.isFinite(policy.maximumContribution)) {
    throw new RangeError('maximumContribution must be finite and positive');
  }
}

/** Stable non-negative transform used in place of explosive raw ratios. */
export function stableLog1p(value: number): number {
  finite(value, 'value');
  if (value < 0) throw new RangeError('log1p activity cannot be negative');
  return Math.log1p(value);
}

export function stableLogGrowth(current: number, previous: number): number {
  return stableLog1p(current) - stableLog1p(previous);
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError('quantile requires observations');
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower]!;
  const upperValue = sorted[upper]!;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

/** Deterministic linear-quantile winsorization; input order never changes output. */
export function winsorize(
  values: readonly number[],
  lowerQuantile: number,
  upperQuantile: number,
): readonly number[] {
  unitInterval(lowerQuantile, 'lowerQuantile');
  unitInterval(upperQuantile, 'upperQuantile');
  if (lowerQuantile > upperQuantile) throw new RangeError('winsor quantiles are reversed');
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError('winsorization observations must be finite');
  }
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const lower = quantile(sorted, lowerQuantile);
  const upper = quantile(sorted, upperQuantile);
  return values.map((value) => Math.min(upper, Math.max(lower, value)));
}

/** Conjugate-style weighted shrinkage. The result is always between sample and prior. */
export function shrinkTowardPrior(
  sampleValue: number,
  sampleSize: number,
  priorValue: number,
  priorStrength: number,
): number {
  finite(sampleValue, 'sampleValue');
  finite(priorValue, 'priorValue');
  if (!Number.isFinite(sampleSize) || sampleSize < 0) {
    throw new RangeError('sampleSize must be finite and non-negative');
  }
  if (!Number.isFinite(priorStrength) || priorStrength < 0) {
    throw new RangeError('priorStrength must be finite and non-negative');
  }
  const weight = sampleSize + priorStrength;
  return weight === 0
    ? priorValue
    : (sampleValue * sampleSize + priorValue * priorStrength) / weight;
}

export function clampContribution(value: number, maximumContribution: number): number {
  finite(value, 'value');
  if (!Number.isFinite(maximumContribution) || maximumContribution <= 0) {
    throw new RangeError('maximumContribution must be finite and positive');
  }
  return Math.max(0, Math.min(maximumContribution, value));
}

export const clampCappedContribution = clampContribution;

export interface ActorAdjustedContribution {
  readonly contribution: number;
  readonly uncertaintyFactor: number;
  readonly qualityCodes: readonly Quality[];
}

/** Consumes the proven actor uncertainty law; unresolved evidence is retained but downgraded. */
export function actorAdjustedContribution(
  contribution: number,
  maximumAbsoluteContribution: number,
  state: ActorState,
  confidence: number,
): ActorAdjustedContribution {
  const resolvedState = actorResolutionState(state);
  const uncertaintyFactor = actorUncertaintyFactor(resolvedState, confidence);
  const qualityCodes: Quality[] =
    resolvedState === ActorResolutionState.RESOLVED
      ? [QualityCode.VALID]
      : resolvedState === ActorResolutionState.PARTIAL
        ? [QualityCode.PARTIAL]
        : [QualityCode.SYSTEM_ADDRESS_UNCERTAIN];
  return {
    contribution: clampContribution(contribution * uncertaintyFactor, maximumAbsoluteContribution),
    uncertaintyFactor,
    qualityCodes,
  };
}

/** Explicit zero/one/low-sample denominator policy for ratio-like numeric features. */
export function stableRatio(
  numerator: number,
  denominator: number,
  observations: number,
  policy: Pick<NumericStabilityPolicy, 'minimumDenominator' | 'minimumObservations'>,
): StableNumericResult {
  finite(numerator, 'numerator');
  finite(denominator, 'denominator');
  if (!Number.isInteger(observations) || observations < 0) {
    throw new RangeError('observations must be a non-negative integer');
  }
  if (denominator < 0) throw new RangeError('denominator cannot be negative');
  const qualityCodes: Quality[] = [];
  if (observations < policy.minimumObservations) qualityCodes.push(QualityCode.LOW_SAMPLE);
  if (denominator === 0) {
    return {
      value: null,
      effectiveSampleSize: observations,
      qualityCodes: [QualityCode.LOW_SAMPLE],
    };
  }
  const effectiveDenominator = Math.max(denominator, policy.minimumDenominator);
  if (denominator < policy.minimumDenominator && !qualityCodes.includes(QualityCode.LOW_SAMPLE)) {
    qualityCodes.push(QualityCode.LOW_SAMPLE);
  }
  if (qualityCodes.length === 0) qualityCodes.push(QualityCode.VALID);
  return {
    value: numerator / effectiveDenominator,
    effectiveSampleSize: observations,
    qualityCodes,
  };
}

export function robustStableMean(
  observations: readonly number[],
  policy: NumericStabilityPolicy,
): StableNumericResult {
  assertNumericStabilityPolicy(policy);
  if (observations.some((value) => !Number.isFinite(value))) {
    throw new RangeError('observations must be finite');
  }
  if (observations.length === 0) {
    return { value: null, effectiveSampleSize: 0, qualityCodes: [QualityCode.LOW_SAMPLE] };
  }
  const robust = winsorize(observations, policy.winsorLowerQuantile, policy.winsorUpperQuantile);
  const mean = robust.reduce((sum, value) => sum + value, 0) / robust.length;
  const value = shrinkTowardPrior(mean, robust.length, policy.priorMean, policy.priorStrength);
  return {
    value,
    effectiveSampleSize: robust.length,
    qualityCodes:
      robust.length < policy.minimumObservations ? [QualityCode.LOW_SAMPLE] : [QualityCode.VALID],
  };
}
