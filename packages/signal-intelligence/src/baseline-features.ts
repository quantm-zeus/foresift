import {
  ActorResolutionState,
  QualityCode,
  actorResolutionState,
  visibleAt,
  type ActorResolutionState as ActorState,
  type QualityCode as Quality,
  type UtcTimestamp,
} from '@foresift/domain';
import type { SignalFeatureDefinition } from './registry.ts';

export const BASELINE_FORMULA_VERSION = 1;
export const BASELINE_DECIMAL_SCALE = 12;

interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new RangeError('decimal denominator cannot be zero');
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: (sign * numerator) / divisor, denominator: (sign * denominator) / divisor };
}

function decimal(value: string): Rational {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (match === null) throw new RangeError(`invalid canonical decimal: ${JSON.stringify(value)}`);
  const fraction = match[3] ?? '';
  const sign = match[1] === '-' ? -1n : 1n;
  return rational(sign * BigInt(`${match[2]}${fraction}`), 10n ** BigInt(fraction.length));
}

function add(a: Rational, b: Rational): Rational {
  return rational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function subtract(a: Rational, b: Rational): Rational {
  return add(a, rational(-b.numerator, b.denominator));
}

function divide(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator, a.denominator * b.numerator);
}

function maximum(a: Rational, b: Rational): Rational {
  return a.numerator * b.denominator >= b.numerator * a.denominator ? a : b;
}

