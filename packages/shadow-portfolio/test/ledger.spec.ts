/**
 * Unit tests for shadow-portfolio utility ledger (T015, FR-OBJ-001, FR-OBJ-004).
 *
 * Covers:
 * - Fold determinism: consistent grouping by (runId, capitalDay) and deterministic sorting
 * - Idempotent re-insert: deduplication by natural key, version monotonicity, conflict refusal
 * - Capital-day denominators: fixed-capital assertion and mismatch refusal
 * - Twelve-line reconciliation: exact micro-unit sum check across all 12 decomposition lines
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_UTILITY_LINE_KINDS,
  ObjError,
  ObjErrorCode,
  type UtilityLineKind,
} from '@foresift/domain';
import {
  assertFixedCapitalDenominator,
  fillNaturalKey,
  foldFillLedger,
  mergeFillVersions,
  type CapitalDayUtility,
  type VersionedFill,
} from '../src/index.ts';

const FIXED_CAPITAL_MICROS = 10_000_000_000n; // 10,000 capital units in micros

/** Helper to construct a full 12-line decomposition map. */
function makeValidLines(
  override: Partial<Record<UtilityLineKind, number | bigint>> = {},
): Record<UtilityLineKind, bigint> {
  const base: Record<UtilityLineKind, bigint> = {
    GROSS_RETURN: 100_000n,
    EXECUTION_COSTS: -5_000n,
    FAILED_PARTIAL_FILLS: -1_000n,
    DRAWDOWN: -2_000n,
    CVAR: -1_500n,
    CAPITAL_UTILIZATION: 500n,
    TURNOVER: -800n,
    OPPORTUNITY_COST: -400n,
    CONCENTRATION: -300n,
    SHARED_LIQUIDITY_IMPACT: -200n,
    PROVIDER_MODEL_INFRA_COST: -100n,
    UNCERTAINTY: -200n,
  };
  for (const [key, value] of Object.entries(override)) {
    base[key as UtilityLineKind] = BigInt(value as number | bigint);
  }
  return base;
}

function sumExpectedNet(lines: Readonly<Record<UtilityLineKind, bigint>>): bigint {
  let total = 0n;
  for (const kind of ALL_UTILITY_LINE_KINDS) {
    total += lines[kind];
  }
  return total;
}

function makeFill(partial: Partial<VersionedFill> & { readonly fillId: string }): VersionedFill {
  return {
    fillId: partial.fillId,
    version: partial.version ?? 1,
    runId: partial.runId ?? 'run-001',
    capitalDay: partial.capitalDay ?? '2026-01-01',
    capitalMicros: partial.capitalMicros ?? FIXED_CAPITAL_MICROS,
    lines: partial.lines ?? makeValidLines(),
  };
}

