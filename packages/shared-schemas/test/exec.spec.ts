import { describe, expect, it } from 'bun:test';
import {
  AdapterFamily,
  OutcomeClass,
  OutcomeMaturity,
  StateCompleteness,
  StressScenarioKind,
  TradabilityVerdict,
  utcTimestamp,
} from '@foresift/domain';
import {
  AdapterRegistryEntrySchema,
  AlertExecutionContentSchema,
  ConcurrentShadowAggregateSchema,
  EntryFillResultSchema,
  ExecStateCompletenessSchema,
  EXEC_SCHEMAS,
  EXEC_SCHEMA_REGISTRY_VERSION,
  ExecutionScenarioSchema,
  ExecutionSimulationSchema,
  ExitPolicyExperimentSchema,
  NetReturnBreakdownSchema,
  OutcomeClassSchema,
  OutcomeObservationPlanSchema,
  QuoteEvidenceSchema,
  ReplayManifestSchema,
  ScenarioPassMatrixSchema,
  StressScenarioResultSchema,
  UncertaintyBoundSchema,
  parseExecSchema,
} from '../src/exec.ts';

const AT = utcTimestamp('2026-09-05T00:00:00Z');
const LATER = utcTimestamp('2026-09-05T01:00:00Z');
const V = EXEC_SCHEMA_REGISTRY_VERSION;

const scenarioFixture = {
  scenarioId: 'scn_001',
  version: '1',
  notionalUsd: '1000',
  deterministicActionDelaySeconds: 30,
  entryPolicyVersionId: 'entry_v1',
  exitPolicyVersionId: 'exit_v1',
  maximumEntryImpact: 0.05,
  maximumExitImpact: 0.05,
  allowPartialFill: true,
  minimumFillFraction: 0.5,
  maximumFillDurationSeconds: 60,
  feePolicyVersionId: 'fees_v1',
  conservativeStressPolicyId: 'stress_v1',
  requiredPoolAdapterCoverage: 'COMPLETE',
  registeredAt: AT,
  schemaRegistryVersion: V,
};

const netReturnFixture = {
  grossEntryUsd: '-1000',
  grossExitUsd: '1040',
  poolFeesUsd: '-6',
  aggregatorFeesUsd: '-1',
  tokenTransferFeesUsd: '-2',
  priorityNetworkFeesUsd: '-0.5',
  executionImpactUsd: '-8',
  failedAttemptsUsd: '-0.4',
  partialFillShortfallUsd: '0',
  residualInventoryUsd: '0',
  adverseSelectionMevBufferUsd: '-3',
  quoteConversionDepegUsd: '0',
  accountCreationRentUsd: '-0.1',
  netReturnUsd: '19',
};

const uncertaintyFixture = {
  bound: '0.10',
  policyLimit: '0.30',
  stateCoverage: '0.95',
  contributors: ['missing_tick_array'],
};

const entryFillFixture = {
  requestedQuantity: '1000',
  filledQuantity: '1000',
  fillFraction: 1,
  averageExecutionPrice: '1.05',
  marginalPriceImpact: 0.01,
  averagePriceImpact: 0.005,
  failedAmount: '0',
  startAt: AT,
  completedAt: LATER,
  executionStatus: 'EXECUTED_FULL',
  qualityCodes: ['VALID'],
};

const simulationFixture = () => ({
  simulationId: 'sim_001',
  scenarioId: 'scn_001',
  candidateId: 'cand_001',
  outcomeClass: 'TRADABLE_SUCCESS',
  outcomeMaturity: 'FULLY_MATURED',
  censorReason: null,
  invalidReason: null,
  signalClass: 'SIGNAL_SUCCESS',
  tradabilityVerdict: 'CONFIRMED_TRADABLE',
  executionStatus: 'EXECUTED_FULL',
  stateCompleteness: 'COMPLETE',
  uncertainty: uncertaintyFixture,
  netReturn: netReturnFixture,
  entryFill: entryFillFixture,
  exitFill: null,
  profitRendered: true,
  qualityCodes: ['VALID'],
  observedAt: AT,
  availableAt: LATER,
  schemaRegistryVersion: V,
});

