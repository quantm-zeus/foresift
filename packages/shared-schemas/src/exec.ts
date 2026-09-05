/**
 * Runtime boundary schemas for the execution-aware outcome, pool math, and
 * tradability engine (§64, §8.1/§8.2, FR-EXEC-001…022).
 *
 * Closed vocabularies live in `@foresift/domain` and are imported, never
 * restated (compile-parity law of shared-schemas). The few exec-local
 * literals below (route coverage, depeg state, sharing-key kinds) are kept
 * in parity with SQL truth by tests. Unknown keys are rejected (`.strict()`)
 * — fail-closed extends to record shape. Numeric policy: quantities, prices,
 * and USD values cross boundaries as decimal STRINGS (never JS numbers);
 * timestamps are ISO-8601 UTC strings ending in `Z`; content hashes are
 * `sha256:<64 lowercase hex>`.
 *
 * Payload-layer laws: profit may only be rendered on `TRADABLE_SUCCESS`
 * (FR-EXEC-006/INV-011) and an `INCOMPLETE_BLOCKING` state snapshot can never
 * confirm tradability (FR-EXEC-020/AC-232).
 */
import { z } from 'zod';
import {
  AdapterFamily,
  AdapterSupportState,
  ExecutionStatus,
  ExitPolicyKind,
  ObservationPlanTriggerClass,
  OutcomeClass,
  OutcomeMaturity,
  SIGNAL_AXIS_OUTCOME_CLASSES,
  StateCompleteness,
  StressScenarioKind,
  TradabilityVerdict,
  type AdapterFamily as AdapterFamilyType,
  type AdapterSupportState as AdapterSupportStateType,
  type ExecutionStatus as ExecutionStatusType,
  type ExitPolicyKind as ExitPolicyKindType,
  type ObservationPlanTriggerClass as ObservationPlanTriggerClassType,
  type OutcomeClass as OutcomeClassType,
  type OutcomeMaturity as OutcomeMaturityType,
  type StateCompleteness as StateCompletenessType,
  type StressScenarioKind as StressScenarioKindType,
  type TradabilityVerdict as TradabilityVerdictType,
} from '@foresift/domain';
import {
  ChainIdSchema,
  DecimalStringSchema,
  DigitStringSchema,
  QualityCodesSchema,
  UtcTimestampSchema,
} from './data.ts';
import { Sha256RefSchema } from './solsec.ts';

export const EXEC_SCHEMA_REGISTRY_VERSION = 1;

const nonEmptyId = z.string().min(1);

/** Signed exact decimal per the §11.5 quantity policy (negative net legs). */
export const SignedDecimalStringSchema = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/, 'expected canonical signed decimal string')
  .refine((v) => !/^-0(\.0+)?$/.test(v), { message: 'negative zero is not a canonical decimal' });

const outcomeClassValues = [...Object.values(OutcomeClass)] as [
  OutcomeClassType,
  ...OutcomeClassType[],
];
const signalClassValues = [...SIGNAL_AXIS_OUTCOME_CLASSES] as [
  OutcomeClassType,
  ...OutcomeClassType[],
];
const maturityValues = [...Object.values(OutcomeMaturity)] as [
  OutcomeMaturityType,
  ...OutcomeMaturityType[],
];
const adapterFamilyValues = [...Object.values(AdapterFamily)] as [
  AdapterFamilyType,
  ...AdapterFamilyType[],
];
const supportStateValues = [...Object.values(AdapterSupportState)] as [
  AdapterSupportStateType,
  ...AdapterSupportStateType[],
];
const executionStatusValues = [...Object.values(ExecutionStatus)] as [
  ExecutionStatusType,
  ...ExecutionStatusType[],
];
const stressKindValues = [...Object.values(StressScenarioKind)] as [
  StressScenarioKindType,
  ...StressScenarioKindType[],
];
const exitPolicyValues = [...Object.values(ExitPolicyKind)] as [
  ExitPolicyKindType,
  ...ExitPolicyKindType[],
];
const verdictValues = [...Object.values(TradabilityVerdict)] as [
  TradabilityVerdictType,
  ...TradabilityVerdictType[],
];
const triggerClassValues = [...Object.values(ObservationPlanTriggerClass)] as [
  ObservationPlanTriggerClassType,
  ...ObservationPlanTriggerClassType[],
];
const completenessValues = [...Object.values(StateCompleteness)] as [
  StateCompletenessType,
  ...StateCompletenessType[],
];

