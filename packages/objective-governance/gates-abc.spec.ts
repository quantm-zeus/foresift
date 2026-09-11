/**
 * Governance Gates A–C Unit Test Suite (T016).
 * Traces: FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-004, FR-OBJ-005, FR-OBJ-006, FR-OBJ-007, FR-OBJ-008, FR-OBJ-009.
 *
 * Covers:
 * - Gate A / LCB Objective & Bit-Determinism (FR-OBJ-001): float-free integer arithmetic, bit-identical repeated runs, capital-day folding
 * - Gate A / Comparability Matrix (FR-OBJ-002): 8-dimension pairwise identity vs EXPLORATORY_ONLY
 * - Gate A / Hard-Constraints Matrix (FR-OBJ-003): 7-kind fail-closed evaluation before utility
 * - Gate B / Decomposition Reconciliation (FR-OBJ-004): 12-line reconciliation to net micro-units
 * - Gate B / Diagnostics Labeling & Exclusion (FR-OBJ-005): 4-diagnostic computation, diagnosticOnly marking, exclusion from objective
 * - Gate B / Claim-Scope Completeness (FR-OBJ-007): 11-field completeness refusal matrix
 * - Gate C / Integrity Detectors (FR-OBJ-006): 7 deterministic integrity detectors and promotion blocking
 * - Gate C / Robust-Delay Gate (FR-OBJ-008): 3-scenario evidence and declared gate evaluation
 * - Gate C / Utility Sensitivity Derivation (FR-OBJ-009): 7-dimension frozen grid derivation and anti-rewrite checks
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_CLAIM_SCOPE_FIELDS,
  ALL_HARD_CONSTRAINT_KINDS,
  ALL_INTEGRITY_SIGNAL_KINDS,
  ALL_SENSITIVITY_DIMENSIONS,
  ObjError,
  ObjErrorCode,
  RunComparability,
  isObjError,
  type ClaimScopeField,
  type DiagnosticKind,
  type IntegritySignalKind,
  type SensitivityDimension,
  type UtilityLineKind,
} from '@foresift/domain';
import {
  assertDiagnosticOnly,
  assertIntegrityPass,
  assertSensitivityParent,
  assessComparability,
  assessIntegrity,
  buildDecompositionReport,
  compareLowerBounds,
  comparisonDimensions,
  computeDiagnostics,
  computeObjectiveFunction,
  deriveSensitivityGrid,
  detectIntegritySignals,
  diagnosticBasisPoints,
  evaluateDelayGate,
  evaluateHardConstraints,
  parseDeclaredGate,
  validateClaimScope,
  type ComparableRunRecord,
  type FrozenIntegrityEvidence,
  type FrozenPrimaryRecord,
  type FrozenUtilitySeries,
} from './src/index.ts';
import { parseCapitalDay, utilityPerCapitalDay } from './capital-day.ts';

const SHA256_BASE = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SHA256_ALT = 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('Gate A: Primary Objective Function & Bit-Determinism (FR-OBJ-001)', () => {
  const sampleSeries: FrozenUtilitySeries = {
    runId: 'run-gate-a-001',
    dailyNetMicros: [
      120000n,
      95000n,
      110000n,
      85000n,
      130000n,
      105000n,
      115000n,
      90000n,
      125000n,
      100000n,
    ],
    consumedEssReference: 'ess_bootstrap_cluster_001',
    essStale: false,
  };

  it('computes bit-deterministic LCB across 100 repeated runs', () => {
    const baseline = computeObjectiveFunction(sampleSeries);
    expect(baseline.runId).toBe('run-gate-a-001');
    expect(baseline.capitalDays).toBe(10);
    expect(baseline.consumedEssReference).toBe('ess_bootstrap_cluster_001');
    expect(baseline.lowerBoundMicros).toBeLessThanOrEqual(baseline.meanFloorMicros);

    for (let i = 0; i < 100; i++) {
      const repeated = computeObjectiveFunction(sampleSeries);
      expect(repeated.meanFloorMicros).toBe(baseline.meanFloorMicros);
      expect(repeated.lowerBoundMicros).toBe(baseline.lowerBoundMicros);
    }
  });

  it('orders objective values purely by lower bound utility', () => {
    const highLcb = computeObjectiveFunction({
      runId: 'run-high',
      dailyNetMicros: [200000n, 210000n, 190000n],
      consumedEssReference: 'ess-001',
      essStale: false,
    });
    const lowLcb = computeObjectiveFunction({
      runId: 'run-low',
      dailyNetMicros: [50000n, 60000n, 40000n],
      consumedEssReference: 'ess-001',
      essStale: false,
    });

    expect(compareLowerBounds(highLcb, lowLcb)).toBe(1);
    expect(compareLowerBounds(lowLcb, highLcb)).toBe(-1);
    expect(compareLowerBounds(highLcb, highLcb)).toBe(0);
  });

  it('refuses empty series, missing runId, and absent or stale ESS references', () => {
    expect(() =>
      computeObjectiveFunction({
        runId: '',
        dailyNetMicros: [100000n],
        consumedEssReference: 'ess-001',
        essStale: false,
      }),
    ).toThrow(ObjError);

    expect(() =>
      computeObjectiveFunction({
        runId: 'run-001',
        dailyNetMicros: [],
        consumedEssReference: 'ess-001',
        essStale: false,
      }),
    ).toThrow(ObjError);

    expect(() =>
      computeObjectiveFunction({
        runId: 'run-001',
        dailyNetMicros: [100000n],
        consumedEssReference: '',
        essStale: false,
      }),
    ).toThrow(ObjError);

    expect(() =>
      computeObjectiveFunction({
        runId: 'run-001',
        dailyNetMicros: [100000n],
        consumedEssReference: 'ess-001',
        essStale: true,
      }),
    ).toThrow(ObjError);
  });

  it('validates capital-day coordinates and integer arithmetic', () => {
    expect(parseCapitalDay('2024-02-29')).toBe('2024-02-29'); // Leap year
    expect(() => parseCapitalDay('2023-02-29')).toThrow(ObjError); // Non-leap year
    expect(() => parseCapitalDay('2026-13-01')).toThrow(ObjError); // Invalid month
    expect(() => parseCapitalDay('invalid-date')).toThrow(ObjError);

    // utilityPerCapitalDay
    expect(utilityPerCapitalDay(100000000n, 1000000n)).toBe(100n);
    expect(utilityPerCapitalDay(100000000, 1000000)).toBe(100n);
    expect(() => utilityPerCapitalDay(100n, 0n)).toThrow(ObjError);
  });
});

describe('Gate A: Comparability Matrix Across All Eight Dimensions (FR-OBJ-002)', () => {
  const baseRun: ComparableRunRecord = {
    runId: 'run-base',
    candidateUniverseId: 'univ-sol',
    candidateUniverseHash: SHA256_BASE,
    populationClaimId: 'pop-claim-1',
    capitalMicros: 100000000n,
    windowStart: '2026-01-01T00:00:00Z',
    windowEnd: '2026-06-30T23:59:59Z',
    executionScenarioId: 'exec-p50',
    executionScenarioVersion: 'v1',
    delayPolicyId: 'delay-policy-1',
    delayPolicyVersion: 'v1',
    dataCutoff: '2026-06-30T23:59:59Z',
    correlatedExposureConstraints: ['max_deployer_10pct', 'single_pool_5pct'],
  };

  it('returns COMPARABLE for identical run headers', () => {
    const identicalRun: ComparableRunRecord = { ...baseRun, runId: 'run-identical' };
    expect(assessComparability(baseRun, identicalRun)).toBe(RunComparability.COMPARABLE);
  });

  it('returns EXPLORATORY_ONLY for differences in each of the 8 dimensions', () => {
    const variations: ComparableRunRecord[] = [
      { ...baseRun, candidateUniverseId: 'univ-eth' },
      { ...baseRun, candidateUniverseHash: SHA256_ALT },
      { ...baseRun, populationClaimId: 'pop-claim-2' },
      { ...baseRun, capitalMicros: 500000000n },
      { ...baseRun, windowEnd: '2026-07-31T23:59:59Z' },
      { ...baseRun, executionScenarioVersion: 'v2' },
      { ...baseRun, delayPolicyId: 'delay-policy-2' },
      { ...baseRun, dataCutoff: '2026-07-31T23:59:59Z' },
      { ...baseRun, correlatedExposureConstraints: ['unconstrained'] },
    ];

    for (const variant of variations) {
      expect(assessComparability(baseRun, variant)).toBe(RunComparability.EXPLORATORY_ONLY);
    }
  });

  it('refuses null, undefined, or invalid comparison headers fail-closed', () => {
    expect(() => assessComparability(null, baseRun)).toThrow(ObjError);
    expect(() => assessComparability(baseRun, undefined)).toThrow(ObjError);
    expect(() => comparisonDimensions({ ...baseRun, runId: '' })).toThrow(ObjError);
  });
});

describe('Gate A: Hard-Constraints Total Evaluation (FR-OBJ-003)', () => {
  const allPassingEvaluations = [
    { kind: 'SECURITY', verdict: 'PASS', evidenceRef: 'ev-sec-001' },
    { kind: 'EXECUTION', verdict: 'PASS', evidenceRef: 'ev-exec-001' },
    { kind: 'RIGHTS', verdict: 'PASS', evidenceRef: 'ev-rights-001' },
    { kind: 'LEAKAGE', verdict: 'PASS', evidenceRef: 'ev-leak-001' },
    { kind: 'PUBLIC_CLAIM', verdict: 'PASS', evidenceRef: 'ev-claim-001' },
    { kind: 'CAPACITY', verdict: 'PASS', evidenceRef: 'ev-cap-001' },
    { kind: 'TAIL_RISK', verdict: 'PASS', evidenceRef: 'ev-tail-001' },
  ];

  it('accepts total 7-kind passing evaluation', () => {
    const evaluated = evaluateHardConstraints(allPassingEvaluations);
    for (const kind of ALL_HARD_CONSTRAINT_KINDS) {
      expect(evaluated[kind]).toBe('PASS');
    }
  });

  it('refuses any single failing constraint kind even with otherwise passing inputs', () => {
    for (const kind of ALL_HARD_CONSTRAINT_KINDS) {
      const withFailure = allPassingEvaluations.map((e) =>
        e.kind === kind ? { ...e, verdict: 'FAIL' } : e,
      );
      expect(() => evaluateHardConstraints(withFailure)).toThrow(ObjError);
      try {
        evaluateHardConstraints(withFailure);
      } catch (e) {
        expect(isObjError(e)).toBe(true);
        if (isObjError(e)) {
          expect(e.code).toBe(ObjErrorCode.OBJ_HARD_CONSTRAINT_FAILED);
        }
      }
    }
  });

  it('refuses missing kinds, duplicate kinds, empty evidence, and unknown literals', () => {
    // Missing kind (6 of 7)
    expect(() => evaluateHardConstraints(allPassingEvaluations.slice(0, 6))).toThrow(ObjError);

    // Duplicate kind
    const withDuplicate = [
      ...allPassingEvaluations,
      allPassingEvaluations[0] as (typeof allPassingEvaluations)[0],
    ];
    expect(() => evaluateHardConstraints(withDuplicate)).toThrow(ObjError);

    // Empty evidenceRef
    const withEmptyEvidence = allPassingEvaluations.map((e) =>
      e.kind === 'SECURITY' ? { ...e, evidenceRef: '' } : e,
    );
    expect(() => evaluateHardConstraints(withEmptyEvidence)).toThrow(ObjError);

    // Unknown kind literal
    const withUnknownKind = allPassingEvaluations.map((e) =>
      e.kind === 'SECURITY' ? { ...e, kind: 'UNKNOWN_RISK' } : e,
    );
    expect(() => evaluateHardConstraints(withUnknownKind)).toThrow(ObjError);
  });
});

describe('Gate B: Decomposition Reconciliation (FR-OBJ-004)', () => {
  const validLines: Record<UtilityLineKind, bigint> = {
    GROSS_RETURN: 100000000n,
    EXECUTION_COSTS: -10000000n,
    FAILED_PARTIAL_FILLS: -5000000n,
    DRAWDOWN: -15000000n,
    CVAR: -10000000n,
    CAPITAL_UTILIZATION: 5000000n,
    TURNOVER: -2000000n,
    OPPORTUNITY_COST: -8000000n,
    CONCENTRATION: -3000000n,
    SHARED_LIQUIDITY_IMPACT: -4000000n,
    PROVIDER_MODEL_INFRA_COST: -3000000n,
    UNCERTAINTY: -10000000n,
  };
  // Net = 35000000n

  it('builds a reconciled, frozen twelve-line report', () => {
    const report = buildDecompositionReport({
      runId: 'run-decomp-001',
      capitalDay: '2026-06-15',
      lines: validLines,
      consumedEssReference: 'ess-001',
      intervalMethod: 'CLUSTER_BOOTSTRAP',
    });

    expect(report.runId).toBe('run-decomp-001');
    expect(report.capitalDay).toBe('2026-06-15');
    expect(report.netMicros).toBe(35000000n);
    expect(report.uncertaintyMicros).toBe(-10000000n);
    expect(report.intervalMethod).toBe('CLUSTER_BOOTSTRAP');
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('refuses missing runId, missing ESS reference, or unproven uncertainty method', () => {
    expect(() =>
      buildDecompositionReport({
        runId: '',
        capitalDay: '2026-06-15',
        lines: validLines,
        consumedEssReference: 'ess-001',
        intervalMethod: 'CLUSTER_BOOTSTRAP',
      }),
    ).toThrow(ObjError);

    expect(() =>
      buildDecompositionReport({
        runId: 'run-decomp-001',
        capitalDay: '2026-06-15',
        lines: validLines,
        consumedEssReference: '',
        intervalMethod: 'CLUSTER_BOOTSTRAP',
      }),
    ).toThrow(ObjError);

    expect(() =>
      buildDecompositionReport({
        runId: 'run-decomp-001',
        capitalDay: '2026-06-15',
        lines: validLines,
        consumedEssReference: 'ess-001',
        intervalMethod: 'GAUSSIAN_HEURISTIC',
      }),
    ).toThrow(ObjError);
  });

  it('refuses non-integer lines and decomposition sum mismatches', () => {
    const floatLine = { ...validLines, GROSS_RETURN: 100.5 as unknown as number };
    expect(() =>
      buildDecompositionReport({
        runId: 'run-decomp-001',
        capitalDay: '2026-06-15',
        lines: floatLine,
        consumedEssReference: 'ess-001',
        intervalMethod: 'CLUSTER_BOOTSTRAP',
      }),
    ).toThrow(ObjError);

    const missingLine = { ...validLines };
    delete (missingLine as Record<string, unknown>).UNCERTAINTY;
    expect(() =>
      buildDecompositionReport({
        runId: 'run-decomp-001',
        capitalDay: '2026-06-15',
        lines: missingLine,
        consumedEssReference: 'ess-001',
        intervalMethod: 'CLUSTER_BOOTSTRAP',
      }),
    ).toThrow(ObjError);
  });
});

describe('Gate B: Diagnostic Metrics Labeling & Exclusion (FR-OBJ-005)', () => {
  const validMetrics: Record<DiagnosticKind, { numerator: number; denominator: number }> = {
    PER_ALERT_PRECISION: { numerator: 82, denominator: 100 },
    TRADABLE_SUCCESS_RATE: { numerator: 85, denominator: 100 },
    RECALL: { numerator: 75, denominator: 100 },
    ALERTS_PER_RESEARCHED_CANDIDATE: { numerator: 125, denominator: 100 },
  };

  it('computes 4 diagnostics labeled diagnosticOnly: true', () => {
    const report = computeDiagnostics('run-diag-001', validMetrics);
    expect(report.runId).toBe('run-diag-001');
    expect(report.diagnosticOnly).toBe(true);
    expect(report.metrics.PER_ALERT_PRECISION).toEqual({ numerator: 82, denominator: 100 });
    expect(diagnosticBasisPoints(report.metrics.PER_ALERT_PRECISION)).toBe(8200n);
    expect(() => assertDiagnosticOnly(report)).not.toThrow();
  });

  it('refuses non-integer or invalid diagnostic counts', () => {
    expect(() =>
      computeDiagnostics('run-diag-001', {
        ...validMetrics,
        RECALL: { numerator: -1, denominator: 100 },
      }),
    ).toThrow(ObjError);

    expect(() =>
      computeDiagnostics('run-diag-001', {
        ...validMetrics,
        RECALL: { numerator: 50, denominator: 0 },
      }),
    ).toThrow(ObjError);

    expect(() =>
      computeDiagnostics('run-diag-001', {
        ...validMetrics,
        RECALL: { numerator: 50.5, denominator: 100 },
      }),
    ).toThrow(ObjError);

    const incomplete = { ...validMetrics };
    delete (incomplete as Record<string, unknown>).RECALL;
    expect(() => computeDiagnostics('run-diag-001', incomplete)).toThrow(ObjError);
  });
});

describe('Gate B: Claim Scope Eleven-Field Completeness (FR-OBJ-007)', () => {
  const validScope = {
    supportedPopulation: 'SUPPORTED_PROGRAM_UNIVERSE_SOL',
    profile: 'OPPORTUNITY_PROFILE_MOMENTUM_V1',
    policy: 'POLICY_EXECUTION_STRICT_READONLY_V2',
    executionScenario: 'EXEC_SCENARIO_P50_CONSERVATIVE',
    delayDistribution: 'DELAY_DISTRIBUTION_SOL_STD',
    calendarInterval: '2026-01-01T00:00:00Z/2026-06-30T23:59:59Z',
    marketRegimes: ['HIGH_VOLATILITY', 'EXPANDING_LIQUIDITY'],
    capabilityState: 'CAPABILITY_READONLY_NO_KEYS',
    sampleSize: 15420,
    clusterEffectiveSampleSize: 3240,
    uncertaintyMethod: 'CLUSTER_BOOTSTRAP',
  };

  it('validates and freezes complete 11-field scope', () => {
    const validated = validateClaimScope('run-scope-001', validScope);
    expect(validated.runId).toBe('run-scope-001');
    expect(Object.isFrozen(validated)).toBe(true);
    for (const field of ALL_CLAIM_SCOPE_FIELDS) {
      expect(validated.fields[field]).toBeDefined();
      expect(typeof validated.fields[field]).toBe('string');
    }
  });

  it('refuses dropping any single field across the eleven-field matrix', () => {
    const fieldMapping: Record<ClaimScopeField, string> = {
      SUPPORTED_POPULATION: 'supportedPopulation',
      PROFILE: 'profile',
      POLICY: 'policy',
      EXECUTION_SCENARIO: 'executionScenario',
      DELAY_DISTRIBUTION: 'delayDistribution',
      CALENDAR_INTERVAL: 'calendarInterval',
      MARKET_REGIMES: 'marketRegimes',
      CAPABILITY_STATE: 'capabilityState',
      SAMPLE_SIZE: 'sampleSize',
      CLUSTER_EFFECTIVE_SAMPLE_SIZE: 'clusterEffectiveSampleSize',
      UNCERTAINTY_METHOD: 'uncertaintyMethod',
    };

    for (const field of ALL_CLAIM_SCOPE_FIELDS) {
      const key = fieldMapping[field];
      const incomplete = { ...validScope, [key]: '' };
      expect(() => validateClaimScope('run-scope-001', incomplete)).toThrow(ObjError);
    }
  });

  it('refuses cluster ESS > sample size, invalid counts, or unproven uncertainty method', () => {
    expect(() =>
      validateClaimScope('run-scope-001', {
        ...validScope,
        sampleSize: 1000,
        clusterEffectiveSampleSize: 1001,
      }),
    ).toThrow(ObjError);

    expect(() =>
      validateClaimScope('run-scope-001', {
        ...validScope,
        clusterEffectiveSampleSize: -5,
      }),
    ).toThrow(ObjError);

    expect(() =>
      validateClaimScope('run-scope-001', {
        ...validScope,
        uncertaintyMethod: 'UNKNOWN_METHOD',
      }),
    ).toThrow(ObjError);

    expect(() =>
      validateClaimScope('run-scope-001', {
        ...validScope,
        marketRegimes: [],
      }),
    ).toThrow(ObjError);
  });
});

describe('Gate C: Objective Integrity Detectors (FR-OBJ-006)', () => {
  const cleanEvidence: FrozenIntegrityEvidence = {
    runId: 'run-clean-001',
    recordedDenominatorCount: 1000,
    evaluatedDenominatorCount: 1000,
    frozenUniverseHash: SHA256_BASE,
    evaluatedUniverseHash: SHA256_BASE,
    frozenExplorationRateBps: 1500,
    observedExplorationRateBps: 1500,
    pendingOutcomesAtFreeze: 50,
    omittedPendingOutcomes: 0,
    frozenHorizon: '5M',
    evaluatedHorizon: '5M',
    frozenScenarioSet: ['p50', 'p90'],
    evaluatedScenarioSet: ['p50', 'p90'],
    holdoutInspectionCount: 1,
  };

  it('passes when all 7 detectors report clean evidence', () => {
    const signals = detectIntegritySignals(cleanEvidence);
    for (const signal of ALL_INTEGRITY_SIGNAL_KINDS) {
      expect(signals[signal]).toBe(false);
    }

    const assessment = assessIntegrity(cleanEvidence);
    expect(assessment.verdict).toBe('PASS');
    expect(assessment.firing).toHaveLength(0);
    expect(() => assertIntegrityPass(cleanEvidence)).not.toThrow();
  });

  it('triggers FAIL_BLOCKS_PROMOTION on each of the 7 integrity failure cases', () => {
    const violationCases: Record<IntegritySignalKind, Partial<FrozenIntegrityEvidence>> = {
      DENOMINATOR_GAMING: { evaluatedDenominatorCount: 950 },
      SELECTIVE_UNIVERSE_CHANGE: { evaluatedUniverseHash: SHA256_ALT },
      REDUCED_EXPLORATION: { observedExplorationRateBps: 1000 },
      DELAYED_OUTCOME_OMISSION: { omittedPendingOutcomes: 5 },
      HORIZON_SWITCHING: { evaluatedHorizon: '24H' },
      SCENARIO_CHERRY_PICKING: { evaluatedScenarioSet: ['p50'] },
      REPEATED_HOLDOUT_INSPECTION: { holdoutInspectionCount: 3 },
    };

    for (const signal of ALL_INTEGRITY_SIGNAL_KINDS) {
      const tampered = { ...cleanEvidence, ...violationCases[signal] };
      const signals = detectIntegritySignals(tampered);
      expect(signals[signal]).toBe(true);

      const assessment = assessIntegrity(tampered);
      expect(assessment.verdict).toBe('FAIL_BLOCKS_PROMOTION');
      expect(assessment.firing).toContain(signal);
      expect(() => assertIntegrityPass(tampered)).toThrow(ObjError);
    }
  });

  it('refuses non-safe-integer or out-of-range counts and basis points', () => {
    expect(() =>
      detectIntegritySignals({ ...cleanEvidence, recordedDenominatorCount: -1 }),
    ).toThrow(ObjError);
    expect(() =>
      detectIntegritySignals({ ...cleanEvidence, frozenExplorationRateBps: 15000 }),
    ).toThrow(ObjError);
    expect(() => detectIntegritySignals({ ...cleanEvidence, runId: '' })).toThrow(ObjError);
  });
});

describe('Gate C: Robust Action-Delay Gate (FR-OBJ-008)', () => {
  const threeScenarios = {
    P50: { evidenced: true, passed: true },
    P90: { evidenced: true, passed: true },
    CONSERVATIVE_TAIL: { evidenced: true, passed: true },
  };

  it('evaluates robust delay gate and parses declared gate sets', () => {
    expect(parseDeclaredGate(['P50', 'P90', 'CONSERVATIVE_TAIL'])).toHaveLength(3);
    expect(parseDeclaredGate(['P50', 'P50', 'P90'])).toEqual(['P50', 'P90']); // deduplicates

    const verdict = evaluateDelayGate('run-delay-001', threeScenarios, [
      'P50',
      'P90',
      'CONSERVATIVE_TAIL',
    ]);
    expect(verdict.runId).toBe('run-delay-001');
    expect(verdict.passed).toBe(true);
    expect(verdict.declaredGate).toEqual(['P50', 'P90', 'CONSERVATIVE_TAIL']);
  });

  it('returns passed: false (verdict) when a declared scenario fails', () => {
    const failingTail = {
      ...threeScenarios,
      CONSERVATIVE_TAIL: { evidenced: true, passed: false },
    };
    const verdict = evaluateDelayGate('run-delay-001', failingTail, [
      'P50',
      'P90',
      'CONSERVATIVE_TAIL',
    ]);
    expect(verdict.passed).toBe(false);
  });

  it('refuses single-scenario standing in for distribution or empty declared gate', () => {
    const singleScenario = {
      P50: { evidenced: true, passed: true },
    };
    expect(() => evaluateDelayGate('run-delay-001', singleScenario, ['P50'])).toThrow(ObjError);
    expect(() => evaluateDelayGate('run-delay-001', threeScenarios, [])).toThrow(ObjError);
    expect(() => evaluateDelayGate('', threeScenarios, ['P50'])).toThrow(ObjError);
  });
});

describe('Gate C: Sensitivity Analysis & Immutability Discipline (FR-OBJ-009)', () => {
  const frozenPrimary: FrozenPrimaryRecord = {
    contentHash: SHA256_BASE,
    baselineUtilityMicros: 100000000n,
  };

  it('derives sensitivity grids across all 7 dimensions while preserving parent hash', () => {
    for (const dimension of ALL_SENSITIVITY_DIMENSIONS) {
      const grid = deriveSensitivityGrid(
        frozenPrimary,
        dimension,
        [5000, 10000, 15000],
        (baseline, levelBps) => (baseline * BigInt(levelBps)) / 10000n,
      );

      expect(grid.dimension).toBe(dimension as SensitivityDimension);
      expect(grid.parentContentHash).toBe(SHA256_BASE);
      expect(grid.points).toHaveLength(3);
      expect(grid.points[0]?.utilityMicros).toBe(50000000n);
      expect(grid.points[1]?.utilityMicros).toBe(100000000n);
      expect(grid.points[2]?.utilityMicros).toBe(150000000n);
      expect(Object.isFrozen(grid)).toBe(true);
      expect(() => assertSensitivityParent(grid, SHA256_BASE)).not.toThrow();
    }
  });

  it('refuses parent hash tampering (frozen experiment rewrite)', () => {
    const grid = deriveSensitivityGrid(frozenPrimary, 'CAPITAL', [10000], (baseline) => baseline);
    expect(() => assertSensitivityParent(grid, SHA256_ALT)).toThrow(ObjError);

    const tamperedPointGrid = {
      ...grid,
      points: [{ ...(grid.points[0] as (typeof grid.points)[0]), parentContentHash: SHA256_ALT }],
    };
    expect(() => assertSensitivityParent(tamperedPointGrid, SHA256_BASE)).toThrow(ObjError);
  });

  it('refuses invalid basis points, empty levels, or unhashed primary record', () => {
    expect(() => deriveSensitivityGrid(frozenPrimary, 'CAPITAL', [], (b) => b)).toThrow(ObjError);

    expect(() => deriveSensitivityGrid(frozenPrimary, 'CAPITAL', [0], (b) => b)).toThrow(ObjError);

    expect(() => deriveSensitivityGrid(frozenPrimary, 'CAPITAL', [-100], (b) => b)).toThrow(
      ObjError,
    );

    expect(() =>
      deriveSensitivityGrid({ ...frozenPrimary, contentHash: '' }, 'CAPITAL', [10000], (b) => b),
    ).toThrow(ObjError);
  });
});