describe('Exec scenario schemas (§64.2, FR-EXEC-001/002)', () => {
  it('parses the exact §64.2 field set', () => {
    const parsed = ExecutionScenarioSchema.parse(scenarioFixture);
    expect(parsed.scenarioId).toBe('scn_001');
    expect(parsed.notionalUsd).toBe('1000');
  });

  it('rejects unknown keys and unknown coverage values', () => {
    expect(() => ExecutionScenarioSchema.parse({ ...scenarioFixture, sneakyExtra: 1 })).toThrow();
    expect(() =>
      ExecutionScenarioSchema.parse({
        ...scenarioFixture,
        requiredPoolAdapterCoverage: 'BEST_EFFORT',
      }),
    ).toThrow();
  });

  it('rejects non-decimal notionals and partial-fill law violations', () => {
    expect(() =>
      ExecutionScenarioSchema.parse({ ...scenarioFixture, notionalUsd: '1e3' }),
    ).toThrow();
    expect(() =>
      ExecutionScenarioSchema.parse({
        ...scenarioFixture,
        allowPartialFill: true,
        minimumFillFraction: 0,
      }),
    ).toThrow();
  });
});

describe('FR-EXEC-009 pre-registered exit-policy experiments', () => {
  const fixture = {
    experimentId: 'exp_001',
    scenarioId: 'scn_001',
    exitPolicyVersionId: 'exit_v1',
    exitPolicyKind: 'FIXED_HORIZON',
    isPrimary: true,
    preRegisteredAt: AT,
    registeredBeforeAnyOutcome: true,
    schemaRegistryVersion: V,
  };

  it('accepts a pre-registered primary experiment', () => {
    expect(ExitPolicyExperimentSchema.parse(fixture).isPrimary).toBe(true);
  });

  it('refuses retrospective registration', () => {
    expect(() =>
      ExitPolicyExperimentSchema.parse({ ...fixture, registeredBeforeAnyOutcome: false }),
    ).toThrow(/pre-registered/);
  });
});

describe('Net return breakdown (FR-EXEC-003/018)', () => {
  it('parses the full FR-EXEC-003/018 fee-leg field set', () => {
    const parsed = NetReturnBreakdownSchema.parse(netReturnFixture);
    expect(parsed.netReturnUsd).toBe('19');
  });

  it('rejects JS numbers in decimal fields', () => {
    expect(() =>
      NetReturnBreakdownSchema.parse({ ...netReturnFixture, poolFeesUsd: -6 }),
    ).toThrow();
  });
});

describe('Execution simulation payload laws (FR-EXEC-006/020, AC-124, AC-232)', () => {
  it('accepts a complete, tradable-success simulation with profit rendered', () => {
    expect(ExecutionSimulationSchema.parse(simulationFixture()).simulationId).toBe('sim_001');
  });

  it('refuses profit rendering without TRADABLE_SUCCESS (FR-EXEC-006)', () => {
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...simulationFixture(),
        outcomeClass: OutcomeClass.SIGNAL_SUCCESS,
        tradabilityVerdict: TradabilityVerdict.BLOCKED_EXECUTION_UNAVAILABLE,
        netReturn: null,
        entryFill: null,
      }),
    ).toThrow(/profit rendering requires TRADABLE_SUCCESS/);
  });

  it('refuses INCOMPLETE_BLOCKING state confirming tradability (AC-232)', () => {
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...simulationFixture(),
        stateCompleteness: StateCompleteness.INCOMPLETE_BLOCKING,
      }),
    ).toThrow(/INCOMPLETE_BLOCKING state cannot confirm tradability/);
  });

  it('requires an explicit censor reason for CENSORED outcomes (AC-124)', () => {
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...simulationFixture(),
        outcomeClass: OutcomeClass.CENSORED,
        tradabilityVerdict: TradabilityVerdict.BLOCKED_OBSERVATION_PLAN,
        profitRendered: false,
        censorReason: null,
      }),
    ).toThrow(/explicit censor reason/);
    expect(
      ExecutionSimulationSchema.parse({
        ...simulationFixture(),
        outcomeClass: OutcomeClass.CENSORED,
        tradabilityVerdict: TradabilityVerdict.BLOCKED_OBSERVATION_PLAN,
        profitRendered: false,
        censorReason: 'exchange outage obscured the exit window',
      }).censorReason,
    ).toContain('outage');
  });

  it('requires an explicit invalid reason for INVALID_DATA outcomes (AC-124)', () => {
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...simulationFixture(),
        outcomeClass: OutcomeClass.INVALID_DATA,
        tradabilityVerdict: TradabilityVerdict.BLOCKED_INCOMPLETE_STATE,
        profitRendered: false,
        invalidReason: null,
      }),
    ).toThrow(/explicit invalid reason/);
  });

  it('rejects unknown outcome classes, verdicts, and completeness values', () => {
    expect(() => OutcomeClassSchema.parse('MEGA_WIN')).toThrow();
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...simulationFixture(),
        tradabilityVerdict: 'PROBABLY_FINE',
      }),
    ).toThrow();
    expect(() => ExecStateCompletenessSchema.parse('MOSTLY_COMPLETE')).toThrow();
    expect(() =>
      parseExecSchema('ExecutionSimulation', {
        ...simulationFixture(),
        outcomeMaturity: 'MOSTLY_MATURED',
      }),
    ).toThrow();
  });

  it('keeps the signal axis free of TRADABLE_* classes', () => {
    expect(() =>
      ExecutionSimulationSchema.parse({ ...simulationFixture(), signalClass: 'TRADABLE_SUCCESS' }),
    ).toThrow();
  });
});

