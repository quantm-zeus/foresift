/**
 * Runtime boundary schemas for the execution-aware outcome, pool-math, and
 * tradability engine (§64, §8, §31.5, §64.14 — FR-EXEC-001…003, 006, 008,
 * 010, 011, 014, 018).
 *
 * These schemas are the runtime-validation boundary for execution payloads
 * crossing process/store boundaries. Where a vocabulary exists in
 * `@foresift/domain` (packages/domain/src/exec.ts) it is imported, not
 * restated — outcome classes, maturities, adapter families/support states,
 * execution statuses, stress kinds, exit-policy kinds, orderings, verdicts,
 * and observation-plan trigger classes are compile-linked, so a domain
 * change cannot drift from its schema mirror without failing to compile.
 *
 * Payload-layer refinement law: a payload carrying SIGNAL_SUCCESS may never
 * render profit without TRADABLE_SUCCESS (FR-EXEC-006/INV-011), and a
 * payload carrying an incomplete/unavailable execution state may never claim
 * a confirmed tradable success (§64.4, AC-232, INV-011). Unknown enum/state
 * values fail closed via the mirrored domain enums.
 *
 * Numeric policy (packages/shared-schemas/src/data.ts): amounts cross
 * boundaries as decimal digit strings (never JS numbers); timestamps as
 * ISO-8601 UTC strings ending in `Z`; content hashes as `sha256:<hex>`.
 */
import { z } from 'zod';
import {
  ALL_ADAPTER_FAMILIES,
  ALL_ADAPTER_SUPPORT_STATES,
  ALL_EXECUTION_STATUSES,
  ALL_EXIT_POLICY_KINDS,
  ALL_OBSERVATION_PLAN_TRIGGER_CLASSES,
  ALL_OUTCOME_CLASSES,
  ALL_OUTCOME_MATURITIES,
  ALL_PRIMARY_ORDERINGS,
  ALL_STRESS_SCENARIO_KINDS,
  ALL_TRADABILITY_VERDICTS,
  ALL_TRADABLE_FAILURE_REASONS,
} from '@foresift/domain';
import {
  ChainIdSchema,
  DecimalStringSchema,
  DigitStringSchema,
  QualityCodesSchema,
  UtcTimestampSchema,
} from './data.ts';

export const EXEC_SCHEMA_REGISTRY_VERSION = 1;

const nonEmptyId = z.string().min(1);

// Named `ExecSha256RefSchema` (not `Sha256RefSchema`) to avoid a star-export
// ambiguity with the identical solsec-family schema in the package barrel.
export const ExecSha256RefSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'expected sha256:<64 lowercase hex characters>');

// ---------------------------------------------------------------------------
// Domain-mirrored closed vocabularies (compile-linked, never restated)
// ---------------------------------------------------------------------------

function domainEnum<T extends string>(values: readonly T[]) {
  return z.enum([...values] as [T, ...T[]]);
}

export const OutcomeClassSchema = domainEnum(ALL_OUTCOME_CLASSES);
export const OutcomeMaturitySchema = domainEnum(ALL_OUTCOME_MATURITIES);
export const AdapterFamilySchema = domainEnum(ALL_ADAPTER_FAMILIES);
export const AdapterSupportStateSchema = domainEnum(ALL_ADAPTER_SUPPORT_STATES);
export const ExecutionStatusSchema = domainEnum(ALL_EXECUTION_STATUSES);
export const StressScenarioKindSchema = domainEnum(ALL_STRESS_SCENARIO_KINDS);
export const ExitPolicyKindSchema = domainEnum(ALL_EXIT_POLICY_KINDS);
export const PrimaryOrderingSchema = domainEnum(ALL_PRIMARY_ORDERINGS);
export const TradabilityVerdictSchema = domainEnum(ALL_TRADABILITY_VERDICTS);
export const ObservationPlanTriggerClassSchema = domainEnum(ALL_OBSERVATION_PLAN_TRIGGER_CLASSES);
export const TradableFailureReasonSchema = domainEnum(ALL_TRADABLE_FAILURE_REASONS);

