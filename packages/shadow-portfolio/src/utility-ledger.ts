/**
 * Shadow-portfolio utility ledger: G1-scoped aggregation substrate only
 * (FR-OBJ-001/004 substrate).
 *
 * Versioned execution fills (consumed from the proven simulator) fold
 * deterministically into per-capital-day net utility with the twelve
 * decomposition lines. All arithmetic is integer micro-units (ADR-OBJ-01);
 * there is no binary floating point in this module.
 *
 * Explicit non-goals owned by the later milestone that owns the
 * shadow-portfolio engine requirements (G7 boundary): allocation policies,
 * top-K / all-confirmed / pattern-only / baseline / control comparison,
 * and metric breadth beyond the twelve objective lines.
 */
import {
  ALL_UTILITY_LINE_KINDS,
  ObjError,
  ObjErrorCode,
  assertDecompositionReconciles,
  assertIntegerMicros,
  type UtilityLineKind,
} from '@foresift/domain';

/** One versioned execution fill consumed from the proven simulator. */
export interface VersionedFill {
  readonly fillId: string;
  /** Monotone version per fill; higher versions supersede lower ones. */
  readonly version: number;
  readonly runId: string;
  /** Calendar day in YYYY-MM-DD form. */
  readonly capitalDay: string;
  /** Fixed-capital denominator in integer micro-units; must match the run. */
  readonly capitalMicros: number | bigint;
  readonly lines: Readonly<Partial<Record<UtilityLineKind, number | bigint>>>;
}

/** Folded per-capital-day net utility with all twelve lines. */
export interface CapitalDayUtility {
  readonly runId: string;
  readonly capitalDay: string;
  readonly capitalMicros: bigint;
  readonly lines: Readonly<Record<UtilityLineKind, bigint>>;
  readonly netMicros: bigint;
  readonly fillCount: number;
}

/** Natural-key identity of a fill version: reruns of the same key are idempotent. */
export function fillNaturalKey(
  fill: Pick<VersionedFill, 'runId' | 'capitalDay' | 'fillId'>,
): string {
  return `${fill.runId}|${fill.capitalDay}|${fill.fillId}`;
}

/**
 * Fixed-capital denominators: every fill in a fold must clear against the
 * same positive integer capital. A mismatched capital is a different
 * experiment universe and refuses as incomparable.
 */
export function assertFixedCapitalDenominator(
  capitalMicros: number | bigint,
  expectedCapitalMicros: number | bigint,
): bigint {
  const actual = assertIntegerMicros(capitalMicros, 'capitalMicros');
  const expected = assertIntegerMicros(expectedCapitalMicros, 'expectedCapitalMicros');
  if (actual <= 0n || expected <= 0n)
    throw new ObjError(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED, 'capital must be positive', {});
  if (actual !== expected)
    throw new ObjError(
      ObjErrorCode.OBJ_INCOMPARABLE_PROMOTION_REFUSED,
      'fills clear against different fixed capitals',
      { actual: actual.toString(), expected: expected.toString() },
    );
  return actual;
}

/**
 * Idempotent natural-key merge of versioned fills: dedupe by fill key
 * keeping the highest version. Re-merging the same fills is a no-op. A
 * repeated (fill, version) key with different line content is an attempted
 * rewrite of a versioned record and refuses.
 */
export function mergeFillVersions(
  current: readonly VersionedFill[],
  incoming: readonly VersionedFill[],
): VersionedFill[] {
  const merged = new Map<string, VersionedFill>();
  for (const fill of [...current, ...incoming]) {
    if (!Number.isSafeInteger(fill.version) || fill.version < 1)
      throw new ObjError(
        ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
        'fill version must be a positive integer',
        {
          fillId: fill.fillId,
        },
      );
    const key = fillNaturalKey(fill);
    const seen = merged.get(key);
    if (seen === undefined) {
      merged.set(key, fill);
      continue;
    }
    if (fill.version < seen.version) continue;
    if (fill.version === seen.version) {
      if (!sameLines(seen.lines, fill.lines))
        throw new ObjError(
          ObjErrorCode.OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED,
          'conflicting content for one fill version',
          { fillId: fill.fillId, version: String(fill.version) },
        );
      continue;
    }
    merged.set(key, fill);
  }
  return [...merged.values()].sort((left, right) =>
    fillNaturalKey(left) < fillNaturalKey(right) ? -1 : 1,
  );
}