describe('Uncertainty bound (FR-EXEC-020)', () => {
  it('accepts in-range bounds and rejects out-of-range ones', () => {
    expect(UncertaintyBoundSchema.parse(uncertaintyFixture).bound).toBe('0.10');
    expect(() => UncertaintyBoundSchema.parse({ ...uncertaintyFixture, bound: '1.5' })).toThrow();
  });
});

describe('Observation plans (§64.14, FR-EXEC-011, AC-128)', () => {
  const plan = {
    planId: 'plan_001',
    candidateId: 'cand_001',
    triggerClass: 'CONFIRMED_OPPORTUNITY',
    cadenceSeconds: 60,
    observedFields: ['price', 'liquidity'],
    observedAccounts: ['pool_vault'],
    providerSourceIds: ['src_001'],
    durationSeconds: 86400,
    quotaCeiling: 5000,
    degradationPolicyId: 'degrade_v1',
    inclusionProbability: '0.25',
    stratum: 'meme_48h',
    populationLimit: 400,
    resolutionFloorSeconds: 30,
    issuedAt: AT,
    schemaRegistryVersion: V,
  };

  it('accepts a finite plan with inclusion probability and population limits', () => {
    expect(OutcomeObservationPlanSchema.parse(plan).triggerClass).toBe('CONFIRMED_OPPORTUNITY');
  });

  it('rejects out-of-range inclusion probability', () => {
    expect(() =>
      OutcomeObservationPlanSchema.parse({ ...plan, inclusionProbability: '1.5' }),
    ).toThrow();
  });
});

describe('Adapter registry and state snapshots (FR-EXEC-013/014/015)', () => {
  it('accepts a family-keyed registry entry and rejects unknown families', () => {
    const entry = {
      entryId: 'reg_001',
      adapterId: 'adapter_cp',
      version: '1.0.0',
      chainId: 'solana:mainnet',
      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      programVersion: '4.0.0',
      accountLayoutVersion: '4.0.0',
      curveType: 'CONSTANT_PRODUCT',
      family: AdapterFamily.CONSTANT_PRODUCT_AMM,
      supportState: 'AVAILABLE',
      registeredAt: AT,
      schemaRegistryVersion: V,
    };
    expect(AdapterRegistryEntrySchema.parse(entry).family).toBe(AdapterFamily.CONSTANT_PRODUCT_AMM);
    expect(() => AdapterRegistryEntrySchema.parse({ ...entry, family: 'UNI_V2_STYLE' })).toThrow();
  });

  it('records the §64.4 snapshot fields and rejects unknown completeness', () => {
    const snapshot = {
      snapshotId: 'snap_001',
      simulationId: 'sim_001',
      programId: 'prog',
      programVersion: '1',
      poolMathAdapterId: 'adapter_cp',
      poolMathAdapterVersion: '1.0.0',
      slot: '12345678',
      blockHash: null,
      finality: 'FINALIZED',
      rawAccountStateHashes: ['sha256:' + 'a'.repeat(64)],
      reserveVaultState: { base: '1000', quote: '2000' },
      tickBinCurveState: null,
      feeParameters: { lpFeeBps: '25' },
      transferSemanticsState: { supportState: 'NOT_PRESENT' },
      quoteConversionSource: 'src_001',
      quoteObservedAt: AT,
      routeLegIds: ['leg_001'],
      sharedLiquidityIds: [],
      stateCompleteness: 'COMPLETE',
      uncertaintyBound: '0.05',
      capturedAt: AT,
      schemaRegistryVersion: V,
    };
    expect(ExecutionStateSnapshotSchemaParse(snapshot).slot).toBe('12345678');
    expect(() =>
      ExecutionStateSnapshotSchemaParse({ ...snapshot, stateCompleteness: 'PARTIAL_KIND_OF' }),
    ).toThrow();
  });

  function ExecutionStateSnapshotSchemaParse(value: unknown) {
    return EXEC_SCHEMAS.ExecutionStateSnapshot.parse(value);
  }
});