// ---------------------------------------------------------------------------
// Scenario identity (§64.2) — pre-registered, versioned, fail-closed
// ---------------------------------------------------------------------------

/**
 * §64.2 exact field set. Scenarios are pre-registered; evaluation MUST NOT
 * select the historically best scenario/delay/notional/route/exit policy
 * after observing outcomes (FR-EXEC-009) — the schema enforces the
 * pre-registration fields, and no retrospective-selection field exists.
 */
export const ExecutionScenarioSchema = z
  .object({
    scenarioId: nonEmptyId,
    version: nonEmptyId,
    notionalUsd: DecimalStringSchema,
    deterministicActionDelaySeconds: z.number().int().min(0),
    empiricalActionDelayPolicyId: nonEmptyId.optional(),
    entryPolicyVersionId: nonEmptyId,
    exitPolicyVersionId: nonEmptyId,
    maximumEntryImpact: z.number().finite().min(0),
    maximumExitImpact: z.number().finite().min(0),
    allowPartialFill: z.boolean(),
    minimumFillFraction: z.number().finite().min(0).max(1),
    maximumFillDurationSeconds: z.number().int().min(0),
    feePolicyVersionId: nonEmptyId,
    conservativeStressPolicyId: nonEmptyId,
    requiredPoolAdapterCoverage: z.enum(['COMPLETE', 'BOUNDED_APPROXIMATION']),
  })
  .strict()
  .refine((value) => value.allowPartialFill || value.minimumFillFraction >= 1, {
    message: 'partial fills disallowed implies minimumFillFraction of 1',
  });
export type ExecutionScenario = z.infer<typeof ExecutionScenarioSchema>;

/**
 * FR-EXEC-009: multiple exit policies are evaluated only as pre-registered
 * separate experiments. Exactly one policy per scenario is the primary; all
 * others are secondary experiments whose results can never replace it.
 */
export const ExitPolicyExperimentSchema = z
  .object({
    experimentId: nonEmptyId,
    scenarioId: nonEmptyId,
    scenarioVersion: nonEmptyId,
    exitPolicyKind: ExitPolicyKindSchema,
    exitPolicyVersionId: nonEmptyId,
    isPrimary: z.boolean(),
    registeredAt: UtcTimestampSchema,
    parameters: z.record(z.unknown()),
  })
  .strict()
  .refine((value) => value.isPrimary || Object.keys(value.parameters).length >= 0, {
    message: 'secondary experiments carry their pre-registered parameters',
  });
export type ExitPolicyExperiment = z.infer<typeof ExitPolicyExperimentSchema>;

// ---------------------------------------------------------------------------
// Net return decomposition (FR-EXEC-003 / FR-EXEC-018 / §64.9)
// ---------------------------------------------------------------------------

/** Non-negative decimal-string fee/impact component. */
const NonNegativeAmountSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/, 'expected non-negative canonical decimal string');

/**
 * FR-EXEC-003/FR-EXEC-018 net-return breakdown. Every modeled cost dimension
 * is explicit; zero cost is never silently assumed (§64.9) — components that
 * were not applicable are `null` with the associated quality code carrying
 * the reason, not a missing field.
 */
export const NetReturnBreakdownSchema = z
  .object({
    grossReturnUsd: z
      .string()
      .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/, 'expected signed canonical decimal string'),
    poolFeesUsd: NonNegativeAmountSchema,
    aggregatorFeesUsd: NonNegativeAmountSchema,
    tokenTransferFeesUsd: NonNegativeAmountSchema,
    priorityNetworkFeesUsd: NonNegativeAmountSchema,
    executionImpactUsd: NonNegativeAmountSchema,
    failedAttemptsUsd: NonNegativeAmountSchema,
    partialFillPenaltyUsd: NonNegativeAmountSchema,
    residualInventoryUsd: NonNegativeAmountSchema,
    adverseSelectionMevBufferUsd: NonNegativeAmountSchema,
    quoteConversionDepegUsd: NonNegativeAmountSchema,
    accountCreationRentUsd: NonNegativeAmountSchema,
    netReturnUsd: z
      .string()
      .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/, 'expected signed canonical decimal string'),
    qualityCodes: QualityCodesSchema,
  })
  .strict();
