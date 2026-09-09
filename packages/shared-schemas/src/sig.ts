import { z } from 'zod';
import { ALL_QUALITY_CODES, ALL_RESERVE_CLASSES, ALL_TRADABILITY_VERDICTS } from '@foresift/domain';

import { DecimalStringSchema, UtcTimestampSchema } from './data.ts';

export const SIG_SCHEMA_REGISTRY_VERSION = 1 as const;

const NonEmptyString = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const QualityCodeSchema = z.enum([...ALL_QUALITY_CODES] as [string, ...string[]]);
const QualityCodesSchema = z.array(QualityCodeSchema).min(1);
const ReserveClassSchema = z.enum([...ALL_RESERVE_CLASSES] as [string, ...string[]]);
const TradabilityVerdictSchema = z.enum([...ALL_TRADABILITY_VERDICTS] as [string, ...string[]]);

// These mirrors consume the closed domain vocabulary once packages/domain/src/sig.ts
// is present. They remain isolated here so unknown values always fail closed.
export const FunnelStageSchema = z.enum([
  'FREE_DISCOVERY_UNIVERSE_ATTRIBUTION',
  'IDENTITY_VALIDATION',
  'CAPABILITY_DATA_QUALITY_GATE',
  'ELIGIBILITY_GATES',
  'ZERO_COST_COARSE_GATE',
  'CHEAP_BATCH_MONITORING_PERSISTENCE_GATE',
  'SELECTIVE_FREE_QUOTA_SECURITY_ONCHAIN_VERIFICATION',
  'ECONOMIC_TRADE_NORMALIZATION_DETERMINISTIC_SECURITY',
  'FEATURE_UPDATE',
  'REGIME_ROUTE_RESOLUTION',
  'NARRATIVE_CROSS_CHAIN_CONTEXT',
  'VECTOR_CONSTRUCTION',
  'CROWDING_OPPORTUNITY_DECAY_PRECHECK',
  'PARETO_FILTERING',
  'RESEARCH_PRIORITY_RANKING',
  'DIVERSITY_SELECTION',
  'AGENT_RESEARCH',
  'THESIS_CREATION_UPDATE_WHY_NOW',
  'EVIDENCE_VALIDATION_ROBUSTNESS_CHECKS',
  'EXECUTION_TRADABILITY_OUTCOME_PROFILE_GATE',
  'ALERT_POLICY',
]);
export const VectorKindSchema = z.enum([
  'OPPORTUNITY',
  'RISK',
  'DATA_QUALITY',
  'URGENCY',
  'NOVELTY',
  'TRADABILITY',
  'SOURCE_INDEPENDENCE',
]);
export const ParetoStatusSchema = z.enum(['EFFICIENT', 'DOMINATED', 'UNKNOWN_DIMENSION_BLOCKED']);
export const SelectionArmSchema = z.enum([
  'EXPLOITATION',
  'UNCERTAINTY',
  'RANDOM_EXPLORATION',
  'EVIDENCE_PROBE',
  'OUTCOME_OBSERVATION_ONLY',
  'NOT_SELECTED',
]);
export const CutoffReasonSchema = z.enum([
  'BELOW_BUDGET_CUTOFF',
  'HARD_GATE_FAILED',
  'PARETO_DOMINATED',
  'DIVERSITY_CONSTRAINT',
  'EXPLORATION_ARM',
  'NOT_SELECTED_WITH_REASON',
]);
export const CohortFallbackLevelSchema = z.enum([
  'EXACT_COHORT',
  'REMOVE_NARRATIVE',
  'REMOVE_REGIME',
  'WIDEN_MARKET_CAP_BAND',
  'WIDEN_AGE_BAND',
  'CHAIN_LAUNCHPAD',
  'OWN_HISTORY_ANOMALY',
]);
export const LifecycleStateSchema = z.enum([
  'DISCOVERED',
  'QUALIFIED',
  'EMERGING',
  'CONFIRMED',
  'MONITORING',
  'DECAYING',
  'REJECTED',
  'ARCHIVED',
]);
export const RecheckDecisionKindSchema = z.enum([
  'RECHECK_NOW',
  'DEFER_BACKOFF',
  'STARVED_SKIP',
  'EXPIRED_STOP',
  'BUDGET_EXHAUSTED_STOP',
  'INFO_VALUE_BELOW_FLOOR_SKIP',
]);

