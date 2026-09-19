/**
 * Capital-day coordinates: fixed capital × calendar day (FR-OBJ-001).
 *
 * Net utility is always denominated per capital-day under one fixed
 * capital; the denominator never changes inside a fold. All arithmetic
 * is integer micro-units (ADR-OBJ-01) — no binary floating point here.
 */
import { ObjError, ObjErrorCode, assertIntegerMicros, floorDiv } from '@foresift/domain';

/** One capital-day coordinate: the unit of the utility ledger. */
export interface CapitalDayCoordinate {
  readonly runId: string;
  readonly capitalDay: string;
  readonly capitalMicros: bigint;
}

const CAPITAL_DAY_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Parse and calendar-validate a YYYY-MM-DD capital day with integer checks only. */
export function parseCapitalDay(value: unknown): string {
  if (typeof value !== 'string' || !CAPITAL_DAY_PATTERN.test(value))
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'capital day must be YYYY-MM-DD', {
      value: typeof value === 'string' ? value : null,
    });
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = monthLengths[month - 1];
  if (month < 1 || month > 12 || maxDay === undefined || day < 1 || day > maxDay)
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'capital day is not a calendar date', {
      value,
    });
  return value;
}

/** Deterministic natural key for one capital-day coordinate. */
export function capitalDayKey(coordinate: Pick<CapitalDayCoordinate, 'runId' | 'capitalDay'>): string {
  return `${coordinate.runId}|${parseCapitalDay(coordinate.capitalDay)}`;
}

/** Build a coordinate, refusing blank ids, bad dates, and non-positive capital. */
export function capitalDayCoordinate(
  runId: string,
  capitalDay: string,
  capitalMicros: number | bigint,
): CapitalDayCoordinate {
  if (runId.length === 0)
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'capital-day coordinate requires a run id', {});
  const capital = assertPositiveCapital(capitalMicros);
  return { runId, capitalDay: parseCapitalDay(capitalDay), capitalMicros: capital };
}

/** Positive integer capital in micro-units; anything else refuses. */
export function assertPositiveCapital(capitalMicros: number | bigint): bigint {
  const capital = assertIntegerMicros(capitalMicros, 'capitalMicros');
  if (capital <= 0n)
    throw new ObjError(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED, 'capital must be positive', {});
  return capital;
}

/**
 * Utility per unit of fixed capital, floored to integer micro-units.
 * Flooring keeps per-capital figures conservative for the LCB core.
 */
export function utilityPerCapitalDay(totalMicros: number | bigint, capitalMicros: number | bigint): bigint {
  const total = assertIntegerMicros(totalMicros, 'totalMicros');
  const capital = assertPositiveCapital(capitalMicros);
  return floorDiv(total, capital);
}