function format(value: Rational, scale = BASELINE_DECIMAL_SCALE): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 30) throw new RangeError('invalid scale');
  const factor = 10n ** BigInt(scale);
  const scaled = (value.numerator * factor) / value.denominator;
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  const rendered = `${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return rendered.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function toNumber(value: Rational): number {
  return Number(value.numerator) / Number(value.denominator);
}

function nonNegativeDecimal(value: string, field: string): Rational {
  const parsed = decimal(value);
  if (parsed.numerator < 0n) throw new RangeError(`${field} cannot be negative`);
  return parsed;
}

export interface BaselineValue {
  readonly decimalString: string | null;
  readonly value: number | null;
  readonly qualityCodes: readonly Quality[];
  readonly unquantifiedEventCount: number;
}

function result(
  value: Rational | null,
  qualityCodes: readonly Quality[] = [QualityCode.VALID],
  unquantifiedEventCount = 0,
): BaselineValue {
  return {
    decimalString: value === null ? null : format(value),
    value: value === null ? null : toNumber(value),
    qualityCodes,
    unquantifiedEventCount,
  };
}

export function volumeAcceleration(input: {
  readonly volumeLast5mUsd: string;
  readonly volumePrevious30mUsd: string;
  readonly populatedFiveMinuteBuckets: number;
  readonly unquantifiedEventCount?: number;
}): BaselineValue {
  const current = nonNegativeDecimal(input.volumeLast5mUsd, 'volumeLast5mUsd');
  const previous = nonNegativeDecimal(input.volumePrevious30mUsd, 'volumePrevious30mUsd');
  const denominator = maximum(divide(previous, rational(6n)), rational(1n));
  return result(
    divide(current, denominator),
    input.populatedFiveMinuteBuckets < 3 ? [QualityCode.LOW_SAMPLE] : [QualityCode.VALID],
    input.unquantifiedEventCount ?? 0,
  );
}

export function volumePersistence(
  bucketVolumesUsd: readonly string[],
  trailingSixHourMedianUsd: string,
): BaselineValue {
  if (bucketVolumesUsd.length !== 6)
    throw new RangeError('volume persistence requires six buckets');
  const median = nonNegativeDecimal(trailingSixHourMedianUsd, 'trailingSixHourMedianUsd');
  const above = bucketVolumesUsd.filter((value) => {
    const parsed = nonNegativeDecimal(value, 'bucketVolumeUsd');
    return parsed.numerator * median.denominator > median.numerator * parsed.denominator;
  }).length;
  return result(rational(BigInt(above), 6n));
}

export function priceExtension(
  priceNow: string,
  priceSixHoursAgo: string | null,
  firstAvailablePrice: string,
): BaselineValue {
  const now = nonNegativeDecimal(priceNow, 'priceNow');
  const base = nonNegativeDecimal(priceSixHoursAgo ?? firstAvailablePrice, 'basePrice');
  return result(subtract(divide(now, maximum(base, rational(1n))), rational(1n)));
}

export interface BuyerObservation {
  readonly walletId: string;
  readonly actorEntityId?: string | null;
  readonly actorResolutionState: ActorState;
  readonly actorResolutionConfidence: number;
}

function economicBuyerKey(observation: BuyerObservation, threshold: number): string {
  const state = actorResolutionState(observation.actorResolutionState);
  if (
    state !== ActorResolutionState.UNRESOLVED &&
    observation.actorEntityId != null &&
    observation.actorResolutionConfidence >= threshold
  ) {
    return `actor:${observation.actorEntityId}`;
  }
  return `wallet:${observation.walletId}`;
}

export function uniqueEconomicBuyerCount(
  observations: readonly BuyerObservation[],
  clusterConfidenceThreshold: number,
): { readonly count: number; readonly qualityCodes: readonly Quality[] } {
  if (
    !Number.isFinite(clusterConfidenceThreshold) ||
    clusterConfidenceThreshold < 0 ||
    clusterConfidenceThreshold > 1
  ) {
    throw new RangeError('clusterConfidenceThreshold must lie in [0,1]');
  }
  for (const observation of observations) {
    actorResolutionState(observation.actorResolutionState);
    if (
      !Number.isFinite(observation.actorResolutionConfidence) ||
      observation.actorResolutionConfidence < 0 ||
      observation.actorResolutionConfidence > 1
    ) {
      throw new RangeError('actorResolutionConfidence must lie in [0,1]');
    }
  }
  const states = observations.map((observation) => observation.actorResolutionState);
  const qualityCodes: Quality[] = states.includes(ActorResolutionState.UNRESOLVED)
    ? [QualityCode.SYSTEM_ADDRESS_UNCERTAIN]
    : states.includes(ActorResolutionState.PARTIAL)
      ? [QualityCode.PARTIAL]
      : [QualityCode.VALID];
  return {
    count: new Set(observations.map((item) => economicBuyerKey(item, clusterConfidenceThreshold)))
      .size,
    qualityCodes,
  };
}

export function uniqueBuyerLogGrowth(input: {
  readonly current: readonly BuyerObservation[];
  readonly previous: readonly BuyerObservation[];
  readonly clusterConfidenceThreshold: number;
}): BaselineValue {
  const current = uniqueEconomicBuyerCount(input.current, input.clusterConfidenceThreshold);
  const previous = uniqueEconomicBuyerCount(input.previous, input.clusterConfidenceThreshold);
  const qualityCodes = [...new Set([...current.qualityCodes, ...previous.qualityCodes])];
  const growth = Math.log1p(current.count) - Math.log1p(previous.count);
  return {
    decimalString: format(decimal(growth.toFixed(BASELINE_DECIMAL_SCALE))),
    value: growth,
    qualityCodes,
    unquantifiedEventCount: 0,
  };
}

export function buySellImbalance(
  buyVolumeUsd: string,
  sellVolumeUsd: string,
  unquantifiedEventCount = 0,
): BaselineValue {
  const buy = nonNegativeDecimal(buyVolumeUsd, 'buyVolumeUsd');
  const sell = nonNegativeDecimal(sellVolumeUsd, 'sellVolumeUsd');
  return result(
    divide(subtract(buy, sell), maximum(add(buy, sell), rational(1n))),
    unquantifiedEventCount > 0 ? [QualityCode.PARTIAL] : [QualityCode.VALID],
    unquantifiedEventCount,
  );
}

export function liquidityGrowth(
  liquidityNowUsd: string,
  liquidityOneHourAgoUsd: string,
): BaselineValue {
  const now = nonNegativeDecimal(liquidityNowUsd, 'liquidityNowUsd');
  const previous = nonNegativeDecimal(liquidityOneHourAgoUsd, 'liquidityOneHourAgoUsd');
  return result(subtract(divide(now, maximum(previous, rational(1n))), rational(1n)));
}

export function topTenConcentrationSlope(now: string, sixHoursAgo: string): BaselineValue {
  return result(
    subtract(
      nonNegativeDecimal(now, 'topTenShareNow'),
      nonNegativeDecimal(sixHoursAgo, 'topTenShareSixHoursAgo'),
    ),
  );
}

export function holderLogGrowth(holdersNow: number, holdersSixHoursAgo: number): BaselineValue {
  if (
    !Number.isSafeInteger(holdersNow) ||
    holdersNow < 0 ||
    !Number.isSafeInteger(holdersSixHoursAgo) ||
    holdersSixHoursAgo < 0
  ) {
    throw new RangeError('holder counts must be non-negative safe integers');
  }
  const growth = Math.log1p(holdersNow) - Math.log1p(holdersSixHoursAgo);
  return {
    decimalString: growth
      .toFixed(BASELINE_DECIMAL_SCALE)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*?)0+$/, '$1'),
    value: growth,
    qualityCodes: [QualityCode.VALID],
    unquantifiedEventCount: 0,
  };
}

/** Counts per nonempty logarithmic trade-size bucket. */
export function tradeSizeEntropy(nonemptyBucketCounts: readonly number[]): BaselineValue {
  if (nonemptyBucketCounts.some((count) => !Number.isInteger(count) || count <= 0)) {
    throw new RangeError('nonempty bucket counts must be positive integers');
  }
  if (nonemptyBucketCounts.length < 2) return result(null, [QualityCode.LOW_SAMPLE]);
  const total = nonemptyBucketCounts.reduce((sum, count) => sum + count, 0);
  const entropy =
    -nonemptyBucketCounts.reduce((sum, count) => {
      const probability = count / total;
      return sum + probability * Math.log(probability);
    }, 0) / Math.log(nonemptyBucketCounts.length);
  return {
    decimalString: entropy
      .toFixed(BASELINE_DECIMAL_SCALE)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*?)0+$/, '$1'),
    value: Math.max(0, Math.min(1, entropy)),
    qualityCodes: [QualityCode.VALID],
    unquantifiedEventCount: 0,
  };
}

export function manipulationIndicators(input: {
  readonly coordinatedOrSharedFunderBuyers: number;
  readonly uniqueBuyers: number;
  readonly roundTripWallets: number;
  readonly uniqueTraders: number;
  readonly topFiveActorVolumeUsd: string;
  readonly totalVolumeUsd: string;
}): Readonly<
  Record<'sharedFunderRatio' | 'roundTripRatio' | 'actorVolumeConcentration', BaselineValue>
> {
  for (const [field, value] of [
    ['coordinatedOrSharedFunderBuyers', input.coordinatedOrSharedFunderBuyers],
    ['uniqueBuyers', input.uniqueBuyers],
    ['roundTripWallets', input.roundTripWallets],
    ['uniqueTraders', input.uniqueTraders],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError(`${field} must be a non-negative safe integer`);
  }
  return {
    sharedFunderRatio: result(
      divide(
        rational(BigInt(input.coordinatedOrSharedFunderBuyers)),
        rational(BigInt(Math.max(input.uniqueBuyers, 1))),
      ),
    ),
    roundTripRatio: result(
      divide(
        rational(BigInt(input.roundTripWallets)),
        rational(BigInt(Math.max(input.uniqueTraders, 1))),
      ),
    ),
    actorVolumeConcentration: result(
      divide(
        nonNegativeDecimal(input.topFiveActorVolumeUsd, 'topFiveActorVolumeUsd'),
        maximum(nonNegativeDecimal(input.totalVolumeUsd, 'totalVolumeUsd'), rational(1n)),
      ),
    ),
  };
}

export interface CoverageField {
  readonly weight: string;
  readonly valid: boolean;
  readonly fresh: boolean;
}

export function dataCoverage(fields: readonly CoverageField[]): BaselineValue {
  if (fields.length === 0) return result(null, [QualityCode.LOW_SAMPLE]);
  let valid = rational(0n);
  let total = rational(0n);
  for (const field of fields) {
    const weight = nonNegativeDecimal(field.weight, 'coverage weight');
    total = add(total, weight);
    if (field.valid && field.fresh) valid = add(valid, weight);
  }
  if (total.numerator === 0n) return result(null, [QualityCode.LOW_SAMPLE]);
  const coverage = divide(valid, total);
  return result(
    coverage,
    valid.numerator === total.numerator && valid.denominator === total.denominator
      ? [QualityCode.VALID]
      : [QualityCode.PARTIAL],
  );
}

export interface EventTimedObservation {
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly quantified?: boolean;
}

/** Half-open event window [start,end), resolved through the shared replay boundary. */
export function eventTimeWindow<T extends EventTimedObservation>(
  observations: readonly T[],
  windowStart: UtcTimestamp,
  windowEnd: UtcTimestamp,
  resolvedAt: UtcTimestamp,
): { readonly observations: readonly T[]; readonly unquantifiedEventCount: number } {
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new RangeError('event window must have valid increasing bounds');
  }
  const selected = observations.filter((observation) => {
    const eventAt = Date.parse(observation.eventAt);
    return eventAt >= start && eventAt < end && visibleAt(observation, resolvedAt);
  });
  return {
    observations: selected,
    unquantifiedEventCount: selected.filter((observation) => observation.quantified === false)
      .length,
  };
}

const numericDefaults = {
  minimumDenominator: 1,
  stabilityTransform: 'identity_or_log1p_as_formula',
  shrinkagePolicy: 'empirical_bayes_toward_cohort_prior',
  cappedContribution: 0.25,
  outlierPolicyIsRobust: true,
  cohortFallbackPolicyId: 'sig.default-cohort-fallback.v1',
  isNumeric: true,
  economicEventRequired: false,
} as const;

function definition(
  featureId: string,
  formula: string,
  inputFields: readonly string[],
  windows: readonly string[],
  minimumObservations = 1,
): SignalFeatureDefinition {
  return {
    featureId,
    version: BASELINE_FORMULA_VERSION,
    description: `Appendix H baseline feature ${featureId}`,
    formula,
    inputFields,
    unit: 'ratio',
    windows,
    minimumObservations,
    nullPolicy: 'explicit null with non-VALID quality code',
    outlierPolicy: 'winsorized by profile before ranking contribution',
    updatePolicy: 'event-time window recomputation',
    freshnessLimitSeconds: 300,
    evidenceRequirements: ['visibleAt-resolved input lineage'],
    ...numericDefaults,
  };
}

/** Immutable Appendix H registry payloads; any formula change requires version 2. */
export const APPENDIX_H_BASELINE_DEFINITIONS: readonly SignalFeatureDefinition[] = [
  definition(
    'volume_acceleration_5m_30m',
    'volume[t-5m,t]/max(volume[t-35m,t-5m]/6,1)',
    ['volume_usd'],
    ['5m', '30m'],
    3,
  ),
  definition(
    'volume_persistence_30m',
    'count(5m buckets above trailing-6h median)/6',
    ['volume_usd'],
    ['30m', '6h'],
    6,
  ),
  definition(
    'price_extension_6h',
    'price_now/max(price_6h_ago,first_available_price)-1',
    ['price'],
    ['6h'],
  ),
  definition(
    'unique_buyer_log_growth_30m',
    'log1p(economic_buyers_last_30m)-log1p(economic_buyers_previous_30m)',
    ['actor_entity_id', 'actor_resolution_state', 'actor_resolution_confidence'],
    ['30m'],
    1,
  ),
  definition(
    'buy_sell_imbalance_30m',
    '(buy_volume_usd-sell_volume_usd)/max(total_volume_usd,1)',
    ['buy_volume_usd', 'sell_volume_usd'],
    ['30m'],
  ),
  definition(
    'liquidity_growth_1h',
    'liquidity_now/max(liquidity_1h_ago,1)-1',
    ['liquidity_usd'],
    ['1h'],
  ),
  definition(
    'top10_concentration_slope_6h',
    'top10_share_now-top10_share_6h_ago',
    ['top10_share'],
    ['6h'],
  ),
  definition(
    'holder_log_growth_6h',
    'log1p(holders_now)-log1p(holders_6h_ago)',
    ['holder_count'],
    ['6h'],
  ),
  definition(
    'trade_size_entropy',
    '-sum(p_i*ln(p_i))/ln(nonempty_bucket_count)',
    ['trade_size_usd'],
    ['profile'],
  ),
  definition(
    'shared_funder_ratio',
    'shared_funder_buyers/max(unique_buyers,1)',
    ['funder_actor_id', 'buyer_actor_id'],
    ['profile'],
  ),
  definition(
    'round_trip_ratio',
    'round_trip_wallets/max(unique_traders,1)',
    ['trade_side', 'actor_entity_id'],
    ['profile'],
  ),
  definition(
    'actor_volume_concentration',
    'top_5_actor_volume/max(total_volume,1)',
    ['actor_entity_id', 'volume_usd'],
    ['profile'],
  ),
  definition(
    'robust_activity_change_point',
    'median/MAD robust_z plus fast/slow EWMA and one-sided CUSUM',
    ['economic_activity'],
    ['profile'],
  ),
  definition(
    'data_coverage',
    'sum(valid_fresh_weight)/sum(required_weight)',
    ['required_fields'],
    ['profile'],
  ),
] as const;

export const BASELINE_FEATURE_DEFINITIONS = APPENDIX_H_BASELINE_DEFINITIONS;