/** §19.1 exact signal-registry definition plus FR-SIG-009. */
export const FeatureDefinitionSchema = z
  .object({
    featureId: NonEmptyString,
    version: z.number().int().positive(),
    description: NonEmptyString,
    formula: NonEmptyString,
    inputFields: z.array(NonEmptyString).min(1),
    unit: NonEmptyString,
    windows: z.array(NonEmptyString),
    minimumObservations: z.number().int().positive(),
    nullPolicy: NonEmptyString,
    outlierPolicy: NonEmptyString,
    updatePolicy: NonEmptyString,
    freshnessLimitSeconds: z.number().int().nonnegative(),
    cohortDefinitionId: NonEmptyString.nullable(),
    evidenceRequirements: z.array(NonEmptyString),
    isNumeric: z.boolean(),
    minimumDenominator: z.number().int().positive().nullable(),
    stabilityTransform: NonEmptyString.nullable(),
    shrinkagePolicy: NonEmptyString.nullable(),
    cappedContribution: DecimalStringSchema.nullable(),
    outlierPolicyIsRobust: z.boolean(),
    cohortFallbackPolicyId: NonEmptyString.nullable(),
    economicEventRequired: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.isNumeric) return;
    const missing: string[] = [];
    if (value.minimumDenominator === null) missing.push('minimumDenominator');
    if (value.stabilityTransform === null) missing.push('stabilityTransform');
    if (value.shrinkagePolicy === null) missing.push('shrinkagePolicy');
    if (value.cappedContribution === null) missing.push('cappedContribution');
    if (value.cohortFallbackPolicyId === null) missing.push('cohortFallbackPolicyId');
    if (!value.outlierPolicyIsRobust) missing.push('outlierPolicyIsRobust');
    for (const field of missing) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: 'numeric feature stability field is required',
      });
    }
    // Capped contribution is a (0,1] cap on the feature's ranking weight
    // (PRD FR-SIG-009): a value above one is not a cap and must fail closed.
    if (
      value.cappedContribution !== null &&
      !(Number(value.cappedContribution) > 0 && Number(value.cappedContribution) <= 1)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cappedContribution'],
        message: 'cappedContribution must lie in (0,1]',
      });
  });
export type SigFeatureDefinition = z.infer<typeof FeatureDefinitionSchema>;

export const FeatureLineageSchema = z
  .object({
    lineageId: NonEmptyString,
    definitionId: NonEmptyString,
    definitionVersion: z.number().int().positive(),
    entityId: NonEmptyString,
    profileId: NonEmptyString,
    eventStart: UtcTimestampSchema.nullable(),
    eventEnd: UtcTimestampSchema,
    windowStart: UtcTimestampSchema.nullable(),
    windowEnd: UtcTimestampSchema,
    inputObservationIds: z.array(NonEmptyString),
    inputEvidenceIds: z.array(NonEmptyString),
    inputHashes: z.array(Sha256Schema).min(1),
    calculationCodeVersion: NonEmptyString,
    calculatedAt: UtcTimestampSchema,
    qualityCodes: QualityCodesSchema,
  })
  .strict()
  .refine((value) => value.inputObservationIds.length + value.inputEvidenceIds.length > 0, {
    message: 'lineage requires an observation or evidence id',
  })
  .refine(
    (value) =>
      value.eventStart === null || Date.parse(value.eventStart) < Date.parse(value.eventEnd),
    {
      message: 'eventStart must precede eventEnd',
    },
  )
  .refine(
    (value) =>
      value.windowStart === null || Date.parse(value.windowStart) < Date.parse(value.windowEnd),
    {
      message: 'windowStart must precede windowEnd',
    },
  );
export type FeatureLineage = z.infer<typeof FeatureLineageSchema>;

export const CohortSnapshotSchema = z
  .object({
    snapshotId: NonEmptyString,
    definitionId: NonEmptyString,
    definitionVersion: z.number().int().positive(),
    entityId: NonEmptyString,
    fallbackLevel: CohortFallbackLevelSchema,
    cohortSize: z.number().int().nonnegative(),
    effectiveSampleSize: DecimalStringSchema,
    peerPercentile: DecimalStringSchema.nullable(),
    lowSampleWarning: z.boolean(),
    computedAt: UtcTimestampSchema,
  })
  .strict()
  // A percentile is a (0,1] fraction; out-of-range payloads are malformed and
  // must fail closed (PRD §20 peer percentile).
  .refine((value) => value.peerPercentile === null || Number(value.peerPercentile) <= 1, {
    message: 'peerPercentile must lie in (0,1]',
  });
