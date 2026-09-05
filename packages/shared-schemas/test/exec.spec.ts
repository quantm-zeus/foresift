/**
 * Exec schema boundary tests (FR-EXEC-001…003, 006, 008, 010, 011, 014, 018):
 * unknown enum rejection, strict-shape rejection, and payload-layer
 * refinement law boundaries.
 */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  AdapterFamily,
  AdapterSupportState,
  ExecutionStatus,
  OutcomeClass,
  OutcomeMaturity,
  QualityCode,
  StressScenarioKind,
} from '@foresift/domain';
import {
  EXEC_SCHEMA_REGISTRY_VERSION,
  ExecutionScenarioSchema,
  ExecutionSimulationSchema,
  AlertExecutionContentSchema,
  AdapterRegistryEntrySchema,
  QuoteEvidenceSchema,
  OutcomeObservationPlanSchema,
  ScenarioPassMatrixSchema,
  ReplayManifestSchema,
  AdapterFamilySchema,
  type ExecutionScenario,
  type ExecutionSimulation,
} from '../src/exec.ts';

const baseScenario: ExecutionScenario = {
  scenarioId: 'scn-001',
  version: '1',
  notionalUsd: '1000.00',
  deterministicActionDelaySeconds: 30,
  entryPolicyVersionId: 'entry-v1',
  exitPolicyVersionId: 'exit-v1',
  maximumEntryImpact: 0.02,
  maximumExitImpact: 0.02,
  allowPartialFill: true,
  minimumFillFraction: 0.5,
  maximumFillDurationSeconds: 60,
  feePolicyVersionId: 'fee-v1',
  conservativeStressPolicyId: 'stress-v1',
  requiredPoolAdapterCoverage: 'COMPLETE',
};

const baseNetReturn = {
  grossReturnUsd: '50.00',
  poolFeesUsd: '1.00',
  aggregatorFeesUsd: '0.50',
  tokenTransferFeesUsd: '0.10',
  priorityNetworkFeesUsd: '0.01',
  executionImpactUsd: '2.00',
  failedAttemptsUsd: '0.00',
  partialFillPenaltyUsd: '0.00',
  residualInventoryUsd: '0.00',
  adverseSelectionMevBufferUsd: '0.05',
  quoteConversionDepegUsd: '0.00',
  accountCreationRentUsd: '0.00',
  netReturnUsd: '46.34',
  qualityCodes: [QualityCode.VALID],
};

const baseEntry = {
  requestedQuantity: '1000.00',
  filledQuantity: '1000.00',
  fillFraction: 1,
  averageExecutionPrice: '1.05',
  marginalPriceImpact: 0.01,
  averagePriceImpact: 0.008,
  failedAmount: '0',
  startSlot: 1000,
  completionSlot: 1002,
  startedAt: '2026-09-05T00:00:00Z',
  completedAt: '2026-09-05T00:01:00Z',
  status: ExecutionStatus.EXECUTED_FULL,
  netReturn: baseNetReturn,
};

const baseExit = {
  exitPolicyVersionId: 'exit-v1',
  triggerAt: '2026-09-05T01:00:00Z',
  completedAt: '2026-09-05T01:00:30Z',
  triggerCompletionOrderValid: true,
  requestedQuantity: '1000.00',
  filledQuantity: '1000.00',
  fillFraction: 1,
  averageExecutionPrice: '1.10',
  status: ExecutionStatus.EXECUTED_FULL,
  netReturn: baseNetReturn,
};

const baseSimulation: ExecutionSimulation = {
  simulationId: 'sim-001',
  candidateId: 'cand-001',
  scenarioId: 'scn-001',
  scenarioVersion: '1',
  outcomeProfileVersion: 'HG-EM-1@1',
  entry: baseEntry,
  exit: baseExit,
  tradabilityVerdict: 'TRADABLE',
  tradableFailureReason: null,
  signalLabel: 'SIGNAL_SUCCESS',
  tradableLabel: 'TRADABLE_SUCCESS',
  outcomeMaturity: 'FULLY_MATURED',
  stateSnapshotId: 'snap-001',
  replayManifestId: 'replay-001',
  pathAmbiguity: { primaryOrdering: 'UNAMBIGUOUS', ambiguous: false },
  observedAt: '2026-09-05T00:00:00Z',
  availableAt: '2026-09-05T00:00:01Z',
  qualityCodes: [QualityCode.VALID],
  schemaRegistryVersion: EXEC_SCHEMA_REGISTRY_VERSION,
};

