/**
 * Objective governance domain vocabularies, stable error codes, and pure laws (T013, FR-OBJ-001…010).
 * Tests fail-closed parsing of the 14 closed vocabularies, integer arithmetic helpers,
 * and pure laws: comparabilityRequiresAllDimensions, hardConstraintsPrecedeUtility,
 * lowerBoundUtility, decompositionReconciles, diagnosticsExcludedByConstruction,
 * integrityFailureBlocksPromotion, claimScopeComplete, robustDelayRequired,
 * frozenRecordImmutable, assertFrozenParentHash, uncertaintyDisclosureRequired.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_CLAIM_SCOPE_FIELDS,
  ALL_COMPARISON_DIMENSIONS,
  ALL_DELAY_SCENARIOS,
  ALL_DIAGNOSTIC_KINDS,
  ALL_HARD_CONSTRAINT_KINDS,
  ALL_HARD_CONSTRAINT_VERDICTS,
  ALL_INTEGRITY_SIGNAL_KINDS,
  ALL_INTEGRITY_VERDICTS,
  ALL_OBJ_ERROR_CODES,
  ALL_PROHIBITED_CLAIM_KINDS,
  ALL_PROMOTION_VERDICTS,
  ALL_RUN_COMPARABILITIES,
  ALL_SENSITIVITY_DIMENSIONS,
  ALL_UTILITY_LINE_KINDS,
  CLAIM_SCOPE_FIELDS,
  COMPARISON_DIMENSIONS,
  type ClaimScopeField,
  DELAY_SCENARIOS,
  DIAGNOSTIC_INPUT_KEYS,
  DIAGNOSTIC_KINDS,
  DelayScenario,
  HARD_CONSTRAINT_KINDS,
  HARD_CONSTRAINT_VERDICTS,
  HardConstraintVerdict,
  INTEGRITY_SIGNAL_KINDS,
  INTEGRITY_VERDICTS,
  type IntegritySignalKind,
  MICRO_UNIT_SCALE,
  OBJ_ERROR_CODES,
  ObjError,
  ObjErrorCode,
  PROHIBITED_CLAIM_KINDS,
  PROMOTION_VERDICTS,
  RUN_COMPARABILITIES,
  RunComparability,
  SENSITIVITY_DIMENSIONS,
  UNCERTAINTY_DISCLOSURE_TEXT,
  UTILITY_LINE_KINDS,
  type UtilityLineKind,
  Z_ONE_SIDED_95_MICROS,
  assertDecompositionReconciles,
  assertFrozenParentHash,
  assertIntegerMicros,
  ceilDiv,
  claimScopeComplete,
  claimScopeField,
  claimScopeMissing,
  comparabilityRequiresAllDimensions,
  comparisonDimension,
  decompositionReconciles,
  delayScenario,
  diagnosticKind,
  diagnosticsExcludedByConstruction,
  floorDiv,
  frozenRecordImmutable,
  hardConstraintKind,
  hardConstraintVerdict,
  hardConstraintsPrecedeUtility,
  integrityFailureBlocksPromotion,
  integritySignal,
  integrityVerdict,
  isObjError,
  isqrtCeil,
  isqrtFloor,
  lowerBoundUtility,
  parseClaimScopeField,
  parseComparisonDimension,
  parseDelayScenario,
  parseDiagnosticKind,
  parseHardConstraintKind,
  parseHardConstraintVerdict,
  parseIntegritySignal,
  parseIntegrityVerdict,
  parseProhibitedClaim,
  parsePromotionVerdict,
  parseRunComparability,
  parseSensitivityDimension,
  parseUtilityLineKind,
  prohibitedClaim,
  promotionVerdict,
  robustDelayRequired,
  runComparability,
  sensitivityDimension,
  uncertaintyDisclosureRequired,
  utilityLineKind,
} from '../src/index.ts';

describe('Objective Governance Vocabularies and Fail-Closed Parsing (FR-OBJ-001…010)', () => {
  // 1. ComparisonDimension
  it('enumerates all 8 ComparisonDimension members and parses fail-closed', () => {
    expect(ALL_COMPARISON_DIMENSIONS).toHaveLength(8);
    expect(COMPARISON_DIMENSIONS).toEqual(ALL_COMPARISON_DIMENSIONS);
    for (const member of ALL_COMPARISON_DIMENSIONS) {
      expect(parseComparisonDimension(member)).toBe(member);
      expect(comparisonDimension(member)).toBe(member);
    }
    expect(() => parseComparisonDimension('INVALID_DIMENSION')).toThrow(ObjError);
    try {
      parseComparisonDimension('INVALID_DIMENSION');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_DIMENSION_UNKNOWN);
      }
    }
  });

  // 2. RunComparability
  it('enumerates all 2 RunComparability members and parses fail-closed', () => {
    expect(ALL_RUN_COMPARABILITIES).toHaveLength(2);
    expect(RUN_COMPARABILITIES).toEqual(ALL_RUN_COMPARABILITIES);
    for (const member of ALL_RUN_COMPARABILITIES) {
      expect(parseRunComparability(member)).toBe(member);
      expect(runComparability(member)).toBe(member);
    }
    expect(() => parseRunComparability('UNKNOWN_COMPARABILITY')).toThrow(ObjError);
    try {
      parseRunComparability('UNKNOWN_COMPARABILITY');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_COMPARABILITY_UNKNOWN);
      }
    }
  });

  // 3. HardConstraintKind
  it('enumerates all 7 HardConstraintKind members and parses fail-closed', () => {
    expect(ALL_HARD_CONSTRAINT_KINDS).toHaveLength(7);
    expect(HARD_CONSTRAINT_KINDS).toEqual(ALL_HARD_CONSTRAINT_KINDS);
    for (const member of ALL_HARD_CONSTRAINT_KINDS) {
      expect(parseHardConstraintKind(member)).toBe(member);
      expect(hardConstraintKind(member)).toBe(member);
    }
    expect(() => parseHardConstraintKind('UNCONSTRAINED_RISK')).toThrow(ObjError);
    try {
      parseHardConstraintKind('UNCONSTRAINED_RISK');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_CONSTRAINT_KIND_UNKNOWN);
      }
    }
  });

  // 4. HardConstraintVerdict
  it('enumerates all 2 HardConstraintVerdict members and parses fail-closed', () => {
    expect(ALL_HARD_CONSTRAINT_VERDICTS).toHaveLength(2);
    expect(HARD_CONSTRAINT_VERDICTS).toEqual(ALL_HARD_CONSTRAINT_VERDICTS);
    for (const member of ALL_HARD_CONSTRAINT_VERDICTS) {
      expect(parseHardConstraintVerdict(member)).toBe(member);
      expect(hardConstraintVerdict(member)).toBe(member);
    }
    expect(() => parseHardConstraintVerdict('MAYBE')).toThrow(ObjError);
    try {
      parseHardConstraintVerdict('MAYBE');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_CONSTRAINT_VERDICT_UNKNOWN);
      }
    }
  });

  // 5. UtilityLineKind
  it('enumerates all 12 UtilityLineKind members and parses fail-closed', () => {
    expect(ALL_UTILITY_LINE_KINDS).toHaveLength(12);
    expect(UTILITY_LINE_KINDS).toEqual(ALL_UTILITY_LINE_KINDS);
    for (const member of ALL_UTILITY_LINE_KINDS) {
      expect(parseUtilityLineKind(member)).toBe(member);
      expect(utilityLineKind(member)).toBe(member);
    }
    expect(() => parseUtilityLineKind('UNKNOWN_FEE')).toThrow(ObjError);
    try {
      parseUtilityLineKind('UNKNOWN_FEE');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_LINE_KIND_UNKNOWN);
      }
    }
  });

  // 6. DiagnosticKind
  it('enumerates all 4 DiagnosticKind members and parses fail-closed', () => {
    expect(ALL_DIAGNOSTIC_KINDS).toHaveLength(4);
    expect(DIAGNOSTIC_KINDS).toEqual(ALL_DIAGNOSTIC_KINDS);
    for (const member of ALL_DIAGNOSTIC_KINDS) {
      expect(parseDiagnosticKind(member)).toBe(member);
      expect(diagnosticKind(member)).toBe(member);
    }
    expect(() => parseDiagnosticKind('SHARPE_RATIO')).toThrow(ObjError);
    try {
      parseDiagnosticKind('SHARPE_RATIO');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_DIAGNOSTIC_KIND_UNKNOWN);
      }
    }
  });

  // 7. IntegritySignalKind
  it('enumerates all 7 IntegritySignalKind members and parses fail-closed', () => {
    expect(ALL_INTEGRITY_SIGNAL_KINDS).toHaveLength(7);
    expect(INTEGRITY_SIGNAL_KINDS).toEqual(ALL_INTEGRITY_SIGNAL_KINDS);
    for (const member of ALL_INTEGRITY_SIGNAL_KINDS) {
      expect(parseIntegritySignal(member)).toBe(member);
      expect(integritySignal(member)).toBe(member);
    }
    expect(() => parseIntegritySignal('UNAUTHORIZED_MODIFICATION')).toThrow(ObjError);
    try {
      parseIntegritySignal('UNAUTHORIZED_MODIFICATION');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_INTEGRITY_SIGNAL_UNKNOWN);
      }
    }
  });

  // 8. IntegrityVerdict
  it('enumerates all 2 IntegrityVerdict members and parses fail-closed with blocking error', () => {
    expect(ALL_INTEGRITY_VERDICTS).toHaveLength(2);
    expect(INTEGRITY_VERDICTS).toEqual(ALL_INTEGRITY_VERDICTS);
    for (const member of ALL_INTEGRITY_VERDICTS) {
      expect(parseIntegrityVerdict(member)).toBe(member);
      expect(integrityVerdict(member)).toBe(member);
    }
    expect(() => parseIntegrityVerdict('IGNORE_FAILURE')).toThrow(ObjError);
    try {
      parseIntegrityVerdict('IGNORE_FAILURE');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION);
      }
    }
  });

  // 9. ClaimScopeField
  it('enumerates all 11 ClaimScopeField members and parses fail-closed', () => {
    expect(ALL_CLAIM_SCOPE_FIELDS).toHaveLength(11);
    expect(CLAIM_SCOPE_FIELDS).toEqual(ALL_CLAIM_SCOPE_FIELDS);
    for (const member of ALL_CLAIM_SCOPE_FIELDS) {
      expect(parseClaimScopeField(member)).toBe(member);
      expect(claimScopeField(member)).toBe(member);
    }
    expect(() => parseClaimScopeField('EXTRA_UNPROVEN_CLAIM')).toThrow(ObjError);
    try {
      parseClaimScopeField('EXTRA_UNPROVEN_CLAIM');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_CLAIM_FIELD_UNKNOWN);
      }
    }
  });

  // 10. DelayScenario
  it('enumerates all 3 DelayScenario members and parses fail-closed', () => {
    expect(ALL_DELAY_SCENARIOS).toHaveLength(3);
    expect(DELAY_SCENARIOS).toEqual(ALL_DELAY_SCENARIOS);
    for (const member of ALL_DELAY_SCENARIOS) {
      expect(parseDelayScenario(member)).toBe(member);
      expect(delayScenario(member)).toBe(member);
    }
    expect(() => parseDelayScenario('P99_OPTIMISTIC')).toThrow(ObjError);
    try {
      parseDelayScenario('P99_OPTIMISTIC');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_DELAY_SCENARIO_UNKNOWN);
      }
    }
  });

  // 11. SensitivityDimension
  it('enumerates all 7 SensitivityDimension members and parses fail-closed', () => {
    expect(ALL_SENSITIVITY_DIMENSIONS).toHaveLength(7);
    expect(SENSITIVITY_DIMENSIONS).toEqual(ALL_SENSITIVITY_DIMENSIONS);
    for (const member of ALL_SENSITIVITY_DIMENSIONS) {
      expect(parseSensitivityDimension(member)).toBe(member);
      expect(sensitivityDimension(member)).toBe(member);
    }
    expect(() => parseSensitivityDimension('UNBOUNDED_LEVERAGE')).toThrow(ObjError);
    try {
      parseSensitivityDimension('UNBOUNDED_LEVERAGE');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_SENSITIVITY_DIMENSION_UNKNOWN);
      }
    }
  });

  // 12. ProhibitedClaimKind
  it('enumerates all 4 ProhibitedClaimKind members and parses fail-closed', () => {
    expect(ALL_PROHIBITED_CLAIM_KINDS).toHaveLength(4);
    expect(PROHIBITED_CLAIM_KINDS).toEqual(ALL_PROHIBITED_CLAIM_KINDS);
    for (const member of ALL_PROHIBITED_CLAIM_KINDS) {
      expect(parseProhibitedClaim(member)).toBe(member);
      expect(prohibitedClaim(member)).toBe(member);
    }
    expect(() => parseProhibitedClaim('INFINITE_PROFIT')).toThrow(ObjError);
    try {
      parseProhibitedClaim('INFINITE_PROFIT');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_PROHIBITED_CLAIM_UNKNOWN);
      }
    }
  });

  // 13. PromotionVerdict
  it('enumerates all 3 PromotionVerdict members and parses fail-closed', () => {
    expect(ALL_PROMOTION_VERDICTS).toHaveLength(3);
    expect(PROMOTION_VERDICTS).toEqual(ALL_PROMOTION_VERDICTS);
    for (const member of ALL_PROMOTION_VERDICTS) {
      expect(parsePromotionVerdict(member)).toBe(member);
      expect(promotionVerdict(member)).toBe(member);
    }
    expect(() => parsePromotionVerdict('AUTO_PROMOTE')).toThrow(ObjError);
    try {
      parsePromotionVerdict('AUTO_PROMOTE');
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_PROMOTION_VERDICT_UNKNOWN);
      }
    }
  });

  // 14. Error codes, constants, and ObjError guard
  it('enumerates all 22 ObjErrorCode members and verifies error class behavior', () => {
    expect(ALL_OBJ_ERROR_CODES).toHaveLength(22);
    expect(OBJ_ERROR_CODES).toEqual(ALL_OBJ_ERROR_CODES);
    expect(Z_ONE_SIDED_95_MICROS).toBe(1644854);
    expect(MICRO_UNIT_SCALE).toBe(1000000);
    expect(UNCERTAINTY_DISCLOSURE_TEXT).toBe(
      'Opportunity outputs are evidence-backed research signals whose realized outcome remains uncertain.',
    );

    const err = new ObjError(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED, 'float denied', {
      value: '1.23',
    });
    expect(isObjError(err)).toBe(true);
    expect(err.code).toBe(ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED);
    expect(err.name).toBe('ObjError');
    expect(err.detail).toEqual({ value: '1.23' });
    expect(isObjError(new Error('generic error'))).toBe(false);
    expect(isObjError(null)).toBe(false);
    expect(isObjError(undefined)).toBe(false);
    expect(isObjError({})).toBe(false);
  });
});

describe('Integer Arithmetic and LCB Math Helpers (ADR-OBJ-01, FR-OBJ-001)', () => {
  it('ceilDiv performs exact ceiling integer division for positive divisors', () => {
    expect(ceilDiv(7n, 3n)).toBe(3n);
    expect(ceilDiv(6n, 3n)).toBe(2n);
    expect(ceilDiv(0n, 5n)).toBe(0n);
    expect(ceilDiv(-7n, 3n)).toBe(-2n);
    expect(ceilDiv(-6n, 3n)).toBe(-2n);
    expect(() => ceilDiv(5n, 0n)).toThrow(ObjError);
    expect(() => ceilDiv(5n, -2n)).toThrow(ObjError);
  });

  it('floorDiv performs exact flooring integer division for positive divisors', () => {
    expect(floorDiv(7n, 3n)).toBe(2n);
    expect(floorDiv(6n, 3n)).toBe(2n);
    expect(floorDiv(0n, 5n)).toBe(0n);
    expect(floorDiv(-7n, 3n)).toBe(-3n);
    expect(floorDiv(-6n, 3n)).toBe(-2n);
    expect(() => floorDiv(5n, 0n)).toThrow(ObjError);
    expect(() => floorDiv(5n, -2n)).toThrow(ObjError);
  });

  it('isqrtFloor and isqrtCeil compute integer square roots without floating point', () => {
    expect(isqrtFloor(0n)).toBe(0n);
    expect(isqrtFloor(1n)).toBe(1n);
    expect(isqrtFloor(8n)).toBe(2n);
    expect(isqrtFloor(9n)).toBe(3n);
    expect(isqrtFloor(15n)).toBe(3n);
    expect(isqrtFloor(16n)).toBe(4n);
    expect(() => isqrtFloor(-1n)).toThrow(ObjError);

    expect(isqrtCeil(0n)).toBe(0n);
    expect(isqrtCeil(1n)).toBe(1n);
    expect(isqrtCeil(8n)).toBe(3n);
    expect(isqrtCeil(9n)).toBe(3n);
    expect(isqrtCeil(10n)).toBe(4n);
    expect(isqrtCeil(16n)).toBe(4n);
    expect(() => isqrtCeil(-1n)).toThrow(ObjError);
  });

  it('assertIntegerMicros enforces integer types and refuses floating point', () => {
    expect(assertIntegerMicros(1000n, 'test')).toBe(1000n);
    expect(assertIntegerMicros(1000, 'test')).toBe(1000n);
    expect(assertIntegerMicros(-500, 'test')).toBe(-500n);
    expect(() => assertIntegerMicros(1.5, 'test')).toThrow(ObjError);
    expect(() => assertIntegerMicros(Number.NaN, 'test')).toThrow(ObjError);
    expect(() => assertIntegerMicros(Number.POSITIVE_INFINITY, 'test')).toThrow(ObjError);
    expect(() => assertIntegerMicros(Number.MAX_SAFE_INTEGER + 10, 'test')).toThrow(ObjError);
  });
});

describe('Objective Pure Laws (FR-OBJ-001…010)', () => {
  // Pure Law 1: comparabilityRequiresAllDimensions (FR-OBJ-002)
  it('pure law: comparabilityRequiresAllDimensions enforces 8-dimension identity (FR-OBJ-002)', () => {
    const validRunA = {
      runId: 'run-a',
      dimensions: {
        CANDIDATE_UNIVERSE: 'univ_sol',
        POPULATION_CLAIM: 'pop_sol',
        CAPITAL: '100000000',
        TIME_WINDOW: '2026-01-01/2026-06-30',
        EXECUTION_SCENARIO: 'exec_p50',
        DELAY_POLICY: 'delay_p50_p90_tail',
        DATA_CUTOFF: '2026-06-30T00:00:00Z',
        CORRELATED_EXPOSURE: 'cap_10pct',
      },
    };

    const validRunB = {
      runId: 'run-b',
      dimensions: { ...validRunA.dimensions },
    };

    expect(comparabilityRequiresAllDimensions(validRunA, validRunB)).toBe(
      RunComparability.COMPARABLE,
    );

    // Mismatched dimension yields EXPLORATORY_ONLY
    const mismatchedUniverse = {
      runId: 'run-c',
      dimensions: { ...validRunA.dimensions, CANDIDATE_UNIVERSE: 'univ_eth' },
    };
    expect(comparabilityRequiresAllDimensions(validRunA, mismatchedUniverse)).toBe(
      RunComparability.EXPLORATORY_ONLY,
    );

    const mismatchedCapital = {
      runId: 'run-d',
      dimensions: { ...validRunA.dimensions, CAPITAL: '500000000' },
    };
    expect(comparabilityRequiresAllDimensions(validRunA, mismatchedCapital)).toBe(
      RunComparability.EXPLORATORY_ONLY,
    );

    // Null/undefined records throw OBJ_INCOMPARABLE_PROMOTION_REFUSED
    expect(() => comparabilityRequiresAllDimensions(null, validRunB)).toThrow(ObjError);
    expect(() => comparabilityRequiresAllDimensions(validRunA, undefined)).toThrow(ObjError);

    // Missing dimension throws OBJ_DIMENSION_UNKNOWN
    const { CORRELATED_EXPOSURE: _omittedDimension, ...reducedDimensions } = validRunA.dimensions;
    const missingDimension = {
      runId: 'run-e',
      dimensions: reducedDimensions,
    };
    expect(() => comparabilityRequiresAllDimensions(validRunA, missingDimension)).toThrow(ObjError);
  });

  // Pure Law 2: hardConstraintsPrecedeUtility (FR-OBJ-003)
  it('pure law: hardConstraintsPrecedeUtility rejects any failed or unevaluated kind (FR-OBJ-003)', () => {
    const allPassing = {
      SECURITY: HardConstraintVerdict.PASS,
      EXECUTION: HardConstraintVerdict.PASS,
      RIGHTS: HardConstraintVerdict.PASS,
      LEAKAGE: HardConstraintVerdict.PASS,
      PUBLIC_CLAIM: HardConstraintVerdict.PASS,
      CAPACITY: HardConstraintVerdict.PASS,
      TAIL_RISK: HardConstraintVerdict.PASS,
    } as const;

    expect(() => hardConstraintsPrecedeUtility(allPassing)).not.toThrow();

    // Any FAIL throws OBJ_HARD_CONSTRAINT_FAILED
    for (const kind of ALL_HARD_CONSTRAINT_KINDS) {
      const failing = { ...allPassing, [kind]: HardConstraintVerdict.FAIL };
      expect(() => hardConstraintsPrecedeUtility(failing)).toThrow(ObjError);
      try {
        hardConstraintsPrecedeUtility(failing);
      } catch (e) {
        expect(isObjError(e)).toBe(true);
        if (isObjError(e)) {
          expect(e.code).toBe(ObjErrorCode.OBJ_HARD_CONSTRAINT_FAILED);
          expect(e.detail.kind).toBe(kind);
        }
      }
    }

    // Unevaluated kind throws OBJ_HARD_CONSTRAINT_FAILED
    const { TAIL_RISK: _omittedTailRisk, ...unevaluated } = allPassing;
    expect(() => hardConstraintsPrecedeUtility(unevaluated)).toThrow(ObjError);
  });

  // Pure Law 3: lowerBoundUtility (FR-OBJ-001)
  it('pure law: lowerBoundUtility computes conservative integer LCB (FR-OBJ-001)', () => {
    // 100 days of constant 100_000 net utility -> mean = 100_000, var = 0, margin = 0 -> LCB = 100_000
    const constResult = lowerBoundUtility({
      sumMicros: 10_000_000n,
      sumSquaresMicros: 1_000_000_000_000n,
      count: 100n,
    });
    expect(constResult).toBe(100_000n);

    // Variable series
    const varResult = lowerBoundUtility({
      sumMicros: 10_000_000n,
      sumSquaresMicros: 2_000_000_000_000n,
      count: 100n,
    });
    expect(varResult).toBeLessThan(100_000n);

    // Empty series refuses fail-closed
    expect(() =>
      lowerBoundUtility({
        sumMicros: 0n,
        sumSquaresMicros: 0n,
        count: 0n,
      }),
    ).toThrow(ObjError);

    // Floating-point count or sums refuse
    expect(() =>
      lowerBoundUtility({
        sumMicros: 1.5,
        sumSquaresMicros: 2,
        count: 10,
      }),
    ).toThrow(ObjError);
  });

  // Pure Law 4: decompositionReconciles (FR-OBJ-004)
  it('pure law: decompositionReconciles ensures twelve lines sum exactly to net (FR-OBJ-004)', () => {
    const validLines: Record<UtilityLineKind, bigint> = {
      GROSS_RETURN: 100_000n,
      EXECUTION_COSTS: -10_000n,
      FAILED_PARTIAL_FILLS: -5_000n,
      DRAWDOWN: -15_000n,
      CVAR: -10_000n,
      CAPITAL_UTILIZATION: 5_000n,
      TURNOVER: -2_000n,
      OPPORTUNITY_COST: -8_000n,
      CONCENTRATION: -3_000n,
      SHARED_LIQUIDITY_IMPACT: -4_000n,
      PROVIDER_MODEL_INFRA_COST: -3_000n,
      UNCERTAINTY: -10_000n,
    };
    // Sum = 100k - 10k - 5k - 15k - 10k + 5k - 2k - 8k - 3k - 4k - 3k - 10k = 35_000n
    expect(decompositionReconciles(validLines, 35_000n)).toBe(true);
    expect(decompositionReconciles(validLines, 35_001n)).toBe(false);
    expect(() => assertDecompositionReconciles(validLines, 35_000n)).not.toThrow();
    expect(() => assertDecompositionReconciles(validLines, 35_001n)).toThrow(ObjError);

    // Missing line returns false / throws
    const { CVAR: _omittedCvar, ...missingLine } = validLines;
    expect(decompositionReconciles(missingLine, 35_000n)).toBe(false);
    expect(() => assertDecompositionReconciles(missingLine, 35_000n)).toThrow(ObjError);

    // Float line returns false / throws
    const floatLine = { ...validLines, CVAR: 1.25 as unknown as number };
    expect(decompositionReconciles(floatLine, 35_000n)).toBe(false);
    expect(() => assertDecompositionReconciles(floatLine, 35_000n)).toThrow(ObjError);
  });

  // Pure Law 5: diagnosticsExcludedByConstruction (FR-OBJ-005)
  it('pure law: diagnosticsExcludedByConstruction rejects diagnostic keys on verdict inputs (FR-OBJ-005)', () => {
    expect(DIAGNOSTIC_INPUT_KEYS).toEqual(ALL_DIAGNOSTIC_KINDS);

    // Clean verdict candidate passes
    expect(() =>
      diagnosticsExcludedByConstruction({
        runId: 'run-001',
        lowerBoundUtilityMicros: 50_000n,
      }),
    ).not.toThrow();

    // Candidate carrying any diagnostic key throws OBJ_DIAGNOSTIC_AS_OBJECTIVE_REFUSED
    for (const key of ALL_DIAGNOSTIC_KINDS) {
      expect(() =>
        diagnosticsExcludedByConstruction({
          runId: 'run-001',
          lowerBoundUtilityMicros: 50_000n,
          [key]: 0.95,
        }),
      ).toThrow(ObjError);
      try {
        diagnosticsExcludedByConstruction({
          runId: 'run-001',
          [key]: 0.95,
        });
      } catch (e) {
        expect(isObjError(e)).toBe(true);
        if (isObjError(e)) {
          expect(e.code).toBe(ObjErrorCode.OBJ_DIAGNOSTIC_AS_OBJECTIVE_REFUSED);
          expect(e.detail.key).toBe(key);
        }
      }
    }
  });

  // Pure Law 6: integrityFailureBlocksPromotion (FR-OBJ-006)
  it('pure law: integrityFailureBlocksPromotion blocks on any firing or unevaluated signal (FR-OBJ-006)', () => {
    const allPassingSignals: Record<IntegritySignalKind, boolean> = {
      DENOMINATOR_GAMING: false,
      SELECTIVE_UNIVERSE_CHANGE: false,
      REDUCED_EXPLORATION: false,
      DELAYED_OUTCOME_OMISSION: false,
      HORIZON_SWITCHING: false,
      SCENARIO_CHERRY_PICKING: false,
      REPEATED_HOLDOUT_INSPECTION: false,
    };

    expect(() => integrityFailureBlocksPromotion(allPassingSignals)).not.toThrow();

    // Any firing signal throws OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION
    for (const signal of ALL_INTEGRITY_SIGNAL_KINDS) {
      const failing = { ...allPassingSignals, [signal]: true };
      expect(() => integrityFailureBlocksPromotion(failing)).toThrow(ObjError);
      try {
        integrityFailureBlocksPromotion(failing);
      } catch (e) {
        expect(isObjError(e)).toBe(true);
        if (isObjError(e)) {
          expect(e.code).toBe(ObjErrorCode.OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION);
        }
      }
    }

    // Unevaluated signal throws OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION
    const { HORIZON_SWITCHING: _omittedHorizon, ...unevaluated } = allPassingSignals;
    expect(() => integrityFailureBlocksPromotion(unevaluated)).toThrow(ObjError);
  });

  // Pure Law 7: claimScopeComplete (FR-OBJ-007)
  it('pure law: claimScopeComplete requires 11-for-11 complete claim scope (FR-OBJ-007)', () => {
    const validScope: Record<ClaimScopeField, string> = {
      SUPPORTED_POPULATION: 'univ_sol',
      PROFILE: 'prof_momentum',
      POLICY: 'policy_v1',
      EXECUTION_SCENARIO: 'scenario_p50',
      DELAY_DISTRIBUTION: 'dist_sol_1',
      CALENDAR_INTERVAL: '2026-01-01/2026-06-30',
      MARKET_REGIMES: 'HIGH_VOLATILITY',
      CAPABILITY_STATE: 'READONLY',
      SAMPLE_SIZE: '10000',
      CLUSTER_EFFECTIVE_SAMPLE_SIZE: '2500',
      UNCERTAINTY_METHOD: 'CLUSTER_BOOTSTRAP',
    };

    expect(claimScopeMissing(validScope)).toHaveLength(0);
    expect(() => claimScopeComplete(validScope)).not.toThrow();

    // Missing null/undefined scope
    expect(claimScopeMissing(null)).toHaveLength(11);
    expect(() => claimScopeComplete(null)).toThrow(ObjError);

    // Dropping any field throws OBJ_CLAIM_SCOPE_INCOMPLETE
    for (const field of ALL_CLAIM_SCOPE_FIELDS) {
      const incomplete = { ...validScope, [field]: '' };
      expect(claimScopeMissing(incomplete)).toContain(field);
      expect(() => claimScopeComplete(incomplete)).toThrow(ObjError);
      try {
        claimScopeComplete(incomplete);
      } catch (e) {
        expect(isObjError(e)).toBe(true);
        if (isObjError(e)) {
          expect(e.code).toBe(ObjErrorCode.OBJ_CLAIM_SCOPE_INCOMPLETE);
        }
      }
    }
  });

  // Pure Law 8: robustDelayRequired (FR-OBJ-008)
  it('pure law: robustDelayRequired requires all 3 scenarios evidenced and declared gate passed (FR-OBJ-008)', () => {
    const validResults: Record<DelayScenario, { evidenced: boolean; passed: boolean }> = {
      P50: { evidenced: true, passed: true },
      P90: { evidenced: true, passed: true },
      CONSERVATIVE_TAIL: { evidenced: true, passed: true },
    };

    // All evidenced and declared gate passed -> true
    expect(
      robustDelayRequired({
        results: validResults,
        declaredGate: [DelayScenario.P50, DelayScenario.P90, DelayScenario.CONSERVATIVE_TAIL],
      }),
    ).toBe(true);

    // Declared gate scenario failing -> returns false (verdict, not refusal)
    const failingTailResults = {
      ...validResults,
      CONSERVATIVE_TAIL: { evidenced: true, passed: false },
    };
    expect(
      robustDelayRequired({
        results: failingTailResults,
        declaredGate: [DelayScenario.P50, DelayScenario.P90, DelayScenario.CONSERVATIVE_TAIL],
      }),
    ).toBe(false);

    // Missing evidence for any scenario -> throws OBJ_SINGLE_DELAY_EVIDENCE_REFUSED
    const singleDelayOnly = {
      P50: { evidenced: true, passed: true },
      P90: { evidenced: false, passed: false },
      CONSERVATIVE_TAIL: { evidenced: false, passed: false },
    };
    expect(() =>
      robustDelayRequired({
        results: singleDelayOnly,
        declaredGate: [DelayScenario.P50],
      }),
    ).toThrow(ObjError);

    // Empty declared gate -> throws OBJ_SINGLE_DELAY_EVIDENCE_REFUSED
    expect(() =>
      robustDelayRequired({
        results: validResults,
        declaredGate: [],
      }),
    ).toThrow(ObjError);
  });

  // Pure Law 9: frozenRecordImmutable & assertFrozenParentHash (FR-OBJ-009)
  it('pure law: frozenRecordImmutable freezes deeply and assertFrozenParentHash checks ancestry (FR-OBJ-009)', () => {
    const obj = { runId: 'run-primary', nested: { val: 42 } };
    const frozen = frozenRecordImmutable(obj);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);

    const parentHash = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(() =>
      assertFrozenParentHash({ parentContentHash: parentHash }, parentHash),
    ).not.toThrow();

    // Mismatched parent hash throws OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED
    expect(() =>
      assertFrozenParentHash({ parentContentHash: 'sha256:different' }, parentHash),
    ).toThrow(ObjError);
    expect(() => assertFrozenParentHash({ parentContentHash: '' }, parentHash)).toThrow(ObjError);
    expect(() => assertFrozenParentHash(null, parentHash)).toThrow(ObjError);
  });

  // Pure Law 10: uncertaintyDisclosureRequired (FR-OBJ-010)
  it('pure law: uncertaintyDisclosureRequired checks research-signal disclosure text (FR-OBJ-010)', () => {
    expect(() =>
      uncertaintyDisclosureRequired({
        disclosure: `Valid research signal. ${UNCERTAINTY_DISCLOSURE_TEXT}`,
      }),
    ).not.toThrow();

    expect(() =>
      uncertaintyDisclosureRequired({
        disclosure: 'Guaranteed 100% returns on all trades.',
      }),
    ).toThrow(ObjError);
    expect(() => uncertaintyDisclosureRequired({ disclosure: null })).toThrow(ObjError);
    expect(() => uncertaintyDisclosureRequired(null)).toThrow(ObjError);
  });
});