export type CohortSnapshot = z.infer<typeof CohortSnapshotSchema>;

export const FunnelStageRecordSchema = z
  .object({
    stageId: NonEmptyString,
    candidateId: NonEmptyString,
    profileId: NonEmptyString,
    profileVersion: NonEmptyString,
    stage: FunnelStageSchema,
    enteredAt: UtcTimestampSchema,
    passed: z.boolean(),
    gateCode: NonEmptyString.nullable(),
    gateProfileVersion: NonEmptyString,
    evidenceRefs: z.array(NonEmptyString),
  })
  .strict()
  .refine((value) => value.passed || value.gateCode !== null, {
    path: ['gateCode'],
    message: 'failed gate must be reason-coded',
  });
export type FunnelStageRecord = z.infer<typeof FunnelStageRecordSchema>;

export const CandidateVectorComponentSchema = z
  .object({ value: DecimalStringSchema.nullable(), qualityCodes: QualityCodesSchema })
  .strict()
  .refine((value) => value.value !== null || value.qualityCodes.some((code) => code !== 'VALID'), {
    message: 'unknown vector component requires an explicit non-VALID quality code',
  });

export const CandidateVectorRecordSchema = z
  .object({
    vectorId: NonEmptyString,
    candidateId: NonEmptyString,
    profileVersion: NonEmptyString,
    asOf: UtcTimestampSchema,
    vectorKind: VectorKindSchema,
    components: z.record(NonEmptyString, CandidateVectorComponentSchema),
    algorithmVersion: NonEmptyString,
    lineageRef: NonEmptyString,
  })
  .strict()
  .refine((value) => Object.keys(value.components).length > 0, {
    path: ['components'],
    message: 'vector components may not be silently absent',
  });
export type CandidateVectorRecord = z.infer<typeof CandidateVectorRecordSchema>;

const SelectionProbabilitySchema = DecimalStringSchema.refine(
  (value) => Number(value) > 0 && Number(value) <= 1,
  'selection probability must lie in (0,1]',
);

export const RankingAuditSchema = z
  .object({
    auditId: NonEmptyString,
    candidateId: NonEmptyString,
    eligibleUniverse: z.array(NonEmptyString),
    rankAtTime: z.number().int().positive(),
    rankingVersion: NonEmptyString,
    profileVersion: NonEmptyString,
    componentValues: z.record(NonEmptyString, CandidateVectorComponentSchema),
    hardGateResults: z.record(NonEmptyString, z.boolean()),
    sourceDependence: z.record(NonEmptyString, z.unknown()),
    adapterScenarioResults: z.record(NonEmptyString, z.unknown()),
    paretoStatus: ParetoStatusSchema,
    diversityAdjustment: z.record(NonEmptyString, z.unknown()),
    explorationSelected: z.boolean(),
    cutoffReason: CutoffReasonSchema,
    selectionArm: SelectionArmSchema,
    selectionProbability: SelectionProbabilitySchema.nullable(),
    protectedAllocations: z.record(ReserveClassSchema, DecimalStringSchema),
    capacityAdmission: z.record(NonEmptyString, z.unknown()),
    algorithmVersion: NonEmptyString,
    tDecisionReady: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const randomized =
      value.selectionArm === 'RANDOM_EXPLORATION' || value.selectionArm === 'EVIDENCE_PROBE';
    if ((randomized || value.explorationSelected) && value.selectionProbability === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectionProbability'],
        message: 'randomized assignments require nonzero probability',
      });
    }
    const hasUnknown = Object.values(value.componentValues).some(
      (component) => component.value === null,
    );
    if (hasUnknown && value.paretoStatus === 'EFFICIENT') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paretoStatus'],
        message: 'unknown dimensions cannot establish favorable dominance',
      });
    }
  });
export type RankingAudit = z.infer<typeof RankingAuditSchema>;