describe('ExecutionScenario schema (§64.2 exact field set)', () => {
  it('accepts the pre-registered scenario shape', () => {
    expect(ExecutionScenarioSchema.parse(baseScenario).scenarioId).toBe('scn-001');
  });

  it('rejects unknown fields (.strict())', () => {
    expect(() =>
      ExecutionScenarioSchema.parse({ ...baseScenario, retrospectiveBestRoute: 'route-9' }),
    ).toThrow(z.ZodError);
  });

  it('rejects unknown requiredPoolAdapterCoverage values (fail closed)', () => {
    expect(() =>
      ExecutionScenarioSchema.parse({
        ...baseScenario,
        requiredPoolAdapterCoverage: 'BEST_EFFORT',
      }),
    ).toThrow(z.ZodError);
  });

  it('rejects non-decimal notionals (numeric policy)', () => {
    expect(() => ExecutionScenarioSchema.parse({ ...baseScenario, notionalUsd: 1000 })).toThrow(
      z.ZodError,
    );
    expect(() => ExecutionScenarioSchema.parse({ ...baseScenario, notionalUsd: '1e3' })).toThrow(
      z.ZodError,
    );
  });

  it('enforces partial-fill coherence', () => {
    expect(() =>
      ExecutionScenarioSchema.parse({
        ...baseScenario,
        allowPartialFill: false,
        minimumFillFraction: 0.5,
      }),
    ).toThrow(z.ZodError);
  });
});

describe('payload-layer refinement law (FR-EXEC-006 / §64.4 / AC-232)', () => {
  it('accepts a coherent TRADABLE_SUCCESS simulation with a preserved signal label', () => {
    const parsed = ExecutionSimulationSchema.parse(baseSimulation);
    expect(parsed.tradableLabel).toBe(OutcomeClass.TRADABLE_SUCCESS);
    expect(parsed.signalLabel).toBe(OutcomeClass.SIGNAL_SUCCESS);
  });

  it('rejects SIGNAL_SUCCESS rendering profit without TRADABLE_SUCCESS', () => {
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...baseSimulation,
        tradableLabel: OutcomeClass.TRADABLE_FAILURE,
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...baseSimulation,
        tradableLabel: null,
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...baseSimulation,
        tradableLabel: OutcomeClass.PENDING,
        outcomeMaturity: OutcomeMaturity.PENDING,
      }),
    ).toThrow(z.ZodError);
  });

  it('permits SIGNAL_SUCCESS with a non-positive tradable payload', () => {
    const negative = {
      ...baseSimulation,
      tradableLabel: OutcomeClass.TRADABLE_FAILURE,
      entry: {
        ...baseEntry,
        netReturn: { ...baseNetReturn, grossReturnUsd: '-5.00', netReturnUsd: '-9.34' },
      },
    };
    expect(ExecutionSimulationSchema.parse(negative).tradableLabel).toBe(
      OutcomeClass.TRADABLE_FAILURE,
    );
  });

  it('rejects TRADABLE_SUCCESS over unavailable/unsupported/insufficient entry status', () => {
    for (const status of [
      ExecutionStatus.EXECUTION_UNAVAILABLE,
      ExecutionStatus.POOL_MATH_UNSUPPORTED,
      ExecutionStatus.INSUFFICIENT_DATA,
    ]) {
      expect(() =>
        ExecutionSimulationSchema.parse({
          ...baseSimulation,
          entry: { ...baseEntry, status },
        }),
      ).toThrow(z.ZodError);
    }
  });

  it('rejects a signal label on the tradable axis and a failure reason without its label', () => {
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...baseSimulation,
        tradableLabel: OutcomeClass.SIGNAL_SUCCESS,
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...baseSimulation,
        tradableFailureReason: 'SECURITY_OR_LIQUIDITY',
      }),
    ).toThrow(z.ZodError);
  });

  it('rejects unknown enum/state values (fail closed)', () => {
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...baseSimulation,
        tradabilityVerdict: 'PROBABLY_FINE',
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...baseSimulation,
        outcomeMaturity: 'MATURE_ENOUGH',
      }),
    ).toThrow(z.ZodError);
  });

  it('rejects unknown keys and enforces availability order', () => {
    expect(() => ExecutionSimulationSchema.parse({ ...baseSimulation, retrofitted: true })).toThrow(
      z.ZodError,
    );
    expect(() =>
      ExecutionSimulationSchema.parse({
        ...baseSimulation,
        availableAt: '2026-09-04T00:00:00Z',
      }),
    ).toThrow(z.ZodError);
  });
});

