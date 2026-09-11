/**
 * Primary production objective (FR-OBJ-001): the conservative lower
 * confidence bound of net shadow-portfolio utility per capital-day under
 * fixed capital, concurrency, execution, latency, liquidity, risk, and
 * opportunity-cost assumptions.
 *
 * Float-free LCB core: the frozen daily-net series folds through integer
 * micro-unit arithmetic with the pinned one-sided-95% z constant. Cluster
 * effective sample size is consumed from the proven evaluation layer,
 * never recomputed here — an absent or stale ESS reference refuses
 * fail-closed. Pure bigint math makes repeated runs bit-identical.
 */
import {
  ObjError,
  ObjErrorCode,
  assertIntegerMicros,
  floorDiv,
  lowerBoundUtility,
} from '@foresift/domain';

/** Frozen utility series with its consumed uncertainty basis. */
export interface FrozenUtilitySeries {
  readonly runId: string;
  /** Daily net utilities in integer micro-units, frozen at promotion time. */
  readonly dailyNetMicros: readonly (number | bigint)[];
  /** Consumed cluster-ESS reference (eval-proven); never recomputed here. */
  readonly consumedEssReference: string;
  /** Consumed maturity flag: a stale ESS basis refuses. */
  readonly essStale: boolean;
}

/** Computed governing objective for one frozen run. */
export interface ObjectiveValue {
  readonly runId: string;
  readonly capitalDays: number;
  readonly meanFloorMicros: bigint;
  readonly lowerBoundMicros: bigint;
  readonly consumedEssReference: string;
}

/**
 * Compute the governing objective: `floor(mean) − ceil(z·sd/√n)` over the
 * frozen series. Refuses empty series, non-integer days, and absent or
 * stale ESS references — promotion without a live uncertainty basis is
 * impossible.
 */
export function computeObjectiveFunction(series: FrozenUtilitySeries): ObjectiveValue {
  if (series.runId.length === 0)
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'objective requires a run id', {});
  if (series.consumedEssReference.length === 0 || series.essStale)
    throw new ObjError(
      ObjErrorCode.OBJ_UNCERTAINTY_DISCLOSURE_MISSING,
      'objective requires a live consumed ESS reference',
      { stale: series.essStale },
    );
  if (series.dailyNetMicros.length === 0)
    throw new ObjError(
      ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
      'objective requires a non-empty frozen series',
      {},
    );
  let sum = 0n;
  let sumSquares = 0n;
  for (const day of series.dailyNetMicros) {
    const micros = assertIntegerMicros(day, 'dailyNetMicros');
    sum += micros;
    sumSquares += micros * micros;
  }
  const count = BigInt(series.dailyNetMicros.length);
  return {
    runId: series.runId,
    capitalDays: series.dailyNetMicros.length,
    meanFloorMicros: floorDiv(sum, count),
    lowerBoundMicros: lowerBoundUtility({ sumMicros: sum, sumSquaresMicros: sumSquares, count }),
    consumedEssReference: series.consumedEssReference,
  };
}

/**
 * Compare two computed objectives by lower bound: 1 when `left` governs,
 * -1 when `right` governs, 0 on exact ties. Point estimates and
 * diagnostics are not inputs — the LCB alone orders policies.
 */
export function compareLowerBounds(left: ObjectiveValue, right: ObjectiveValue): 1 | -1 | 0 {
  if (left.lowerBoundMicros > right.lowerBoundMicros) return 1;
  if (left.lowerBoundMicros < right.lowerBoundMicros) return -1;
  return 0;
}