describe('shadow-portfolio utility ledger: natural keys and version merging (FR-OBJ-001, FR-OBJ-004)', () => {
  it('computes natural key as runId|capitalDay|fillId', () => {
    const key = fillNaturalKey({
      runId: 'run-alpha',
      capitalDay: '2026-03-15',
      fillId: 'fill-42',
    });
    expect(key).toBe('run-alpha|2026-03-15|fill-42');
  });

  it('merges identical fills idempotently (no-op deduplication)', () => {
    const fill1 = makeFill({ fillId: 'f1', version: 1 });
    const fill2 = makeFill({ fillId: 'f1', version: 1 });

    const merged = mergeFillVersions([fill1], [fill2]);
    expect(merged.length).toBe(1);
    expect(merged[0]).toEqual(fill1);
  });

  it('supersedes lower versions with higher versions', () => {
    const fillV1 = makeFill({
      fillId: 'f1',
      version: 1,
      lines: makeValidLines({ GROSS_RETURN: 100_000n }),
    });
    const fillV2 = makeFill({
      fillId: 'f1',
      version: 2,
      lines: makeValidLines({ GROSS_RETURN: 120_000n }),
    });

    // v2 arriving after v1
    const mergedForward = mergeFillVersions([fillV1], [fillV2]);
    expect(mergedForward.length).toBe(1);
    expect(mergedForward[0]?.version).toBe(2);
    expect(mergedForward[0]?.lines.GROSS_RETURN).toBe(120_000n);

    // v1 arriving after v2 (lower version is ignored)
    const mergedReverse = mergeFillVersions([fillV2], [fillV1]);
    expect(mergedReverse.length).toBe(1);
    expect(mergedReverse[0]?.version).toBe(2);
    expect(mergedReverse[0]?.lines.GROSS_RETURN).toBe(120_000n);
  });

  it('refuses conflicting content for the same fill version (OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED)', () => {
    const fillA = makeFill({
      fillId: 'f1',
      version: 1,
      lines: makeValidLines({ GROSS_RETURN: 100_000n }),
    });
    const fillB = makeFill({
      fillId: 'f1',
      version: 1,
      lines: makeValidLines({ GROSS_RETURN: 200_000n }),
    });

    expect(() => mergeFillVersions([fillA], [fillB])).toThrow(ObjError);
    try {
      mergeFillVersions([fillA], [fillB]);
    } catch (err) {
      expect(err).toBeInstanceOf(ObjError);
      expect((err as ObjError).code).toBe(ObjErrorCode.OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED);
    }
  });

  it('refuses non-positive or float version numbers (OBJ_FLOAT_ARITHMETIC_REFUSED)', () => {
    const fillZeroVersion = makeFill({ fillId: 'f1', version: 0 });
    expect(() => mergeFillVersions([], [fillZeroVersion])).toThrow(ObjError);

    const fillNegVersion = makeFill({ fillId: 'f2', version: -1 });
    expect(() => mergeFillVersions([], [fillNegVersion])).toThrow(ObjError);

    const fillFloatVersion = makeFill({ fillId: 'f3', version: 1.5 });
    expect(() => mergeFillVersions([], [fillFloatVersion])).toThrow(ObjError);
  });

  it('sorts merged fills deterministically by natural key', () => {
    const fillZ = makeFill({ runId: 'run-b', capitalDay: '2026-01-02', fillId: 'fill-z' });
    const fillA = makeFill({ runId: 'run-a', capitalDay: '2026-01-01', fillId: 'fill-a' });
    const fillB = makeFill({ runId: 'run-a', capitalDay: '2026-01-01', fillId: 'fill-b' });

    const merged = mergeFillVersions([], [fillZ, fillB, fillA]);
    expect(merged.map((f) => fillNaturalKey(f))).toEqual([
      'run-a|2026-01-01|fill-a',
      'run-a|2026-01-01|fill-b',
      'run-b|2026-01-02|fill-z',
    ]);
  });
});

describe('shadow-portfolio utility ledger: fixed-capital denominators (FR-OBJ-001)', () => {
  it('accepts matching positive capital and returns bigint', () => {
    const capital = assertFixedCapitalDenominator(10_000_000n, 10_000_000n);
    expect(capital).toBe(10_000_000n);

    const capitalNum = assertFixedCapitalDenominator(10_000_000, 10_000_000n);
    expect(capitalNum).toBe(10_000_000n);
  });

  it('refuses mismatched capital across fills (OBJ_INCOMPARABLE_PROMOTION_REFUSED)', () => {
    expect(() => assertFixedCapitalDenominator(10_000_000n, 20_000_000n)).toThrow(ObjError);
    try {
      assertFixedCapitalDenominator(10_000_000n, 20_000_000n);
    } catch (err) {
      expect(err).toBeInstanceOf(ObjError);
      expect((err as ObjError).code).toBe(ObjErrorCode.OBJ_INCOMPARABLE_PROMOTION_REFUSED);
    }
  });

  it('refuses non-positive capital (OBJ_FLOAT_ARITHMETIC_REFUSED)', () => {
    expect(() => assertFixedCapitalDenominator(0n, 0n)).toThrow(ObjError);
    expect(() => assertFixedCapitalDenominator(-100n, -100n)).toThrow(ObjError);
  });

  it('refuses binary floating-point capital (OBJ_FLOAT_ARITHMETIC_REFUSED)', () => {
    expect(() => assertFixedCapitalDenominator(10_000.5, 10_000.5)).toThrow(ObjError);
  });
});