describe('Quote evidence (FR-EXEC-005/020)', () => {
  const quote = {
    quoteId: 'q_001',
    simulationId: 'sim_001',
    sourceId: 'src_001',
    providerPayloadKind: 'QUOTE_ONLY',
    quotePayloadHash: 'sha256:' + 'b'.repeat(64),
    convertedQuoteUsd: '1.002',
    depegState: 'WITHIN_TOLERANCE',
    transactionConstructionRefused: false,
    uncertaintyBound: '0.02',
    observedAt: AT,
    availableAt: LATER,
    schemaRegistryVersion: V,
  };

  it('accepts quote-only evidence', () => {
    expect(QuoteEvidenceSchema.parse(quote).providerPayloadKind).toBe('QUOTE_ONLY');
  });

  it('records transaction-construction payloads only as refused (FR-EXEC-005)', () => {
    expect(() =>
      QuoteEvidenceSchema.parse({
        ...quote,
        providerPayloadKind: 'TRANSACTION_CONSTRUCTION_ATTEMPT_REFUSED',
        transactionConstructionRefused: false,
      }),
    ).toThrow(/only recordable as refused/);
    expect(
      QuoteEvidenceSchema.parse({
        ...quote,
        providerPayloadKind: 'TRANSACTION_CONSTRUCTION_ATTEMPT_REFUSED',
        transactionConstructionRefused: true,
        convertedQuoteUsd: null,
        depegState: 'UNABLE_TO_VERIFY',
      }).transactionConstructionRefused,
    ).toBe(true);
  });
});

describe('Stress results and pass matrix (FR-EXEC-012/017, AC-235)', () => {
  const result = (kind: string, passed: boolean) => ({
    resultId: `res_${kind}`,
    simulationId: 'sim_001',
    scenarioKind: kind,
    passed,
    netReturnUsd: '5',
    fillFraction: 1,
    assumptionsHash: 'sha256:' + 'c'.repeat(64),
    evaluatedAt: AT,
    schemaRegistryVersion: V,
  });

  it('requires every declared scenario kind to have a recorded result', () => {
    const matrix = {
      matrixId: 'mx_001',
      simulationId: 'sim_001',
      requiredScenarioKinds: [StressScenarioKind.BASE_CASE, StressScenarioKind.P50_DELAY],
      results: [result('BASE_CASE', true), result('P50_DELAY', false)],
      conservativeDefault: true,
      schemaRegistryVersion: V,
    };
    expect(ScenarioPassMatrixSchema.parse(matrix).conservativeDefault).toBe(true);
    expect(() =>
      ScenarioPassMatrixSchema.parse({
        ...matrix,
        results: [result('BASE_CASE', true)],
      }),
    ).toThrow(/every required scenario kind/);
  });

  it('rejects unknown stress kinds and non-conservative defaults without base', () => {
    expect(() => StressScenarioResultSchema.parse(result('OPTIMISTIC_ONLY', true))).toThrow();
    expect(() =>
      ScenarioPassMatrixSchema.parse({
        matrixId: 'mx_002',
        simulationId: 'sim_001',
        requiredScenarioKinds: [StressScenarioKind.P90_DELAY],
        results: [result('P90_DELAY', true)],
        conservativeDefault: true,
        schemaRegistryVersion: V,
      }),
    ).toThrow(/conservative default must include BASE_CASE/);
  });
});

