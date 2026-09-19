/**
 * Utility sensitivity without rewriting the frozen primary experiment
 * (FR-OBJ-009): capital, notional, concurrency, route capacity, alert
 * latency, exit policy, and risk-aversion coefficients vary across
 * seven-dimension grids recomputed from the frozen record.
 *
 * Derivation copies, never mutates: the primary record is frozen on a
 * frozen view, every grid carries the parent content hash, and a grid
 * claiming any other parent refuses as a frozen-experiment rewrite.
 * Level coefficients are integer basis points; recomputation stays in
 * integer micro-units (ADR-OBJ-01).
 */
import {
  ObjError,
  ObjErrorCode,
  assertFrozenParentHash,
  assertIntegerMicros,
  frozenRecordImmutable,
  parseSensitivityDimension,
  type SensitivityDimension,
} from '@foresift/domain';

/** Frozen primary experiment under sensitivity analysis. */
export interface FrozenPrimaryRecord {
  readonly contentHash: string;
  readonly baselineUtilityMicros: number | bigint;
}

/** One sensitivity point: integer level, integer utility, parent hash. */
export interface SensitivityPoint {
  readonly dimension: SensitivityDimension;
  readonly levelBasisPoints: number;
  readonly utilityMicros: bigint;
  readonly parentContentHash: string;
}

/** Seven-dimension-capable sensitivity grid derived from one frozen record. */
export interface SensitivityGrid {
  readonly dimension: SensitivityDimension;
  readonly parentContentHash: string;
  readonly points: readonly SensitivityPoint[];
}

/**
 * Pure integer recomputation supplied by the caller: baseline utility
 * and level in basis points in, integer micro-units out. The module
 * owns derivation discipline; callers own the response surface.
 */
export type SensitivityRecompute = (
  baselineMicros: bigint,
  levelBasisPoints: number,
) => number | bigint;

/**
 * Derive one dimension's grid from the frozen record. The record is
 * never mutated (derivation works on a frozen view); levels must be
 * non-empty positive integer basis points.
 */
export function deriveSensitivityGrid(
  frozen: FrozenPrimaryRecord,
  dimension: string,
  levelsBasisPoints: readonly number[],
  recompute: SensitivityRecompute,
): SensitivityGrid {
  const parsed = parseSensitivityDimension(dimension);
  if (frozen.contentHash.length === 0)
    throw new ObjError(
      ObjErrorCode.OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED,
      'sensitivity requires a hashed frozen record',
      {},
    );
  const baseline = assertIntegerMicros(frozen.baselineUtilityMicros, 'baselineUtilityMicros');
  if (levelsBasisPoints.length === 0)
    throw new ObjError(
      ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
      'sensitivity requires non-empty levels',
      { dimension: parsed },
    );
  const view = frozenRecordImmutable({ ...frozen });
  const points: SensitivityPoint[] = [];
  for (const level of levelsBasisPoints) {
    if (!Number.isSafeInteger(level) || level <= 0)
      throw new ObjError(
        ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
        'sensitivity levels must be positive integer basis points',
        { dimension: parsed },
      );
    const point: SensitivityPoint = {
      dimension: parsed,
      levelBasisPoints: level,
      utilityMicros: assertIntegerMicros(recompute(baseline, level), 'utilityMicros'),
      parentContentHash: view.contentHash,
    };
    assertFrozenParentHash(point, view.contentHash);
    points.push(point);
  }
  return frozenRecordImmutable({ dimension: parsed, parentContentHash: view.contentHash, points });
}

/**
 * Re-anchor check: a grid claiming any parent other than the frozen
 * record's hash refuses as a rewrite.
 */
export function assertSensitivityParent(grid: SensitivityGrid, expectedParentHash: string): void {
  assertFrozenParentHash({ parentContentHash: grid.parentContentHash }, expectedParentHash);
  for (const point of grid.points) assertFrozenParentHash(point, expectedParentHash);
}