describe('AdapterRegistryEntry and QuoteEvidence boundaries (§64.3 / §64.5)', () => {
  const baseAdapter = {
    adapterId: 'adapter-cp',
    version: '2',
    chainId: 'solana:mainnet',
    programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    supportedProgramVersions: ['4'],
    curveTypes: ['CONSTANT_PRODUCT_64'],
    family: AdapterFamily.CONSTANT_PRODUCT_AMM,
    accountLayoutVersion: 'layout-v3',
    supportState: AdapterSupportState.AVAILABLE,
    parityGateVersion: 'parity-v1',
    fixtureBundleHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };

  it('requires parity and fixture references for AVAILABLE adapters', () => {
    expect(AdapterRegistryEntrySchema.parse(baseAdapter).supportState).toBe('AVAILABLE');
    expect(() =>
      AdapterRegistryEntrySchema.parse({ ...baseAdapter, parityGateVersion: null }),
    ).toThrow(z.ZodError);
    expect(() =>
      AdapterRegistryEntrySchema.parse({
        ...baseAdapter,
        supportState: AdapterSupportState.UNAVAILABLE,
        parityGateVersion: null,
        fixtureBundleHash: null,
      }),
    ).not.toThrow();
  });

  it('rejects unknown adapter families', () => {
    expect(() => AdapterFamilySchema.parse('GENERIC_AMM')).toThrow(z.ZodError);
    expect(AdapterFamilySchema.parse(AdapterFamily.UNKNOWN)).toBe(AdapterFamily.UNKNOWN);
  });

  it('rejects transaction-construction payloads from quote providers (INV-001)', () => {
    const quote = {
      quoteId: 'q-001',
      sourceId: 'src-001',
      sourceKind: 'INDEPENDENT_AGGREGATOR',
      inTokenMint: 'mint-a',
      outTokenMint: 'mint-b',
      inAmount: '100.00',
      outAmount: '98.00',
      quoteAt: '2026-09-05T00:00:00Z',
      observedAt: '2026-09-05T00:00:01Z',
      routeLegs: [{ pool: 'pool-1' }],
      transactionPayloadRef: null,
      qualityCodes: [QualityCode.VALID],
    };
    expect(QuoteEvidenceSchema.parse(quote).quoteId).toBe('q-001');
    expect(() =>
      QuoteEvidenceSchema.parse({ ...quote, transactionPayloadRef: 'swap-tx-bytes' }),
    ).toThrow(z.ZodError);
  });
});