export type NetReturnBreakdown = z.infer<typeof NetReturnBreakdownSchema>;

// ---------------------------------------------------------------------------
// Entry/exit fill results (§64.6 / §64.7 / FR-EXEC-002/018)
// ---------------------------------------------------------------------------

export const EntryFillResultSchema = z
  .object({
    requestedQuantity: DecimalStringSchema,
    filledQuantity: DecimalStringSchema,
    fillFraction: z.number().finite().min(0).max(1),
    averageExecutionPrice: DecimalStringSchema,
    marginalPriceImpact: z.number().finite().min(0),
    averagePriceImpact: z.number().finite().min(0),
    failedAmount: DecimalStringSchema,
    startSlot: z.number().int().min(0),
    completionSlot: z.number().int().min(0),
    startedAt: UtcTimestampSchema,
    completedAt: UtcTimestampSchema,
    status: ExecutionStatusSchema,
    netReturn: NetReturnBreakdownSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.completionSlot >= value.startSlot &&
      Date.parse(value.completedAt) >= Date.parse(value.startedAt),
    { message: 'completion cannot precede start' },
  )
  .refine((value) => value.status !== 'EXECUTED_FULL' || value.fillFraction === 1, {
    message: 'EXECUTED_FULL requires fillFraction 1',
  })
  .refine(
    (value) =>
      value.status !== 'EXECUTION_PARTIAL' || (value.fillFraction < 1 && value.fillFraction > 0),
    { message: 'EXECUTION_PARTIAL requires a partial (0,1) fill fraction' },
  );
export type EntryFillResult = z.infer<typeof EntryFillResultSchema>;

export const ExitFillResultSchema = z
  .object({
    exitPolicyVersionId: nonEmptyId,
    triggerAt: UtcTimestampSchema,
    completedAt: UtcTimestampSchema,
    triggerCompletionOrderValid: z.boolean(),
    requestedQuantity: DecimalStringSchema,
    filledQuantity: DecimalStringSchema,
    fillFraction: z.number().finite().min(0).max(1),
    averageExecutionPrice: DecimalStringSchema,
    status: ExecutionStatusSchema,
    netReturn: NetReturnBreakdownSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.triggerCompletionOrderValid ||
      Date.parse(value.completedAt) >= Date.parse(value.triggerAt),
    { message: 'exit completion cannot precede its trigger (§64.7)' },
  );
export type ExitFillResult = z.infer<typeof ExitFillResultSchema>;

// ---------------------------------------------------------------------------
// Replay manifest (§31.5 / FR-EXEC-010)
// ---------------------------------------------------------------------------

/**
 * §31.5 frozen replay manifest with the execution extensions (pool-math
 * adapter versions, execution-scenario versions). Assumptions and code
 * versions are frozen at replay time; nothing here is mutable.
 */
export const ReplayManifestSchema = z
  .object({
    replayId: nonEmptyId,
    asOf: UtcTimestampSchema,
    datasetVersion: nonEmptyId,
    populationClaim: nonEmptyId,
    candidateUniverseHash: ExecSha256RefSchema,
    observationCutoff: UtcTimestampSchema,
    collectorCoverageManifestId: nonEmptyId,
    providerDependenceVersion: nonEmptyId,
    featureVersion: nonEmptyId,
    rankingVersion: nonEmptyId,
    workflowVersion: nonEmptyId,
    promptVersion: nonEmptyId,
    toolProfileVersion: nonEmptyId,
    modelProfileVersion: nonEmptyId,
    outcomeProfileVersion: nonEmptyId,
    policyVersion: nonEmptyId,
    deliveryLatencyPolicyVersion: nonEmptyId,
    capacityContractVersion: nonEmptyId,
    poolMathAdapterVersions: z.array(nonEmptyId).min(1),
    executionScenarioVersions: z.array(nonEmptyId).min(1),
    artifactIds: z.array(nonEmptyId),
    holdoutExposureSnapshotId: nonEmptyId,
    codeAndDependencyHash: ExecSha256RefSchema,
    /**
     * FR-EXEC-010/AC-127: sha256 over the canonical frozen assumption set
     * (pre-registered scenario payloads, policy versions). Optional at the
     * boundary for manifests frozen before hash recording; a frozen replay
     * that carries one verifies assumption equality, not just version lists.
     */
    assumptionsHash: ExecSha256RefSchema.optional(),
  })
  .strict();
export type ReplayManifest = z.infer<typeof ReplayManifestSchema>;

// ---------------------------------------------------------------------------
// Uncertainty and observation plans (FR-EXEC-020 / §64.14 / FR-EXEC-011)
// ---------------------------------------------------------------------------

/** FR-EXEC-020: exposed uncertainty over the evaluated fill. */
export const UncertaintyBoundSchema = z
  .object({
    stateCompleteness: z.enum(['COMPLETE', 'INCOMPLETE_BLOCKING']),
    relativeUncertainty: z.number().finite().min(0).max(1),
    policyLimit: z.number().finite().min(0).max(1),
    qualityCodes: QualityCodesSchema,
  })
  .strict();
export type UncertaintyBound = z.infer<typeof UncertaintyBoundSchema>;

/**
 * §64.14 / FR-EXEC-011 finite selective outcome-observation plan. Sampled
 * plans store inclusion probability and population limits (FR-MAT-007);
 * insufficient resolution cannot prove tradable success.
 */
export const OutcomeObservationPlanSchema = z
  .object({
    planId: nonEmptyId,
    planVersion: nonEmptyId,
    candidateId: nonEmptyId,
    triggerClass: ObservationPlanTriggerClassSchema,
    cadenceSeconds: z.number().int().min(1),
    observedFields: z.array(nonEmptyId).min(1),
    providerSourceIds: z.array(nonEmptyId).min(1),
    durationSeconds: z.number().int().min(1),
    quotaCeiling: z.record(z.unknown()),
    degradationPolicyId: nonEmptyId,
    resolutionFloor: z.object({
      temporalSeconds: z.number().int().min(1),
      poolStateComplete: z.boolean(),
      liquidityDepthMinUsd: DecimalStringSchema,
    }),
    inclusionProbability: z.number().finite().min(0).max(1).nullable(),
    stratum: nonEmptyId.nullable(),
    populationLimit: nonEmptyId.nullable(),
    registeredAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.inclusionProbability === null ||
      (value.stratum !== null && value.populationLimit !== null),
    { message: 'sampled plans store inclusion probability with stratum and population limits' },
  );
export type OutcomeObservationPlan = z.infer<typeof OutcomeObservationPlanSchema>;

// ---------------------------------------------------------------------------
// Adapter registry and execution-state snapshots (§64.3 / §64.4)
// ---------------------------------------------------------------------------

/** §64.3 registry entry: versioned adapter keyed by chain/program/curve. */
export const AdapterRegistryEntrySchema = z
  .object({
    adapterId: nonEmptyId,
    version: nonEmptyId,
    chainId: ChainIdSchema,
    programId: nonEmptyId,
    supportedProgramVersions: z.array(nonEmptyId).min(1),
    curveTypes: z.array(nonEmptyId).min(1),
    family: AdapterFamilySchema,
    accountLayoutVersion: nonEmptyId,
    supportState: AdapterSupportStateSchema,
    parityGateVersion: nonEmptyId.nullable(),
    fixtureBundleHash: ExecSha256RefSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.supportState !== 'AVAILABLE' ||
      (value.parityGateVersion !== null && value.fixtureBundleHash !== null),
    { message: 'AVAILABLE requires passing parity-gate and fixture-bundle references (§64.3)' },
  )
  .refine(
    (value) =>
      value.family !== 'CONSTANT_PRODUCT_AMM' ||
      value.supportState !== 'AVAILABLE' ||
      value.curveTypes.length > 0,
    { message: 'a constant-product adapter must declare its verified curve types' },
  );
export type AdapterRegistryEntry = z.infer<typeof AdapterRegistryEntrySchema>;

/** §64.4 record: the exact state a simulation used (FR-EXEC-014). */
export const ExecutionStateSnapshotSchema = z
  .object({
    snapshotId: nonEmptyId,
    chainId: ChainIdSchema,
    programId: nonEmptyId,
    programVersion: nonEmptyId,
    slot: DigitStringSchema,
    blockHash: nonEmptyId,
    finality: z.enum(['PROCESSED', 'CONFIRMED', 'FINALIZED']),
    rawAccountStateHashes: z.array(ExecSha256RefSchema).min(1),
    reserveVaultState: z.record(z.unknown()),
    tickArrays: z.record(z.unknown()).nullable(),
    binArrays: z.record(z.unknown()).nullable(),
    positions: z.record(z.unknown()).nullable(),
    bondingCurveState: z.record(z.unknown()).nullable(),
    feeConfiguration: z.record(z.unknown()),
    dynamicFeeParameters: z.record(z.unknown()).nullable(),
    transferFeeSemantics: z.record(z.unknown()).nullable(),
    transferHookSemantics: z.record(z.unknown()).nullable(),
    defaultAccountState: z.record(z.unknown()).nullable(),
    quoteConversionSource: nonEmptyId,
    quoteConversionAt: UtcTimestampSchema,
    routeLegs: z.array(z.record(z.unknown())).min(1),
    sharedLiquidityIdentifiers: z.array(nonEmptyId),
    poolMathAdapterId: nonEmptyId,
    poolMathAdapterVersion: nonEmptyId,
    stateCompleteness: z.enum(['COMPLETE', 'INCOMPLETE_BLOCKING']),
    uncertaintyBound: UncertaintyBoundSchema,
    observedAt: UtcTimestampSchema,
  })
  .strict();
export type ExecutionStateSnapshot = z.infer<typeof ExecutionStateSnapshotSchema>;

/** Quote evidence: evidence, never execution truth (FR-EXEC-020). */
export const QuoteEvidenceSchema = z
  .object({
    quoteId: nonEmptyId,
    sourceId: nonEmptyId,
    sourceKind: z.enum(['OFFICIAL_PROGRAM_READ', 'INDEPENDENT_AGGREGATOR', 'OBSERVED_TRADE']),
    inTokenMint: nonEmptyId,
    outTokenMint: nonEmptyId,
    inAmount: DecimalStringSchema,
    outAmount: DecimalStringSchema,
    quoteAt: UtcTimestampSchema,
    observedAt: UtcTimestampSchema,
    routeLegs: z.array(z.record(z.unknown())).min(1),
    transactionPayloadRef: z.null(),
    qualityCodes: QualityCodesSchema.min(1),
  })
  .strict()
  .refine((value) => value.transactionPayloadRef === null, {
    message: 'quote providers cannot supply transaction-construction payloads (§64.5/INV-001)',
  });
export type QuoteEvidence = z.infer<typeof QuoteEvidenceSchema>;

// ---------------------------------------------------------------------------
// Stress results and pass matrix (§64.10 / FR-EXEC-017)
// ---------------------------------------------------------------------------

export const StressScenarioResultSchema = z
  .object({
    scenarioId: nonEmptyId,
    scenarioVersion: nonEmptyId,
    stressKind: StressScenarioKindSchema,
    status: ExecutionStatusSchema,
    netReturn: NetReturnBreakdownSchema,
    fillFraction: z.number().finite().min(0).max(1),
    passed: z.boolean(),
    assumptionsHash: ExecSha256RefSchema,
  })
  .strict();
export type StressScenarioResult = z.infer<typeof StressScenarioResultSchema>;

/** FR-EXEC-017/AC-235 pass matrix over the required stress scenarios. */
export const ScenarioPassMatrixSchema = z
  .object({
    matrixId: nonEmptyId,
    candidateId: nonEmptyId,
    outcomeProfileVersion: nonEmptyId,
    requiredKinds: z.array(StressScenarioKindSchema).min(1),
    results: z.array(StressScenarioResultSchema),
    conservativeStressPolicyId: nonEmptyId,
    evaluatedAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (value) => {
      const evaluated = new Set(value.results.map((r) => r.stressKind));
      return value.requiredKinds.every((kind) => evaluated.has(kind));
    },
    { message: 'every required stress kind must have a recorded result' },
  )
  .refine(
    (value) => {
      const passed = new Set(value.results.filter((r) => r.passed).map((r) => r.stressKind));
      return value.requiredKinds.every((kind) => passed.has(kind));
    },
    { message: 'active policy enforces its declared pass matrix — required kinds must pass' },
  );
export type ScenarioPassMatrix = z.infer<typeof ScenarioPassMatrixSchema>;

// ---------------------------------------------------------------------------
// Execution simulation record (§8.2 outcome classes on the payload layer)
// ---------------------------------------------------------------------------

/**
 * One execution simulation result. The refinement law enforces at the
 * payload layer: signal labels never render profit without TRADABLE_SUCCESS
 * (FR-EXEC-006), incomplete/unavailable state cannot confirm tradability
 * (§64.4/AC-232), and availability-order checks hold.
 */
export const ExecutionSimulationSchema = z
  .object({
    simulationId: nonEmptyId,
    candidateId: nonEmptyId,
    scenarioId: nonEmptyId,
    scenarioVersion: nonEmptyId,
    outcomeProfileVersion: nonEmptyId,
    entry: EntryFillResultSchema,
    exit: ExitFillResultSchema.nullable(),
    tradabilityVerdict: TradabilityVerdictSchema,
    tradableFailureReason: TradableFailureReasonSchema.nullable(),
    signalLabel: z.enum(['SIGNAL_SUCCESS', 'SIGNAL_FAILURE']).nullable(),
    tradableLabel: OutcomeClassSchema.nullable(),
    outcomeMaturity: OutcomeMaturitySchema,
    stateSnapshotId: nonEmptyId,
    replayManifestId: nonEmptyId,
    pathAmbiguity: z
      .object({
        primaryOrdering: PrimaryOrderingSchema,
        ambiguous: z.boolean(),
      })
      .strict(),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    qualityCodes: QualityCodesSchema.min(1),
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine(
    (value) =>
      value.tradableLabel === null ||
      [
        'TRADABLE_SUCCESS',
        'TRADABLE_FAILURE',
        'TRADABLE_NEUTRAL',
        'NEUTRAL',
        'PENDING',
        'CENSORED',
        'INVALID_DATA',
      ].includes(value.tradableLabel),
    { message: 'tradable label must come from the §8.2 tradable axis, never a signal label' },
  )
  .refine(
    (value) => value.tradableFailureReason === null || value.tradableLabel === 'TRADABLE_FAILURE',
    { message: 'a tradable failure reason requires the TRADABLE_FAILURE label' },
  )
  .refine(
    (value) =>
      value.tradableLabel !== 'TRADABLE_SUCCESS' || value.tradabilityVerdict === 'TRADABLE',
    { message: 'TRADABLE_SUCCESS requires the TRADABLE verdict' },
  )
  .refine((value) => Date.parse(value.availableAt) >= Date.parse(value.observedAt), {
    message: 'availableAt must not precede observedAt',
  })
  .refine(
    (value) =>
      // Incomplete state cannot confirm tradable success (§64.4/AC-232/INV-011).
      !(
        value.tradableLabel === 'TRADABLE_SUCCESS' &&
        (value.entry.status === 'EXECUTION_UNAVAILABLE' ||
          value.entry.status === 'POOL_MATH_UNSUPPORTED' ||
          value.entry.status === 'INSUFFICIENT_DATA')
      ),
    { message: 'incomplete/unavailable execution state cannot confirm TRADABLE_SUCCESS' },
  )
  .refine(
    (value) =>
      // Signal-cannot-render-profit at the payload layer (FR-EXEC-006): a
      // SIGNAL_SUCCESS without a confirmed TRADABLE_SUCCESS may not carry a
      // positive tradable net-return payload.
      !(
        value.signalLabel === 'SIGNAL_SUCCESS' &&
        value.tradableLabel !== 'TRADABLE_SUCCESS' &&
        !value.entry.netReturn.grossReturnUsd.startsWith('-') &&
        value.entry.netReturn.grossReturnUsd !== '0'
      ),
    {
      message: 'SIGNAL_SUCCESS cannot render profit when TRADABLE_SUCCESS is absent (FR-EXEC-006)',
    },
  );
export type ExecutionSimulation = z.infer<typeof ExecutionSimulationSchema>;

// ---------------------------------------------------------------------------
// Alert content and concurrent shadow aggregate (FR-EXEC-008 / FR-EXEC-019)
// ---------------------------------------------------------------------------

/** FR-EXEC-008: configured notional, delay, modeled impact, assumptions, expiry. */
export const AlertExecutionContentSchema = z
  .object({
    alertId: nonEmptyId,
    candidateId: nonEmptyId,
    configuredNotionalUsd: DecimalStringSchema,
    actionDelaySeconds: z.number().int().min(0),
    modeledEntryImpact: z.number().finite().min(0),
    modeledExitImpact: z.number().finite().min(0),
    assumptions: z.array(nonEmptyId).min(1),
    assumptionsHash: ExecSha256RefSchema,
    validUntil: UtcTimestampSchema,
    renderedAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => Date.parse(value.validUntil) > Date.parse(value.renderedAt), {
    message: 'alert expiry must be after render time',
  });
export type AlertExecutionContent = z.infer<typeof AlertExecutionContentSchema>;

/** FR-EXEC-019: concurrent shadow positions sharing a pool/route aggregate. */
export const ConcurrentShadowAggregateSchema = z
  .object({
    aggregateId: nonEmptyId,
    poolId: nonEmptyId,
    routeId: nonEmptyId.nullable(),
    sharedLiquidityIdentifiers: z.array(nonEmptyId),
    concurrentExitCount: z.number().int().min(1),
    preExitDepthUsd: DecimalStringSchema,
    aggregatedRequestedExitsUsd: DecimalStringSchema,
    aggregatedFillFraction: z.number().finite().min(0).max(1),
    rejectedExitCount: z.number().int().min(0),
  })
  .strict()
  .refine(
    (value) => {
      const requested = value.aggregatedRequestedExitsUsd.split('.')[0] ?? '0';
      const depth = value.preExitDepthUsd.split('.')[0] ?? '0';
      return BigInt(requested) <= BigInt(depth) || value.aggregatedFillFraction < 1;
    },
    { message: 'aggregate impact and fill competition reduce or reject fills deterministically' },
  );
export type ConcurrentShadowAggregate = z.infer<typeof ConcurrentShadowAggregateSchema>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EXEC_SCHEMAS = {
  ExecutionScenario: ExecutionScenarioSchema,
  ExitPolicyExperiment: ExitPolicyExperimentSchema,
  NetReturnBreakdown: NetReturnBreakdownSchema,
  EntryFillResult: EntryFillResultSchema,
  ExitFillResult: ExitFillResultSchema,
  ReplayManifest: ReplayManifestSchema,
  UncertaintyBound: UncertaintyBoundSchema,
  OutcomeObservationPlan: OutcomeObservationPlanSchema,
  AdapterRegistryEntry: AdapterRegistryEntrySchema,
  ExecutionStateSnapshot: ExecutionStateSnapshotSchema,
  QuoteEvidence: QuoteEvidenceSchema,
  StressScenarioResult: StressScenarioResultSchema,
  ScenarioPassMatrix: ScenarioPassMatrixSchema,
  ExecutionSimulation: ExecutionSimulationSchema,
  AlertExecutionContent: AlertExecutionContentSchema,
  ConcurrentShadowAggregate: ConcurrentShadowAggregateSchema,
} as const;

export function parseExecSchema<T extends keyof typeof EXEC_SCHEMAS>(
  name: T,
  payload: unknown,
): z.infer<(typeof EXEC_SCHEMAS)[T]> {
  return EXEC_SCHEMAS[name].parse(payload) as z.infer<(typeof EXEC_SCHEMAS)[T]>;
}