describe('Alert execution content (FR-EXEC-008)', () => {
  const alert = {
    alertId: 'alert_001',
    candidateId: 'cand_001',
    scenarioId: 'scn_001',
    configuredNotionalUsd: '1000',
    actionDelaySeconds: 30,
    modeledImpactUsd: '-8',
    assumptions: ['p50 delay 30s', 'cpmm fee 25bps'],
    signalClass: 'SIGNAL_SUCCESS',
    tradableClass: OutcomeClass.TRADABLE_SUCCESS,
    profitRendered: true,
    validUntil: LATER,
    schemaRegistryVersion: V,
  };

  it('exposes notional, delay, impact, assumptions, and expiry', () => {
    const parsed = AlertExecutionContentSchema.parse(alert);
    expect(parsed.configuredNotionalUsd).toBe('1000');
    expect(parsed.validUntil).toBe(LATER);
  });

  it('refuses profit rendering without TRADABLE_SUCCESS (FR-EXEC-006)', () => {
    expect(() =>
      AlertExecutionContentSchema.parse({
        ...alert,
        tradableClass: OutcomeClass.TRADABLE_FAILURE,
      }),
    ).toThrow(/profit rendering requires TRADABLE_SUCCESS/);
  });
});

describe('Concurrent shadow aggregates (FR-EXEC-019, AC-236)', () => {
  const aggregate = {
    aggregateId: 'agg_001',
    sharingKeyKind: 'POOL',
    sharingKeyValue: 'pool_001',
    positionIds: ['pos_b', 'pos_a'],
    aggregateImpactUsd: '-40',
    aggregateFillFraction: 0.6,
    resolutionOrder: ['pos_a', 'pos_b'],
    aggregatedAt: AT,
    schemaRegistryVersion: V,
  };

  it('accepts a lexicographic deterministic resolution order', () => {
    expect(ConcurrentShadowAggregateSchema.parse(aggregate).resolutionOrder).toEqual([
      'pos_a',
      'pos_b',
    ]);
  });

  it('refuses non-lexicographic or mismatched resolution orders', () => {
    expect(() =>
      ConcurrentShadowAggregateSchema.parse({ ...aggregate, resolutionOrder: ['pos_b', 'pos_a'] }),
    ).toThrow(/lexicographic/);
    expect(() =>
      ConcurrentShadowAggregateSchema.parse({ ...aggregate, resolutionOrder: ['pos_a'] }),
    ).toThrow();
  });
});

describe('Replay manifest freeze (FR-EXEC-010, AC-127)', () => {
  it('freezes assumption hashes, scenario payloads, and versions', () => {
    const manifest = {
      manifestId: 'rm_001',
      scenarioId: 'scn_001',
      scenarioPayload: { notionalUsd: '1000' },
      assumptionsHash: 'sha256:' + 'd'.repeat(64),
      adapterVersions: [{ adapterId: 'adapter_cp', version: '1.0.0' }],
      codeVersions: { simulator: '1.0.0' },
      policyVersions: { stress: 'stress_v1' },
      frozenAt: AT,
      schemaRegistryVersion: V,
    };
    expect(ReplayManifestSchema.parse(manifest).assumptionsHash.startsWith('sha256:')).toBe(true);
    expect(() => ReplayManifestSchema.parse({ ...manifest, assumptionsHash: 'md5:zz' })).toThrow();
  });
});

describe('Entry fill results (§64.6)', () => {
  it('enforces EXECUTED_FULL ⟺ fill fraction 1', () => {
    expect(EntryFillResultSchema.parse(entryFillFixture).fillFraction).toBe(1);
    expect(() => EntryFillResultSchema.parse({ ...entryFillFixture, fillFraction: 0.5 })).toThrow(
      /fill fraction 1/,
    );
  });

  it('refuses completion before start', () => {
    expect(() =>
      EntryFillResultSchema.parse({ ...entryFillFixture, completedAt: AT, startAt: LATER }),
    ).toThrow();
  });
});