describe('shadow-portfolio utility ledger: fold determinism and twelve-line reconciliation (FR-OBJ-001, FR-OBJ-004)', () => {
  it('returns empty array when folding empty fill list', () => {
    const folded = foldFillLedger([]);
    expect(folded).toEqual([]);
  });

  it('folds multiple fills in the same capital-day and reconciles 12 lines exactly', () => {
    const lines1 = makeValidLines({
      GROSS_RETURN: 50_000n,
      EXECUTION_COSTS: -2_000n,
    });
    const lines2 = makeValidLines({
      GROSS_RETURN: 70_000n,
      EXECUTION_COSTS: -3_000n,
    });

    const fill1 = makeFill({ fillId: 'f1', lines: lines1 });
    const fill2 = makeFill({ fillId: 'f2', lines: lines2 });

    const folded = foldFillLedger([fill1, fill2]);
    expect(folded.length).toBe(1);

    const dayUtility = folded[0] as CapitalDayUtility;
    expect(dayUtility.runId).toBe('run-001');
    expect(dayUtility.capitalDay).toBe('2026-01-01');
    expect(dayUtility.capitalMicros).toBe(FIXED_CAPITAL_MICROS);
    expect(dayUtility.fillCount).toBe(2);

    // Check sum of each line
    expect(dayUtility.lines.GROSS_RETURN).toBe(120_000n);
    expect(dayUtility.lines.EXECUTION_COSTS).toBe(-5_000n);
    expect(dayUtility.lines.FAILED_PARTIAL_FILLS).toBe(-2_000n);
    expect(dayUtility.lines.DRAWDOWN).toBe(-4_000n);
    expect(dayUtility.lines.CVAR).toBe(-3_000n);
    expect(dayUtility.lines.CAPITAL_UTILIZATION).toBe(1_000n);
    expect(dayUtility.lines.TURNOVER).toBe(-1_600n);
    expect(dayUtility.lines.OPPORTUNITY_COST).toBe(-800n);
    expect(dayUtility.lines.CONCENTRATION).toBe(-600n);
    expect(dayUtility.lines.SHARED_LIQUIDITY_IMPACT).toBe(-400n);
    expect(dayUtility.lines.PROVIDER_MODEL_INFRA_COST).toBe(-200n);
    expect(dayUtility.lines.UNCERTAINTY).toBe(-400n);

    // Exact reconciliation
    const expectedNet = sumExpectedNet(dayUtility.lines);
    expect(dayUtility.netMicros).toBe(expectedNet);
  });

  it('produces bit-deterministic results regardless of input fill order', () => {
    const fill1 = makeFill({
      runId: 'run-A',
      capitalDay: '2026-01-01',
      fillId: 'f1',
      lines: makeValidLines({ GROSS_RETURN: 10_000n }),
    });
    const fill2 = makeFill({
      runId: 'run-A',
      capitalDay: '2026-01-02',
      fillId: 'f2',
      lines: makeValidLines({ GROSS_RETURN: 20_000n }),
    });
    const fill3 = makeFill({
      runId: 'run-B',
      capitalDay: '2026-01-01',
      fillId: 'f3',
      lines: makeValidLines({ GROSS_RETURN: 30_000n }),
    });

    const foldedForward = foldFillLedger([fill1, fill2, fill3]);
    const foldedPermuted = foldFillLedger([fill3, fill1, fill2]);
    const foldedReverse = foldFillLedger([fill2, fill3, fill1]);

    expect(foldedForward).toEqual(foldedPermuted);
    expect(foldedForward).toEqual(foldedReverse);

    // Order must be sorted by runId, then capitalDay
    expect(foldedForward.map((f) => `${f.runId}|${f.capitalDay}`)).toEqual([
      'run-A|2026-01-01',
      'run-A|2026-01-02',
      'run-B|2026-01-01',
    ]);
  });

  it('enforces expected capital micros across all folded groups when specified', () => {
    const fill1 = makeFill({ fillId: 'f1', capitalMicros: 10_000_000n });
    const fill2 = makeFill({ fillId: 'f2', capitalMicros: 10_000_000n });

    // Matches expected capital
    const folded = foldFillLedger([fill1, fill2], 10_000_000n);
    expect(folded.length).toBe(1);
    expect(folded[0]?.capitalMicros).toBe(10_000_000n);

    // Mismatches expected capital -> throws OBJ_INCOMPARABLE_PROMOTION_REFUSED
    expect(() => foldFillLedger([fill1, fill2], 20_000_000n)).toThrow(ObjError);
    try {
      foldFillLedger([fill1, fill2], 20_000_000n);
    } catch (err) {
      expect(err).toBeInstanceOf(ObjError);
      expect((err as ObjError).code).toBe(ObjErrorCode.OBJ_INCOMPARABLE_PROMOTION_REFUSED);
    }
  });

  it('refuses fills with differing capital within the same (runId, capitalDay) group', () => {
    const fill1 = makeFill({ fillId: 'f1', capitalMicros: 10_000_000n });
    const fill2 = makeFill({ fillId: 'f2', capitalMicros: 20_000_000n });

    expect(() => foldFillLedger([fill1, fill2])).toThrow(ObjError);
    try {
      foldFillLedger([fill1, fill2]);
    } catch (err) {
      expect(err).toBeInstanceOf(ObjError);
      expect((err as ObjError).code).toBe(ObjErrorCode.OBJ_INCOMPARABLE_PROMOTION_REFUSED);
    }
  });

  it('refuses fills with incomplete decomposition lines or invalid numbers', () => {
    // Missing lines
    const incompleteLines = {
      GROSS_RETURN: 100_000n,
      EXECUTION_COSTS: -5_000n,
    } as Partial<Record<UtilityLineKind, number | bigint>>;

    const badFill = makeFill({ fillId: 'f-bad', lines: incompleteLines });
    expect(() => foldFillLedger([badFill])).toThrow();

    // Float in line values
    const floatLines = makeValidLines();
    (floatLines as unknown as Record<string, number>).GROSS_RETURN = 100.5;
    const floatFill = makeFill({ fillId: 'f-float', lines: floatLines });
    expect(() => foldFillLedger([floatFill])).toThrow();
  });

  it('handles safe-integer number inputs and bigints transparently', () => {
    const linesWithNumbers: Partial<Record<UtilityLineKind, number | bigint>> = {
      GROSS_RETURN: 100000,
      EXECUTION_COSTS: -5000,
      FAILED_PARTIAL_FILLS: -1000,
      DRAWDOWN: -2000,
      CVAR: -1500,
      CAPITAL_UTILIZATION: 500,
      TURNOVER: -800,
      OPPORTUNITY_COST: -400,
      CONCENTRATION: -300,
      SHARED_LIQUIDITY_IMPACT: -200,
      PROVIDER_MODEL_INFRA_COST: -100,
      UNCERTAINTY: -200,
    };

    const fill = makeFill({
      fillId: 'f-num',
      capitalMicros: 10_000_000,
      lines: linesWithNumbers,
    });

    const folded = foldFillLedger([fill]);
    expect(folded.length).toBe(1);
    expect(folded[0]?.capitalMicros).toBe(10_000_000n);
    expect(folded[0]?.lines.GROSS_RETURN).toBe(100_000n);
    expect(folded[0]?.netMicros).toBe(89_000n);
  });
});