describe('OutcomeObservationPlan and ScenarioPassMatrix boundaries (§64.14 / FR-EXEC-017)', () => {
  const basePlan = {
    planId: 'plan-001',
    planVersion: '1',
    candidateId: 'cand-001',
    triggerClass: 'CONFIRMED_OPPORTUNITY',
    cadenceSeconds: 60,
    observedFields: ['price', 'liquidity'],
    providerSourceIds: ['src-1'],
    durationSeconds: 3600,
    quotaCeiling: { maxCalls: 120 },
    degradationPolicyId: 'degrade-v1',
    resolutionFloor: {
      temporalSeconds: 30,
      poolStateComplete: true,
      liquidityDepthMinUsd: '5000.00',
    },
    inclusionProbability: null,
    stratum: null,
    populationLimit: null,
    registeredAt: '2026-09-05T00:00:00Z',
  };

  it('accepts a census plan and rejects sampled plans without stratum/population', () => {
    expect(OutcomeObservationPlanSchema.parse(basePlan).planId).toBe('plan-001');
    expect(() =>
      OutcomeObservationPlanSchema.parse({ ...basePlan, inclusionProbability: 0.25 }),
    ).toThrow(z.ZodError);
    expect(
      OutcomeObservationPlanSchema.parse({
        ...basePlan,
        inclusionProbability: 0.25,
        stratum: 'rank-top-decile',
        populationLimit: 'universe-500',
      }).stratum,
    ).toBe('rank-top-decile');
  });

  const baseResult = {
    scenarioId: 'scn-001',
    scenarioVersion: '1',
    stressKind: StressScenarioKind.BASE_CASE,
    status: ExecutionStatus.EXECUTED_FULL,
    netReturn: baseNetReturn,
    fillFraction: 1,
    passed: true,
    assumptionsHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  };

  it('rejects pass matrices with missing or failed required kinds', () => {
    const matrix = {
      matrixId: 'mx-001',
      candidateId: 'cand-001',
      outcomeProfileVersion: 'HG-EM-1@1',
      requiredKinds: [StressScenarioKind.BASE_CASE, StressScenarioKind.P90_DELAY],
      results: [baseResult, { ...baseResult, stressKind: StressScenarioKind.P90_DELAY }],
      conservativeStressPolicyId: 'stress-v1',
      evaluatedAt: '2026-09-05T00:00:00Z',
    };
    expect(ScenarioPassMatrixSchema.parse(matrix).matrixId).toBe('mx-001');
    // Missing result for a required kind.
    expect(() => ScenarioPassMatrixSchema.parse({ ...matrix, results: [baseResult] })).toThrow(
      z.ZodError,
    );
    // Failed required kind.
    expect(() =>
      ScenarioPassMatrixSchema.parse({
        ...matrix,
        results: [
          baseResult,
          { ...baseResult, stressKind: StressScenarioKind.P90_DELAY, passed: false },
        ],
      }),
    ).toThrow(z.ZodError);
  });
});

describe('AlertExecutionContent and ReplayManifest boundaries (FR-EXEC-008 / FR-EXEC-010)', () => {
  it('enforces alert expiry after render', () => {
    const alert = {
      alertId: 'alert-001',
      candidateId: 'cand-001',
      configuredNotionalUsd: '1000.00',
      actionDelaySeconds: 30,
      modeledEntryImpact: 0.01,
      modeledExitImpact: 0.01,
      assumptions: ['fee-v1', 'stress-v1'],
      assumptionsHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      validUntil: '2026-09-05T01:00:00Z',
      renderedAt: '2026-09-05T00:00:00Z',
    };
    expect(AlertExecutionContentSchema.parse(alert).alertId).toBe('alert-001');
    expect(() =>
      AlertExecutionContentSchema.parse({ ...alert, validUntil: '2026-09-04T00:00:00Z' }),
    ).toThrow(z.ZodError);
  });

  it('requires the frozen execution versions in replay manifests', () => {
    const manifest = {
      replayId: 'replay-001',
      asOf: '2026-09-05T00:00:00Z',
      datasetVersion: 'ds-v1',
      populationClaim: 'SUPPORTED_PROGRAM_UNIVERSE',
      candidateUniverseHash:
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      observationCutoff: '2026-09-04T00:00:00Z',
      collectorCoverageManifestId: 'ccm-1',
      providerDependenceVersion: 'pd-v1',
      featureVersion: 'feat-v1',
      rankingVersion: 'rank-v1',
      workflowVersion: 'wf-v1',
      promptVersion: 'prompt-v1',
      toolProfileVersion: 'tool-v1',
      modelProfileVersion: 'model-v1',
      outcomeProfileVersion: 'HG-EM-1@1',
      policyVersion: 'policy-v1',
      deliveryLatencyPolicyVersion: 'dl-v1',
      capacityContractVersion: 'cap-v1',
      poolMathAdapterVersions: ['adapter-cp@2'],
      executionScenarioVersions: ['scn-001@1'],
      artifactIds: [],
      holdoutExposureSnapshotId: 'holdout-1',
      codeAndDependencyHash:
        'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    };
    expect(ReplayManifestSchema.parse(manifest).replayId).toBe('replay-001');
    expect(() => ReplayManifestSchema.parse({ ...manifest, poolMathAdapterVersions: [] })).toThrow(
      z.ZodError,
    );
    expect(() =>
      ReplayManifestSchema.parse({ ...manifest, executionScenarioVersions: [] }),
    ).toThrow(z.ZodError);
  });
});