export const OutcomeClassSchema = z.enum(outcomeClassValues);
export const SignalAxisOutcomeClassSchema = z.enum(signalClassValues);
export const OutcomeMaturitySchema = z.enum(maturityValues);
export const AdapterFamilySchema = z.enum(adapterFamilyValues);
export const AdapterSupportStateSchema = z.enum(supportStateValues);
export const ExecutionStatusSchema = z.enum(executionStatusValues);
export const StressScenarioKindSchema = z.enum(stressKindValues);
export const ExitPolicyKindSchema = z.enum(exitPolicyValues);
export const TradabilityVerdictSchema = z.enum(verdictValues);
export const ObservationPlanTriggerClassSchema = z.enum(triggerClassValues);
export const ExecStateCompletenessSchema = z.enum(completenessValues);

// ---------------------------------------------------------------------------
// §64.2 ExecutionScenario (exact field set)
// ---------------------------------------------------------------------------

/** §64.2 scenario-coverage requirement (PRD literal). */
export const PoolAdapterCoverageSchema = z.enum(['COMPLETE', 'BOUNDED_APPROXIMATION']);

export const ExecutionScenarioSchema = z
  .object({
    scenarioId: nonEmptyId,
    version: nonEmptyId,
    notionalUsd: DecimalStringSchema,
    deterministicActionDelaySeconds: z.number().int().min(0),
    empiricalActionDelayPolicyId: nonEmptyId.optional(),
    entryPolicyVersionId: nonEmptyId,
    exitPolicyVersionId: nonEmptyId,
    maximumEntryImpact: z.number().finite().min(0).max(1),
    maximumExitImpact: z.number().finite().min(0).max(1),
    allowPartialFill: z.boolean(),
    minimumFillFraction: z.number().finite().min(0).max(1),
    maximumFillDurationSeconds: z.number().int().min(0),
    feePolicyVersionId: nonEmptyId,
    conservativeStressPolicyId: nonEmptyId,
    requiredPoolAdapterCoverage: PoolAdapterCoverageSchema,
    registeredAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine((v) => !v.allowPartialFill || v.minimumFillFraction > 0, {
    message: 'partial fills require a positive minimum fill fraction',
  });
export type ExecutionScenario = z.infer<typeof ExecutionScenarioSchema>;

// ---------------------------------------------------------------------------
// FR-EXEC-009 pre-registered exit-policy experiments
// ---------------------------------------------------------------------------

export const ExitPolicyExperimentSchema = z
  .object({
    experimentId: nonEmptyId,
    scenarioId: nonEmptyId,
    exitPolicyVersionId: nonEmptyId,
    exitPolicyKind: ExitPolicyKindSchema,
    isPrimary: z.boolean(),
    preRegisteredAt: UtcTimestampSchema,
    registeredBeforeAnyOutcome: z.boolean(),
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine((v) => v.registeredBeforeAnyOutcome, {
    message: 'exit-policy experiments must be pre-registered before any outcome (FR-EXEC-009)',
  });
export type ExitPolicyExperiment = z.infer<typeof ExitPolicyExperimentSchema>;

// ---------------------------------------------------------------------------
// Entry/exit fills (§64.6/§64.7)
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
    startAt: UtcTimestampSchema,
    completedAt: UtcTimestampSchema,
    executionStatus: ExecutionStatusSchema,
    qualityCodes: QualityCodesSchema.min(1),
  })
  .strict()
  .refine((v) => Date.parse(v.completedAt) >= Date.parse(v.startAt), {
    message: 'completedAt must not precede startAt',
  })
  .refine((v) => v.executionStatus !== ExecutionStatus.EXECUTED_FULL || v.fillFraction === 1, {
    message: 'EXECUTED_FULL requires fill fraction 1',
  });
export type EntryFillResult = z.infer<typeof EntryFillResultSchema>;

export const ExitFillResultSchema = z
  .object({
    exitPolicyVersionId: nonEmptyId,
    exitPolicyKind: ExitPolicyKindSchema,
    requestedQuantity: DecimalStringSchema,
    filledQuantity: DecimalStringSchema,
    fillFraction: z.number().finite().min(0).max(1),
    averageExecutionPrice: DecimalStringSchema,
    averagePriceImpact: z.number().finite().min(0),
    failedAmount: DecimalStringSchema,
    residualInventory: DecimalStringSchema,
    triggerAt: UtcTimestampSchema,
    completedAt: UtcTimestampSchema,
    executionStatus: ExecutionStatusSchema,
    qualityCodes: QualityCodesSchema.min(1),
  })
  .strict()
  .refine((v) => Date.parse(v.completedAt) >= Date.parse(v.triggerAt), {
    message: 'completion time is separate from and not before trigger time (§64.7)',
  });
export type ExitFillResult = z.infer<typeof ExitFillResultSchema>;

// ---------------------------------------------------------------------------
// Net return breakdown (FR-EXEC-003/018, §64.9)
// ---------------------------------------------------------------------------

export const NetReturnBreakdownSchema = z
  .object({
    grossEntryUsd: SignedDecimalStringSchema,
    grossExitUsd: SignedDecimalStringSchema,
    poolFeesUsd: SignedDecimalStringSchema,
    aggregatorFeesUsd: SignedDecimalStringSchema,
    tokenTransferFeesUsd: SignedDecimalStringSchema,
    priorityNetworkFeesUsd: SignedDecimalStringSchema,
    executionImpactUsd: SignedDecimalStringSchema,
    failedAttemptsUsd: SignedDecimalStringSchema,
    partialFillShortfallUsd: SignedDecimalStringSchema,
    residualInventoryUsd: SignedDecimalStringSchema,
    adverseSelectionMevBufferUsd: SignedDecimalStringSchema,
    quoteConversionDepegUsd: SignedDecimalStringSchema,
    accountCreationRentUsd: SignedDecimalStringSchema,
    netReturnUsd: SignedDecimalStringSchema,
  })
  .strict();
export type NetReturnBreakdown = z.infer<typeof NetReturnBreakdownSchema>;

// ---------------------------------------------------------------------------
// Uncertainty (FR-EXEC-020, §64.15)
// ---------------------------------------------------------------------------

export const UncertaintyBoundSchema = z
  .object({
    bound: DecimalStringSchema,
    policyLimit: DecimalStringSchema,
    stateCoverage: DecimalStringSchema,
    contributors: z.array(nonEmptyId).min(1),
  })
  .strict()
  .refine((v) => Number(v.bound) >= 0 && Number(v.bound) <= 1, {
    message: 'uncertainty bound must lie in [0,1]',
  })
  .refine((v) => Number(v.policyLimit) >= 0 && Number(v.policyLimit) <= 1, {
    message: 'policy limit must lie in [0,1]',
  })
  .refine((v) => Number(v.stateCoverage) >= 0 && Number(v.stateCoverage) <= 1, {
    message: 'state coverage must lie in [0,1]',
  });
export type UncertaintyBound = z.infer<typeof UncertaintyBoundSchema>;

// ---------------------------------------------------------------------------
// Execution simulation (§64.12 outcome classes + §8.1 maturity)
// ---------------------------------------------------------------------------

export const ExecutionSimulationSchema = z
  .object({
    simulationId: nonEmptyId,
    scenarioId: nonEmptyId,
    candidateId: nonEmptyId,
    outcomeClass: OutcomeClassSchema,
    outcomeMaturity: OutcomeMaturitySchema,
    censorReason: z.string().min(1).nullable(),
    invalidReason: z.string().min(1).nullable(),
    signalClass: SignalAxisOutcomeClassSchema,
    tradabilityVerdict: TradabilityVerdictSchema,
    executionStatus: ExecutionStatusSchema,
    stateCompleteness: ExecStateCompletenessSchema,
    uncertainty: UncertaintyBoundSchema,
    netReturn: NetReturnBreakdownSchema.nullable(),
    entryFill: EntryFillResultSchema.nullable(),
    exitFill: ExitFillResultSchema.nullable(),
    profitRendered: z.boolean(),
    qualityCodes: QualityCodesSchema.min(1),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine((v) => Date.parse(v.availableAt) >= Date.parse(v.observedAt), {
    message: 'availableAt must not precede observedAt',
  })
  // AC-124: censored and invalid outcomes retain explicit reasons.
  .refine((v) => v.outcomeClass !== OutcomeClass.CENSORED || v.censorReason !== null, {
    message: 'CENSORED requires an explicit censor reason',
  })
  .refine((v) => v.outcomeClass !== OutcomeClass.INVALID_DATA || v.invalidReason !== null, {
    message: 'INVALID_DATA requires an explicit invalid reason',
  })
  // FR-EXEC-006/INV-011 at the payload layer: profit may only be rendered
  // when the tradable axis confirmed TRADABLE_SUCCESS.
  .refine((v) => !v.profitRendered || v.outcomeClass === OutcomeClass.TRADABLE_SUCCESS, {
    message: 'profit rendering requires TRADABLE_SUCCESS (FR-EXEC-006)',
  })
  // FR-EXEC-020/AC-232 at the payload layer: incomplete state can never
  // confirm tradability.
  .refine(
    (v) =>
      !(
        v.stateCompleteness === StateCompleteness.INCOMPLETE_BLOCKING &&
        v.tradabilityVerdict === TradabilityVerdict.CONFIRMED_TRADABLE
      ),
    { message: 'INCOMPLETE_BLOCKING state cannot confirm tradability' },
  )
  .refine(
    (v) =>
      !(
        v.outcomeMaturity === OutcomeMaturity.CENSORED ||
        v.outcomeMaturity === OutcomeMaturity.INVALID_DATA
      ) ||
      v.outcomeClass === OutcomeClass.CENSORED ||
      v.outcomeClass === OutcomeClass.INVALID_DATA,
    { message: 'censored/invalid maturity requires the matching outcome class' },
  );
export type ExecutionSimulation = z.infer<typeof ExecutionSimulationSchema>;

// ---------------------------------------------------------------------------
// Replay manifests (FR-EXEC-010)
// ---------------------------------------------------------------------------

export const ReplayManifestSchema = z
  .object({
    manifestId: nonEmptyId,
    scenarioId: nonEmptyId,
    scenarioPayload: z.record(z.unknown()),
    assumptionsHash: Sha256RefSchema,
    adapterVersions: z.array(z.object({ adapterId: nonEmptyId, version: nonEmptyId }).strict()),
    codeVersions: z.record(z.string().min(1)),
    policyVersions: z.record(z.string().min(1)),
    frozenAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict();
export type ReplayManifest = z.infer<typeof ReplayManifestSchema>;

// ---------------------------------------------------------------------------
// Observation plans (§64.14, FR-EXEC-011)
// ---------------------------------------------------------------------------

export const OutcomeObservationPlanSchema = z
  .object({
    planId: nonEmptyId,
    candidateId: nonEmptyId,
    triggerClass: ObservationPlanTriggerClassSchema,
    cadenceSeconds: z.number().int().min(1),
    observedFields: z.array(nonEmptyId).min(1),
    observedAccounts: z.array(nonEmptyId),
    providerSourceIds: z.array(nonEmptyId).min(1),
    durationSeconds: z.number().int().min(1),
    quotaCeiling: z.number().int().min(1),
    degradationPolicyId: nonEmptyId,
    inclusionProbability: DecimalStringSchema,
    stratum: nonEmptyId,
    populationLimit: z.number().int().min(1),
    resolutionFloorSeconds: z.number().int().min(1),
    issuedAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine((v) => Number(v.inclusionProbability) >= 0 && Number(v.inclusionProbability) <= 1, {
    message: 'inclusion probability must lie in [0,1]',
  });
export type OutcomeObservationPlan = z.infer<typeof OutcomeObservationPlanSchema>;

// ---------------------------------------------------------------------------
// Adapter registry (FR-EXEC-013/015) and state snapshots (FR-EXEC-014)
// ---------------------------------------------------------------------------

export const AdapterRegistryEntrySchema = z
  .object({
    entryId: nonEmptyId,
    adapterId: nonEmptyId,
    version: nonEmptyId,
    chainId: ChainIdSchema,
    programId: nonEmptyId,
    programVersion: nonEmptyId,
    accountLayoutVersion: nonEmptyId,
    curveType: nonEmptyId,
    family: AdapterFamilySchema,
    supportState: AdapterSupportStateSchema,
    registeredAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine(
    (v) =>
      !(v.family === AdapterFamily.CONSTANT_PRODUCT_AMM && v.supportState === 'AVAILABLE') ||
      v.curveType.length > 0,
    { message: 'constant-product availability requires a verified curve type' },
  );
export type AdapterRegistryEntry = z.infer<typeof AdapterRegistryEntrySchema>;

export const ExecutionStateSnapshotSchema = z
  .object({
    snapshotId: nonEmptyId,
    simulationId: nonEmptyId,
    programId: nonEmptyId,
    programVersion: nonEmptyId,
    poolMathAdapterId: nonEmptyId,
    poolMathAdapterVersion: nonEmptyId,
    slot: DigitStringSchema,
    blockHash: Sha256RefSchema.nullable(),
    finality: nonEmptyId,
    rawAccountStateHashes: z.array(Sha256RefSchema).min(1),
    reserveVaultState: z.record(z.unknown()),
    tickBinCurveState: z.record(z.unknown()).nullable(),
    feeParameters: z.record(z.unknown()),
    transferSemanticsState: z.record(z.unknown()),
    quoteConversionSource: nonEmptyId,
    quoteObservedAt: UtcTimestampSchema,
    routeLegIds: z.array(nonEmptyId),
    sharedLiquidityIds: z.array(nonEmptyId),
    stateCompleteness: ExecStateCompletenessSchema,
    uncertaintyBound: DecimalStringSchema,
    capturedAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine((v) => Number(v.uncertaintyBound) >= 0 && Number(v.uncertaintyBound) <= 1, {
    message: 'uncertainty bound must lie in [0,1]',
  });
export type ExecutionStateSnapshot = z.infer<typeof ExecutionStateSnapshotSchema>;

// ---------------------------------------------------------------------------
// Quote evidence (FR-EXEC-005/020 — evidence, not execution truth)
// ---------------------------------------------------------------------------

/** Quote-evidence payload classes. Transaction construction is structurally
 * refused: a record carrying a construction attempt can only exist in the
 * REFUSED state, and no serialized payload field exists to store it in. */
export const QuotePayloadKindSchema = z.enum([
  'QUOTE_ONLY',
  'TRANSACTION_CONSTRUCTION_ATTEMPT_REFUSED',
]);

export const QuoteEvidenceSchema = z
  .object({
    quoteId: nonEmptyId,
    simulationId: nonEmptyId,
    sourceId: nonEmptyId,
    providerPayloadKind: QuotePayloadKindSchema,
    quotePayloadHash: Sha256RefSchema,
    convertedQuoteUsd: DecimalStringSchema.nullable(),
    depegState: z.enum([
      'NONE_EVIDENCED',
      'WITHIN_TOLERANCE',
      'DEPEG_DETECTED',
      'UNABLE_TO_VERIFY',
    ]),
    transactionConstructionRefused: z.boolean(),
    uncertaintyBound: DecimalStringSchema,
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine((v) => Date.parse(v.availableAt) >= Date.parse(v.observedAt), {
    message: 'availableAt must not precede observedAt',
  })
  .refine(
    (v) =>
      v.providerPayloadKind !== 'TRANSACTION_CONSTRUCTION_ATTEMPT_REFUSED' ||
      v.transactionConstructionRefused,
    { message: 'a transaction-construction payload is only recordable as refused (FR-EXEC-005)' },
  )
  .refine((v) => Number(v.uncertaintyBound) >= 0 && Number(v.uncertaintyBound) <= 1, {
    message: 'uncertainty bound must lie in [0,1]',
  });
export type QuoteEvidence = z.infer<typeof QuoteEvidenceSchema>;

// ---------------------------------------------------------------------------
// Stress results and pass matrix (FR-EXEC-012/017, §64.10)
// ---------------------------------------------------------------------------

export const StressScenarioResultSchema = z
  .object({
    resultId: nonEmptyId,
    simulationId: nonEmptyId,
    scenarioKind: StressScenarioKindSchema,
    passed: z.boolean(),
    netReturnUsd: SignedDecimalStringSchema.nullable(),
    fillFraction: z.number().finite().min(0).max(1),
    assumptionsHash: Sha256RefSchema,
    evaluatedAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict();
export type StressScenarioResult = z.infer<typeof StressScenarioResultSchema>;

export const ScenarioPassMatrixSchema = z
  .object({
    matrixId: nonEmptyId,
    simulationId: nonEmptyId,
    requiredScenarioKinds: z.array(StressScenarioKindSchema).min(1),
    results: z.array(StressScenarioResultSchema).min(1),
    conservativeDefault: z.boolean(),
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine(
    (v) => {
      const kinds = new Set(v.results.map((r) => r.scenarioKind));
      return v.requiredScenarioKinds.every((k) => kinds.has(k));
    },
    { message: 'every required scenario kind must have a recorded result (FR-EXEC-017)' },
  )
  .refine(
    (v) => !v.conservativeDefault || v.requiredScenarioKinds.includes(StressScenarioKind.BASE_CASE),
    { message: 'conservative default must include BASE_CASE' },
  );
export type ScenarioPassMatrix = z.infer<typeof ScenarioPassMatrixSchema>;

// ---------------------------------------------------------------------------
// Alert execution content (FR-EXEC-008, §64.15)
// ---------------------------------------------------------------------------

export const AlertExecutionContentSchema = z
  .object({
    alertId: nonEmptyId,
    candidateId: nonEmptyId,
    scenarioId: nonEmptyId,
    configuredNotionalUsd: DecimalStringSchema,
    actionDelaySeconds: z.number().int().min(0),
    modeledImpactUsd: SignedDecimalStringSchema,
    assumptions: z.array(z.string().min(1)).min(1),
    signalClass: SignalAxisOutcomeClassSchema,
    tradableClass: OutcomeClassSchema,
    profitRendered: z.boolean(),
    validUntil: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine((v) => !v.profitRendered || v.tradableClass === OutcomeClass.TRADABLE_SUCCESS, {
    message: 'profit rendering requires TRADABLE_SUCCESS (FR-EXEC-006)',
  });
export type AlertExecutionContent = z.infer<typeof AlertExecutionContentSchema>;

// ---------------------------------------------------------------------------
// Concurrent shadow aggregation (FR-EXEC-019)
// ---------------------------------------------------------------------------

/** Sharing keys: pool, route, quote asset, liquidity source, deployer
 * cluster, correlated exit window (§64.9/FR-EXEC-019 literal set). */
export const ShadowSharingKeyKindSchema = z.enum([
  'POOL',
  'ROUTE',
  'QUOTE_ASSET',
  'LIQUIDITY_SOURCE',
  'DEPLOYER_CLUSTER',
  'CORRELATED_EXIT_WINDOW',
]);

export const ConcurrentShadowAggregateSchema = z
  .object({
    aggregateId: nonEmptyId,
    sharingKeyKind: ShadowSharingKeyKindSchema,
    sharingKeyValue: nonEmptyId,
    positionIds: z.array(nonEmptyId).min(2),
    aggregateImpactUsd: SignedDecimalStringSchema,
    aggregateFillFraction: z.number().finite().min(0).max(1),
    /** Deterministic fill-competition order (lexicographic registration id). */
    resolutionOrder: z.array(nonEmptyId).min(2),
    aggregatedAt: UtcTimestampSchema,
    schemaRegistryVersion: z.literal(EXEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine(
    (v) =>
      v.resolutionOrder.length === v.positionIds.length &&
      [...v.resolutionOrder].sort().join(' ') === [...v.positionIds].sort().join(' '),
    { message: 'resolution order must be a permutation of the aggregated positions' },
  )
  .refine((v) => v.resolutionOrder.every((id, i) => i === 0 || id >= v.resolutionOrder[i - 1]!), {
    message: 'resolution order must be lexicographic for deterministic competition',
  });
export type ConcurrentShadowAggregate = z.infer<typeof ConcurrentShadowAggregateSchema>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EXEC_SCHEMAS = {
  ExecutionScenario: ExecutionScenarioSchema,
  ExitPolicyExperiment: ExitPolicyExperimentSchema,
  EntryFillResult: EntryFillResultSchema,
  ExitFillResult: ExitFillResultSchema,
  NetReturnBreakdown: NetReturnBreakdownSchema,
  UncertaintyBound: UncertaintyBoundSchema,
  ExecutionSimulation: ExecutionSimulationSchema,
  ReplayManifest: ReplayManifestSchema,
  OutcomeObservationPlan: OutcomeObservationPlanSchema,
  AdapterRegistryEntry: AdapterRegistryEntrySchema,
  ExecutionStateSnapshot: ExecutionStateSnapshotSchema,
  QuoteEvidence: QuoteEvidenceSchema,
  StressScenarioResult: StressScenarioResultSchema,
  ScenarioPassMatrix: ScenarioPassMatrixSchema,
  AlertExecutionContent: AlertExecutionContentSchema,
  ConcurrentShadowAggregate: ConcurrentShadowAggregateSchema,
} as const;

export function parseExecSchema<T extends keyof typeof EXEC_SCHEMAS>(
  name: T,
  payload: unknown,
): z.infer<(typeof EXEC_SCHEMAS)[T]> {
  return EXEC_SCHEMAS[name].parse(payload) as z.infer<(typeof EXEC_SCHEMAS)[T]>;
}
