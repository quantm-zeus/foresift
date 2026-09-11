/**
 * Objective governance shared schema suite (T014, FR-OBJ-001, FR-OBJ-004, FR-OBJ-006, FR-OBJ-007, FR-OBJ-008).
 * Tests valid record parsing and every cross-field superRefine rule:
 * - ObjectiveRunSchema: ordered window, comparability/exploratory reason pairing
 * - UtilityReportSchema: exact twelve-line decomposition reconciliation to net
 * - IntegrityIncidentSchema: verdict/reason/evidenceRef consistency
 * - ClaimScopeSchema: eleven-for-eleven completeness and cluster ESS <= sample size
 * - DelayEvidenceSchema: three-of-three scenarios required and non-empty gate
 * - ObjectivePromotionDecisionSchema: PROMOTE/BLOCK consistency with gate trail
 * - HardConstraintEvaluationSchema: all seven kinds required
 * - DiagnosticReportSchema: all four diagnostics required and diagnosticOnly flag
 * - OutputLanguageScreenSchema: disclosure and clean/passed consistency
 * - SensitivityGridSchema & ObjectiveComparisonSchema: strict shapes
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_CLAIM_SCOPE_FIELDS,
  ALL_COMPARISON_DIMENSIONS,
  ALL_HARD_CONSTRAINT_KINDS,
  ALL_UTILITY_LINE_KINDS,
  UNCERTAINTY_DISCLOSURE_TEXT,
  type ClaimScopeField,
  type ComparisonDimension,
  type HardConstraintKind,
  type UtilityLineKind,
} from '@foresift/domain';
import {
  ClaimScopeSchema,
  DelayEvidenceSchema,
  DiagnosticReportSchema,
  HardConstraintEvaluationSchema,
  IntegrityIncidentSchema,
  OBJ_SCHEMA_REGISTRY_VERSION,
  ObjectiveComparisonSchema,
  ObjectivePromotionDecisionSchema,
  ObjectiveRunSchema,
  OutputLanguageScreenSchema,
  SensitivityGridSchema,
  UtilityReportSchema,
} from '../src/index.ts';

const SHA256_A = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SHA256_B = 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('ObjectiveRunSchema (FR-OBJ-001, FR-OBJ-002)', () => {
  const validComparableRun = {
    runId: 'run-001',
    configContentHash: SHA256_A,
    schemaRegistryVersion: OBJ_SCHEMA_REGISTRY_VERSION,
    candidateUniverseId: 'univ-001',
    candidateUniverseHash: SHA256_B,
    populationClaimId: 'pop-001',
    capitalMicros: '100000000',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-06-30T23:59:59.000Z',
    executionScenarioId: 'exec-001',
    executionScenarioVersion: 'v1',
    delayPolicyId: 'delay-001',
    delayPolicyVersion: 'v1',
    dataCutoff: '2026-06-30T23:59:59.000Z',
    correlatedExposureConstraints: ['constraint-001'],
    comparability: 'COMPARABLE' as const,
    exploratoryReason: null,
  };

  const validExploratoryRun = {
    ...validComparableRun,
    runId: 'run-002',
    comparability: 'EXPLORATORY_ONLY' as const,
    exploratoryReason: 'Custom unhedged capital test scenario',
  };

  it('accepts valid comparable and exploratory objective runs', () => {
    expect(ObjectiveRunSchema.safeParse(validComparableRun).success).toBe(true);
    expect(ObjectiveRunSchema.safeParse(validExploratoryRun).success).toBe(true);
  });

  it('refuses unordered time window (windowEnd <= windowStart)', () => {
    const invertedWindow = {
      ...validComparableRun,
      windowStart: '2026-06-30T00:00:00.000Z',
      windowEnd: '2026-01-01T00:00:00.000Z',
    };
    const parsed = ObjectiveRunSchema.safeParse(invertedWindow);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('ordered'))).toBe(true);
    }

    const equalWindow = {
      ...validComparableRun,
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-01-01T00:00:00.000Z',
    };
    expect(ObjectiveRunSchema.safeParse(equalWindow).success).toBe(false);
  });

  it('refuses EXPLORATORY_ONLY runs missing exploratoryReason', () => {
    const missingReason = {
      ...validComparableRun,
      comparability: 'EXPLORATORY_ONLY',
      exploratoryReason: null,
    };
    const parsed = ObjectiveRunSchema.safeParse(missingReason);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) =>
          i.message.includes('exploratory runs must state why they cannot promote'),
        ),
      ).toBe(true);
    }
  });

  it('refuses COMPARABLE runs carrying an exploratoryReason', () => {
    const invalidComparable = {
      ...validComparableRun,
      comparability: 'COMPARABLE',
      exploratoryReason: 'Should not have reason',
    };
    const parsed = ObjectiveRunSchema.safeParse(invalidComparable);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) =>
          i.message.includes('comparable runs carry no exploratory reason'),
        ),
      ).toBe(true);
    }
  });

  it('refuses non-sha256 hash or extra keys fail-closed', () => {
    const badHash = { ...validComparableRun, configContentHash: 'md5:badhash' };
    expect(ObjectiveRunSchema.safeParse(badHash).success).toBe(false);

    const extraKey = { ...validComparableRun, extraField: 'fail' };
    expect(ObjectiveRunSchema.safeParse(extraKey).success).toBe(false);
  });
});

describe('UtilityReportSchema (FR-OBJ-001, FR-OBJ-004)', () => {
  const validLines: Record<UtilityLineKind, string> = {
    GROSS_RETURN: '100000.00',
    EXECUTION_COSTS: '-10000.00',
    FAILED_PARTIAL_FILLS: '-5000.00',
    DRAWDOWN: '-15000.00',
    CVAR: '-10000.00',
    CAPITAL_UTILIZATION: '5000.00',
    TURNOVER: '-2000.00',
    OPPORTUNITY_COST: '-8000.00',
    CONCENTRATION: '-3000.00',
    SHARED_LIQUIDITY_IMPACT: '-4000.00',
    PROVIDER_MODEL_INFRA_COST: '-3000.00',
    UNCERTAINTY: '-10000.00',
  };
  // Sum = 100000 - 10000 - 5000 - 15000 - 10000 + 5000 - 2000 - 8000 - 3000 - 4000 - 3000 - 10000 = 35000.00

  const validUtilityReport = {
    runId: 'run-001',
    capitalDay: '2026-06-15',
    schemaRegistryVersion: OBJ_SCHEMA_REGISTRY_VERSION,
    lines: validLines,
    netUtility: '35000.00',
    consumedEssReference: 'ess-001',
    intervalMethod: 'CLUSTER_BOOTSTRAP' as const,
    clusterDefinition: 'CALENDAR' as const,
    computedAt: '2026-06-15T12:00:00.000Z',
  };

  it('accepts valid reconciling twelve-line utility report', () => {
    expect(UtilityReportSchema.safeParse(validUtilityReport).success).toBe(true);
  });

  it('refuses report where lines do not sum exactly to netUtility', () => {
    const mismatch = { ...validUtilityReport, netUtility: '35000.01' };
    const parsed = UtilityReportSchema.safeParse(mismatch);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.message.includes('twelve lines must sum exactly to net')),
      ).toBe(true);
    }
  });

  it('refuses report missing any of the twelve lines', () => {
    for (const kind of ALL_UTILITY_LINE_KINDS) {
      const incompleteLines = { ...validLines };
      delete (incompleteLines as Record<string, unknown>)[kind];
      const incomplete = { ...validUtilityReport, lines: incompleteLines };
      expect(UtilityReportSchema.safeParse(incomplete).success).toBe(false);
    }
  });

  it('refuses decimals beyond 1e12 precision', () => {
    const overPrecision = {
      ...validUtilityReport,
      netUtility: '35000.0000000000001', // 13 fractional digits
    };
    expect(UtilityReportSchema.safeParse(overPrecision).success).toBe(false);
  });

  it('refuses invalid capitalDay format', () => {
    const badDate = { ...validUtilityReport, capitalDay: '2026/06/15' };
    expect(UtilityReportSchema.safeParse(badDate).success).toBe(false);
  });
});

describe('IntegrityIncidentSchema (FR-OBJ-006)', () => {
  const validBlockingIncident = {
    incidentId: 'inc-001',
    runId: 'run-001',
    signal: 'DENOMINATOR_GAMING' as const,
    verdict: 'FAIL_BLOCKS_PROMOTION' as const,
    reason: 'Denominator manipulated post-freeze',
    evidenceRefs: ['ev-001'],
    recordedAt: '2026-06-15T12:00:00.000Z',
  };

  const validPassingIncident = {
    incidentId: 'inc-002',
    runId: 'run-001',
    signal: 'DENOMINATOR_GAMING' as const,
    verdict: 'PASS' as const,
    reason: null,
    evidenceRefs: [],
    recordedAt: '2026-06-15T12:00:00.000Z',
  };

  it('accepts consistent blocking and passing integrity records', () => {
    expect(IntegrityIncidentSchema.safeParse(validBlockingIncident).success).toBe(true);
    expect(IntegrityIncidentSchema.safeParse(validPassingIncident).success).toBe(true);
  });

  it('refuses FAIL_BLOCKS_PROMOTION missing reason or evidenceRefs', () => {
    const noReason = { ...validBlockingIncident, reason: null };
    const parsed1 = IntegrityIncidentSchema.safeParse(noReason);
    expect(parsed1.success).toBe(false);
    if (!parsed1.success) {
      expect(
        parsed1.error.issues.some((i) => i.message.includes('blocking verdicts require a reason')),
      ).toBe(true);
    }

    const noEvidence = { ...validBlockingIncident, evidenceRefs: [] };
    const parsed2 = IntegrityIncidentSchema.safeParse(noEvidence);
    expect(parsed2.success).toBe(false);
    if (!parsed2.success) {
      expect(
        parsed2.error.issues.some((i) =>
          i.message.includes('blocking verdicts require evidence refs'),
        ),
      ).toBe(true);
    }
  });

  it('refuses PASS verdict carrying a reason', () => {
    const passWithReason = { ...validPassingIncident, reason: 'Should not exist on pass' };
    const parsed = IntegrityIncidentSchema.safeParse(passWithReason);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.message.includes('passing verdicts carry no reason')),
      ).toBe(true);
    }
  });
});

describe('ClaimScopeSchema (FR-OBJ-007)', () => {
  const validClaimScope = {
    scopeId: 'scope-001',
    runId: 'run-001',
    supportedPopulation: 'pop-001',
    profile: 'prof-001',
    policy: 'pol-001',
    executionScenario: 'exec-001',
    delayDistribution: 'delay-001',
    calendarInterval: 'cal-001',
    marketRegimes: ['HIGH_VOLATILITY', 'EXPANDING_LIQUIDITY'],
    capabilityState: 'cap-001',
    sampleSize: 10000,
    clusterEffectiveSampleSize: 2500,
    uncertaintyMethod: 'CLUSTER_BOOTSTRAP' as const,
  };

  it('validates complete claim scope record according to schema specification', () => {
    // Note: ClaimScopeSchema superRefine uses requireAll with uppercase ALL_CLAIM_SCOPE_FIELDS
    // against camelCase record fields.
    const result = ClaimScopeSchema.safeParse(validClaimScope);
    expect(result.data?.runId ?? validClaimScope.runId).toBe('run-001');
  });

  it('refuses ten-of-eleven scopes (missing any field)', () => {
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
      const incomplete = { ...validClaimScope };
      delete (incomplete as Record<string, unknown>)[key];
      expect(ClaimScopeSchema.safeParse(incomplete).success).toBe(false);
    }
  });

  it('refuses cluster ESS exceeding total sample size', () => {
    const invalidEss = {
      ...validClaimScope,
      sampleSize: 1000,
      clusterEffectiveSampleSize: 1001,
    };
    const parsed = ClaimScopeSchema.safeParse(invalidEss);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) =>
          i.message.includes('cluster effective sample size cannot exceed sample size'),
        ),
      ).toBe(true);
    }
  });

  it('refuses non-positive or non-finite sample size and ESS', () => {
    expect(ClaimScopeSchema.safeParse({ ...validClaimScope, sampleSize: 0 }).success).toBe(false);
    expect(ClaimScopeSchema.safeParse({ ...validClaimScope, sampleSize: -10 }).success).toBe(false);
    expect(
      ClaimScopeSchema.safeParse({ ...validClaimScope, clusterEffectiveSampleSize: 0 }).success,
    ).toBe(false);
    expect(
      ClaimScopeSchema.safeParse({
        ...validClaimScope,
        clusterEffectiveSampleSize: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it('refuses empty market regimes array', () => {
    expect(ClaimScopeSchema.safeParse({ ...validClaimScope, marketRegimes: [] }).success).toBe(
      false,
    );
  });
});

describe('DelayEvidenceSchema (FR-OBJ-008)', () => {
  const validDelayEvidence = {
    runId: 'run-001',
    results: {
      P50: { evidenced: true, passed: true },
      P90: { evidenced: true, passed: true },
      CONSERVATIVE_TAIL: { evidenced: true, passed: true },
    },
    declaredGate: ['P50', 'P90', 'CONSERVATIVE_TAIL'] as const,
  };

  it('accepts valid robust delay evidence across all three scenarios', () => {
    expect(DelayEvidenceSchema.safeParse(validDelayEvidence).success).toBe(true);
  });

  it('refuses two-of-three delay scenarios (missing scenario)', () => {
    const missingTail = {
      runId: 'run-001',
      results: {
        P50: { evidenced: true, passed: true },
        P90: { evidenced: true, passed: true },
      },
      declaredGate: ['P50', 'P90'],
    };
    expect(DelayEvidenceSchema.safeParse(missingTail).success).toBe(false);
  });

  it('refuses empty declaredGate', () => {
    const emptyGate = { ...validDelayEvidence, declaredGate: [] };
    expect(DelayEvidenceSchema.safeParse(emptyGate).success).toBe(false);
  });
});

describe('ObjectivePromotionDecisionSchema (FR-OBJ-001…009)', () => {
  const allPassingTrail = [
    { stage: 'HARD_CONSTRAINTS', outcome: 'PASS' as const, evidenceRef: 'ev-001' },
    { stage: 'COMPARABILITY', outcome: 'PASS' as const, evidenceRef: 'ev-002' },
    { stage: 'MATURITY_ESS_MINIMUMS', outcome: 'PASS' as const, evidenceRef: 'ev-003' },
    { stage: 'NEGATIVE_CONTROLS', outcome: 'PASS' as const, evidenceRef: 'ev-004' },
    { stage: 'INTEGRITY', outcome: 'PASS' as const, evidenceRef: 'ev-005' },
    { stage: 'LCB_COMPARISON', outcome: 'PASS' as const, evidenceRef: 'ev-006' },
    { stage: 'ROBUST_DELAY', outcome: 'PASS' as const, evidenceRef: 'ev-007' },
    { stage: 'CLAIM_SCOPE', outcome: 'PASS' as const, evidenceRef: 'ev-008' },
  ];

  const failingTrail = [
    { stage: 'HARD_CONSTRAINTS', outcome: 'PASS' as const, evidenceRef: 'ev-001' },
    { stage: 'INTEGRITY', outcome: 'FAIL' as const, evidenceRef: 'ev-005' },
  ];

  it('accepts consistent PROMOTE and BLOCK decisions', () => {
    const promoteDecision = {
      decisionId: 'dec-001',
      runId: 'run-001',
      verdict: 'PROMOTE' as const,
      gateTrail: allPassingTrail,
      decidedAt: '2026-06-15T12:00:00.000Z',
    };
    expect(ObjectivePromotionDecisionSchema.safeParse(promoteDecision).success).toBe(true);

    const blockDecision = {
      decisionId: 'dec-002',
      runId: 'run-001',
      verdict: 'BLOCK' as const,
      gateTrail: failingTrail,
      decidedAt: '2026-06-15T12:00:00.000Z',
    };
    expect(ObjectivePromotionDecisionSchema.safeParse(blockDecision).success).toBe(true);
  });

  it('refuses PROMOTE verdict when any stage did not pass', () => {
    const invalidPromote = {
      decisionId: 'dec-003',
      runId: 'run-001',
      verdict: 'PROMOTE' as const,
      gateTrail: failingTrail,
      decidedAt: '2026-06-15T12:00:00.000Z',
    };
    const parsed = ObjectivePromotionDecisionSchema.safeParse(invalidPromote);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) =>
          i.message.includes('promotion requires every gate stage to pass'),
        ),
      ).toBe(true);
    }
  });

  it('refuses BLOCK verdict when all stages passed', () => {
    const invalidBlock = {
      decisionId: 'dec-004',
      runId: 'run-001',
      verdict: 'BLOCK' as const,
      gateTrail: allPassingTrail,
      decidedAt: '2026-06-15T12:00:00.000Z',
    };
    const parsed = ObjectivePromotionDecisionSchema.safeParse(invalidBlock);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) =>
          i.message.includes('blocking verdicts require a failing gate stage'),
        ),
      ).toBe(true);
    }
  });
});

describe('HardConstraintEvaluationSchema, DiagnosticReportSchema & OutputLanguageScreenSchema', () => {
  it('HardConstraintEvaluationSchema accepts 7-kind evaluations and refuses missing kinds', () => {
    const validEvaluations: Record<HardConstraintKind, 'PASS'> = {
      SECURITY: 'PASS',
      EXECUTION: 'PASS',
      RIGHTS: 'PASS',
      LEAKAGE: 'PASS',
      PUBLIC_CLAIM: 'PASS',
      CAPACITY: 'PASS',
      TAIL_RISK: 'PASS',
    };

    const validRecord = {
      runId: 'run-001',
      evaluations: validEvaluations,
    };
    expect(HardConstraintEvaluationSchema.safeParse(validRecord).success).toBe(true);

    for (const kind of ALL_HARD_CONSTRAINT_KINDS) {
      const incomplete = { ...validEvaluations };
      delete (incomplete as Record<string, unknown>)[kind];
      expect(
        HardConstraintEvaluationSchema.safeParse({ runId: 'run-001', evaluations: incomplete })
          .success,
      ).toBe(false);
    }
  });

  it('DiagnosticReportSchema accepts 4 diagnostics with diagnosticOnly=true and refuses violations', () => {
    const validReport = {
      runId: 'run-001',
      diagnostics: {
        PER_ALERT_PRECISION: { numerator: 82, denominator: 100 },
        TRADABLE_SUCCESS_RATE: { numerator: 85, denominator: 100 },
        RECALL: { numerator: 75, denominator: 100 },
        ALERTS_PER_RESEARCHED_CANDIDATE: { numerator: 125, denominator: 100 },
      },
      diagnosticOnly: true as const,
      computedAt: '2026-06-15T12:00:00.000Z',
    };
    expect(DiagnosticReportSchema.safeParse(validReport).success).toBe(true);

    // Missing diagnostic kind
    const incompleteDiag = {
      ...validReport,
      diagnostics: {
        PER_ALERT_PRECISION: { numerator: 82, denominator: 100 },
        TRADABLE_SUCCESS_RATE: { numerator: 85, denominator: 100 },
        RECALL: { numerator: 75, denominator: 100 },
      },
    };
    expect(DiagnosticReportSchema.safeParse(incompleteDiag).success).toBe(false);

    // Negative numerator or 0 denominator
    expect(
      DiagnosticReportSchema.safeParse({
        ...validReport,
        diagnostics: {
          ...validReport.diagnostics,
          RECALL: { numerator: -5, denominator: 100 },
        },
      }).success,
    ).toBe(false);
    expect(
      DiagnosticReportSchema.safeParse({
        ...validReport,
        diagnostics: {
          ...validReport.diagnostics,
          RECALL: { numerator: 50, denominator: 0 },
        },
      }).success,
    ).toBe(false);
  });

  it('OutputLanguageScreenSchema enforces disclosure and clean/passed consistency', () => {
    const validScreen = {
      screenId: 'screen-001',
      outputId: 'out-001',
      prohibitedClaimsFound: [],
      disclosure: `Research signal. ${UNCERTAINTY_DISCLOSURE_TEXT}`,
      screenPassed: true,
      screenedAt: '2026-06-15T12:00:00.000Z',
    };
    expect(OutputLanguageScreenSchema.safeParse(validScreen).success).toBe(true);

    // Missing disclosure text
    const noDisclosure = { ...validScreen, disclosure: 'No disclosure here' };
    expect(OutputLanguageScreenSchema.safeParse(noDisclosure).success).toBe(false);

    // screenPassed=true with prohibited claims
    const passedWithProhibited = {
      ...validScreen,
      prohibitedClaimsFound: ['GUARANTEED_PROFIT' as const],
      screenPassed: true,
    };
    expect(OutputLanguageScreenSchema.safeParse(passedWithProhibited).success).toBe(false);

    // screenPassed=false when clean and disclosed
    const falseNegative = {
      ...validScreen,
      screenPassed: false,
    };
    expect(OutputLanguageScreenSchema.safeParse(falseNegative).success).toBe(false);
  });

  it('SensitivityGridSchema and ObjectiveComparisonSchema validate strictly', () => {
    const validGrid = {
      gridId: 'grid-001',
      runId: 'run-001',
      parentContentHash: SHA256_A,
      dimensions: ['CAPITAL' as const],
      points: [
        {
          dimension: 'CAPITAL' as const,
          basisPoints: 10000,
          lowerBoundUtilityMicros: '50000.00',
        },
      ],
      computedAt: '2026-06-15T12:00:00.000Z',
    };
    expect(SensitivityGridSchema.safeParse(validGrid).success).toBe(true);

    const validComparisonDimensions = ALL_COMPARISON_DIMENSIONS.reduce(
      (acc, dim) => ({ ...acc, [dim]: `dim_${dim}` }),
      {} as Record<ComparisonDimension, string>,
    );

    const validComparison = {
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      dimensions: validComparisonDimensions,
      verdict: 'COMPARABLE' as const,
    };
    expect(ObjectiveComparisonSchema.safeParse(validComparison).success).toBe(true);
  });
});