function sameLines(
  left: Readonly<Partial<Record<UtilityLineKind, number | bigint>>>,
  right: Readonly<Partial<Record<UtilityLineKind, number | bigint>>>,
): boolean {
  for (const kind of ALL_UTILITY_LINE_KINDS) {
    const leftLine = left[kind];
    const rightLine = right[kind];
    if (typeof leftLine !== typeof rightLine) return false;
    if (typeof leftLine === 'bigint' || typeof rightLine === 'bigint') {
      if (BigInt(leftLine as number | bigint) !== BigInt(rightLine as number | bigint))
        return false;
    } else if (leftLine !== rightLine) return false;
  }
  return true;
}

/**
 * Fold versioned fills into per-capital-day net utility. Groups by
 * (run, capital-day), asserts one fixed capital per group, sums the
 * twelve lines exactly, and asserts reconciliation to net. Output order
 * is deterministic by (runId, capitalDay).
 */
export function foldFillLedger(
  fills: readonly VersionedFill[],
  expectedCapitalMicros?: number | bigint,
): CapitalDayUtility[] {
  const expected =
    expectedCapitalMicros === undefined
      ? undefined
      : assertIntegerMicros(expectedCapitalMicros, 'expectedCapitalMicros');
  const groups = new Map<string, VersionedFill[]>();
  for (const fill of mergeFillVersions([], fills)) {
    const key = `${fill.runId}|${fill.capitalDay}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [fill]);
    else group.push(fill);
  }
  const folded: CapitalDayUtility[] = [];
  const ordered = [...groups.values()].sort((left, right) => {
    const leftHead = left[0] as VersionedFill;
    const rightHead = right[0] as VersionedFill;
    const leftKey = `${leftHead.runId}|${leftHead.capitalDay}`;
    const rightKey = `${rightHead.runId}|${rightHead.capitalDay}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  for (const group of ordered) {
    const head = group[0] as VersionedFill;
    let capital = assertIntegerMicros(head.capitalMicros, 'capitalMicros');
    for (const fill of group) capital = assertFixedCapitalDenominator(fill.capitalMicros, capital);
    if (expected !== undefined) assertFixedCapitalDenominator(capital, expected);
    const totals = {} as Record<UtilityLineKind, bigint>;
    for (const kind of ALL_UTILITY_LINE_KINDS) totals[kind] = 0n;
    for (const fill of group) {
      assertDecompositionReconciles(fill.lines, sumLines(fill.lines));
      for (const kind of ALL_UTILITY_LINE_KINDS)
        totals[kind] += BigInt(fill.lines[kind] as number | bigint);
    }
    const net = sumTotals(totals);
    assertDecompositionReconciles(totals, net);
    folded.push({
      runId: head.runId,
      capitalDay: head.capitalDay,
      capitalMicros: capital,
      lines: totals,
      netMicros: net,
      fillCount: group.length,
    });
  }
  return folded;
}

function sumLines(lines: Readonly<Partial<Record<UtilityLineKind, number | bigint>>>): bigint {
  let total = 0n;
  for (const kind of ALL_UTILITY_LINE_KINDS) total += BigInt(lines[kind] as number | bigint);
  return total;
}

function sumTotals(totals: Readonly<Record<UtilityLineKind, bigint>>): bigint {
  let total = 0n;
  for (const kind of ALL_UTILITY_LINE_KINDS) total += totals[kind];
  return total;
}