export const SelectionDecisionSchema = z
  .object({
    candidateId: NonEmptyString,
    eligibilityUniverse: NonEmptyString,
    stratum: NonEmptyString.nullable(),
    policyVersion: NonEmptyString,
    selectionArm: SelectionArmSchema,
    selectionProbability: SelectionProbabilitySchema.nullable(),
    seedProvenance: NonEmptyString.nullable(),
    inclusionTimestamp: UtcTimestampSchema,
    notSelectedWithReason: NonEmptyString.nullable(),
    autoAlerted: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const randomized =
      value.selectionArm === 'RANDOM_EXPLORATION' || value.selectionArm === 'EVIDENCE_PROBE';
    if (
      randomized &&
      (value.selectionProbability === null ||
        value.stratum === null ||
        value.seedProvenance === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'randomized assignment requires probability, stratum, and seed provenance',
      });
    }
    if (value.selectionArm === 'OUTCOME_OBSERVATION_ONLY' && value.autoAlerted) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['autoAlerted'],
        message: 'outcome-only cases are never auto-alerted',
      });
    }
  });
export type SelectionDecision = z.infer<typeof SelectionDecisionSchema>;

export const LifecycleTransitionSchema = z
  .object({
    transitionId: NonEmptyString,
    candidateId: NonEmptyString,
    profileVersion: NonEmptyString,
    fromState: LifecycleStateSchema.nullable(),
    toState: LifecycleStateSchema,
    reason: NonEmptyString,
    persistenceMeasure: DecimalStringSchema.nullable(),
    dwellSeconds: z.number().int().nonnegative().nullable(),
    policyVersion: NonEmptyString,
    tradabilityVerdict: TradabilityVerdictSchema.nullable(),
    diagnosticSignalLabels: z.array(NonEmptyString),
    thesisInvalidationConditions: z.array(NonEmptyString).nullable(),
    transitionedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fromState === value.toState)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toState'],
        message: 'lifecycle transition must change state',
      });
    if (value.toState === 'CONFIRMED' && value.tradabilityVerdict !== 'TRADABLE') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tradabilityVerdict'],
        message: 'CONFIRMED requires TRADABLE',
      });
    }
    if (
      (value.toState === 'CONFIRMED' || value.toState === 'MONITORING') &&
      (!value.thesisInvalidationConditions || value.thesisInvalidationConditions.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thesisInvalidationConditions'],
        message: 'confirmed/monitored candidates require invalidation conditions',
      });
    }
  });
export type LifecycleTransition = z.infer<typeof LifecycleTransitionSchema>;

/** §21.2 exact seven configured fields. */
export const RecheckBudgetSchema = z
  .object({
    max_rechecks: z.number().int().nonnegative(),
    max_recheck_provider_calls: z.number().int().nonnegative(),
    max_recheck_model_cost: DecimalStringSchema,
    next_check_at: UtcTimestampSchema,
    expires_at: UtcTimestampSchema,
    backoff_factor: DecimalStringSchema.refine(
      (value) => Number(value) > 1,
      'backoff_factor must exceed one',
    ),
    minimum_expected_information_gain: DecimalStringSchema,
  })
  .strict()
  .refine((value) => Date.parse(value.expires_at) > Date.parse(value.next_check_at), {
    message: 'expires_at must follow next_check_at',
  });
export type RecheckBudget = z.infer<typeof RecheckBudgetSchema>;

export const RecheckDecisionSchema = z
  .object({
    decisionId: NonEmptyString,
    candidateId: NonEmptyString,
    profileVersion: NonEmptyString,
    decidedAt: UtcTimestampSchema,
    decision: RecheckDecisionKindSchema,
    reason: NonEmptyString,
    informationValue: DecimalStringSchema.nullable(),
    providerCallsCosted: z.number().int().nonnegative(),
    modelCostCosted: DecimalStringSchema,
    protectedReserveClass: ReserveClassSchema.nullable(),
  })
  .strict();
export type RecheckDecision = z.infer<typeof RecheckDecisionSchema>;

export const SigSchemaRegistry = Object.freeze({
  FeatureDefinition: FeatureDefinitionSchema,
  FeatureLineage: FeatureLineageSchema,
  CohortSnapshot: CohortSnapshotSchema,
  FunnelStageRecord: FunnelStageRecordSchema,
  CandidateVectorRecord: CandidateVectorRecordSchema,
  RankingAudit: RankingAuditSchema,
  SelectionDecision: SelectionDecisionSchema,
  LifecycleTransition: LifecycleTransitionSchema,
  RecheckBudget: RecheckBudgetSchema,
  RecheckDecision: RecheckDecisionSchema,
});

export type SigSchemaName = keyof typeof SigSchemaRegistry;
export function parseSigSchema<T extends SigSchemaName>(
  name: T,
  input: unknown,
): z.infer<(typeof SigSchemaRegistry)[T]> {
  return SigSchemaRegistry[name].parse(input);
}
