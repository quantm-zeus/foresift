/** Runtime schemas for frozen evaluation and statistical integrity (FR-EVAL-001…009). */
import { z } from 'zod';
import {
  ALL_BASELINE_KINDS,
  ALL_CLAIM_RESTRICTIONS,
  ALL_CLUSTER_DEFINITIONS,
  ALL_COVERAGE_POPULATION_CLASSES,
  ALL_DRIFT_CONTROL_KINDS,
  ALL_DRIFT_RESPONSES,
  ALL_ESTIMATOR_KINDS,
  ALL_EVALUATION_INCIDENT_TRIGGERS,
  ALL_EVALUATION_METRIC_KINDS,
  ALL_EVALUATION_PARTITIONS,
  ALL_EVALUATION_REPLAY_KINDS,
  ALL_HOLDOUT_EXPOSURES,
  ALL_INTERVAL_METHODS,
  ALL_MATURITY_SCOPES,
  ALL_MISS_CLASSIFICATIONS,
  ALL_MULTIPLE_TESTING_FAMILIES,
  ALL_NEGATIVE_CONTROL_KINDS,
  ALL_SELECTION_DIAGNOSTIC_KINDS,
} from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

export const EVAL_SCHEMA_REGISTRY_VERSION = 1 as const;

const id = z.string().min(1);
const jsonObject = z.record(z.unknown());
const jsonArray = z.array(z.unknown());
const signedDecimal = z.string().regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const unsignedDecimal = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const contentAddress = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const domainEnum = <T extends string>(values: readonly [T, ...T[]] | readonly T[]) =>
  z.enum([...values] as [T, ...T[]]);

export const OutcomeProfileSchema = z
  .object({
    profileId: id,
    version: id,
    humanName: id,
    researchOnlyDisclosure: id,
    populationScope: domainEnum(ALL_COVERAGE_POPULATION_CLASSES),
    inclusionMechanism: jsonObject,
    eligibility: jsonObject,
    signalSuccess: jsonObject,
    tradableSuccess: jsonObject,
    tradableFailure: jsonObject,
    neutral: z.union([jsonObject, z.string()]),
    censoringPolicy: jsonObject,
    invalidDataPolicy: jsonObject,
    horizons: z.array(id).min(1),
    maturityPolicy: jsonObject,
    observationResolutionPolicy: jsonObject,
    riskSurvivalConstraints: jsonObject,
    requiredCapabilities: z.array(id),
    requiredEvidenceFamilies: z.array(id),
    executionScenarioMatrix: jsonObject,
    owner: id,
    approvalArtifactRef: id,
    rollbackTarget: id,
    createdAt: UtcTimestampSchema,
    activatedAt: UtcTimestampSchema.nullable(),
    deprecatedAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.activatedAt === null || Date.parse(value.activatedAt) >= Date.parse(value.createdAt),
    { message: 'activation cannot precede creation' },
  )
  .refine(
    (value) =>
      value.deprecatedAt === null ||
      Date.parse(value.deprecatedAt) >= Date.parse(value.activatedAt ?? value.createdAt),
    { message: 'deprecation cannot precede activation' },
  );

export const EvaluationDatasetSchema = z
  .object({
    datasetId: id,
    version: id,
    partition: domainEnum(ALL_EVALUATION_PARTITIONS),
    holdoutExposure: domainEnum(ALL_HOLDOUT_EXPOSURES),
    frozen: z.boolean(),
    populationScope: domainEnum(ALL_COVERAGE_POPULATION_CLASSES),
    candidateUniverseHash: contentAddress,
    universeManifestRef: id,
    observationStart: UtcTimestampSchema,
    observationEnd: UtcTimestampSchema,
    embargoStart: UtcTimestampSchema.nullable(),
    embargoEnd: UtcTimestampSchema.nullable(),
    leakageGroupKeys: z.array(id).min(1),
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.observationEnd) <= Date.parse(value.observationStart))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['observationEnd'],
        message: 'observation window must be ordered',
      });
    if (
      (value.embargoStart === null) !== (value.embargoEnd === null) ||
      (value.embargoStart !== null &&
        Date.parse(value.embargoEnd!) <= Date.parse(value.embargoStart))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['embargoEnd'],
        message: 'embargo timestamps must be paired and ordered',
      });
    if (
      value.partition === 'FINAL_HOLDOUT' &&
      !(value.frozen && value.holdoutExposure === 'UNEXPOSED')
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['partition'],
        message: 'final holdout must be frozen and unexposed',
      });
  });

export const EvaluationExperimentSchema = z
  .object({
    experimentId: id,
    hypothesis: id,
    primaryMetric: id,
    hardConstraints: jsonObject,
    candidatePopulation: jsonObject,
    profileScope: z.union([jsonObject, jsonArray]),
    regimeScope: z.union([jsonObject, jsonArray]),
    executionScope: z.union([jsonObject, jsonArray]),
    championVersion: id,
    challengerVersion: id,
    preprocessingFeatures: jsonObject,
    sampleSizePowerTarget: jsonObject,
    clusterDefinition: id,
    multipleTestingFamily: domainEnum(ALL_MULTIPLE_TESTING_FAMILIES),
    statisticalMethod: id,
    stoppingRule: jsonObject,
    confirmatory: z.boolean(),
    registeredAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => Date.parse(value.registeredAt) <= Date.parse(value.createdAt), {
    message: 'experiment must be pre-registered',
  });

/** PRD §31.5 exact frozen replay-manifest field set. */
export const EvaluationRunSchema = z
  .object({
    replayId: id,
    asOf: UtcTimestampSchema,
    datasetVersion: id,
    populationClaim: id,
    candidateUniverseHash: contentAddress,
    observationCutoff: UtcTimestampSchema,
    collectorCoverageManifestId: id,
    providerDependenceVersion: id,
    featureVersion: id,
    rankingVersion: id,
    workflowVersion: id,
    promptVersion: id,
    toolProfileVersion: id,
    modelProfileVersion: id,
    outcomeProfileVersion: id,
    policyVersion: id,
    deliveryLatencyPolicyVersion: id,
    capacityContractVersion: id,
    poolMathAdapterVersions: z.array(id),
    executionScenarioVersions: z.array(id),
    artifactIds: z.array(id),
    holdoutExposureSnapshotId: id,
    codeAndDependencyHash: contentAddress,
  })
  .strict()
  .refine((value) => Date.parse(value.observationCutoff) <= Date.parse(value.asOf), {
    message: 'observation cutoff cannot exceed replay as-of time',
  });

export const EvaluationMetricResultSchema = z
  .object({
    metricResultId: id,
    evaluationRunId: id,
    metricKind: domainEnum(ALL_EVALUATION_METRIC_KINDS),
    metricValue: signedDecimal,
    lowerBound: signedDecimal.nullable(),
    upperBound: signedDecimal.nullable(),
    maturityScope: domainEnum(ALL_MATURITY_SCOPES),
    finalResult: z.boolean(),
    denominatorDisclosureRef: id,
    computedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => (value.lowerBound === null) === (value.upperBound === null), {
    message: 'interval bounds must be paired',
  })
  .refine(
    (value) => value.lowerBound === null || Number(value.lowerBound) <= Number(value.upperBound),
    { message: 'lower interval bound cannot exceed upper bound' },
  )
  .refine((value) => !value.finalResult || value.maturityScope === 'FINAL_FULLY_MATURED', {
    message: 'final results require fully matured outcomes',
  });

export const ClusteredIntervalRunSchema = z
  .object({
    intervalRunId: id,
    evaluationRunId: id,
    metricKind: id,
    intervalMethod: domainEnum(ALL_INTERVAL_METHODS),
    clusterDefinition: domainEnum(ALL_CLUSTER_DEFINITIONS),
    naiveSampleSize: z.number().int().nonnegative(),
    clusterCount: z.number().int().nonnegative(),
    effectiveIndependentSampleSize: z.number().finite().nonnegative(),
    minimumEffectiveSampleSize: z.number().finite().positive(),
    essGatePassed: z.boolean(),
    promotionEligible: z.boolean(),
    pointEstimate: signedDecimal,
    lowerBound: signedDecimal,
    upperBound: signedDecimal,
    alternateClusterSensitivity: jsonObject,
    computedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!(
      Number(value.lowerBound) <= Number(value.pointEstimate) &&
      Number(value.pointEstimate) <= Number(value.upperBound)
    ))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pointEstimate'],
        message: 'point estimate must lie within its interval',
      });
    if (value.effectiveIndependentSampleSize > value.naiveSampleSize)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveIndependentSampleSize'],
        message: 'effective sample size cannot exceed naive sample size',
      });
    const passed = value.effectiveIndependentSampleSize >= value.minimumEffectiveSampleSize;
    if (value.essGatePassed !== passed || (!passed && value.promotionEligible))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['essGatePassed'],
        message: 'ESS truth must gate promotion',
      });
  });

export const NegativeControlRunSchema = z
  .object({
    controlRunId: id,
    evaluationRunId: id,
    controlKind: domainEnum(ALL_NEGATIVE_CONTROL_KINDS),
    seedProvenance: id.refine(
      (value) => !value.startsWith('raw:'),
      'raw seed material is forbidden',
    ),
    observedLift: signedDecimal,
    materialLiftThreshold: unsignedDecimal,
    unexpectedMaterialLift: z.boolean(),
    promotionBlocked: z.boolean(),
    incidentId: id.nullable(),
    executedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const unexpected = Math.abs(Number(value.observedLift)) > Number(value.materialLiftThreshold);
    if (value.unexpectedMaterialLift !== unexpected)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unexpectedMaterialLift'],
        message: 'material-lift flag must match the registered threshold',
      });
    if (unexpected && (value.incidentId === null || !value.promotionBlocked))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['incidentId'],
        message: 'unexpected lift requires an incident and blocks promotion',
      });
  });

export const EvaluationIncidentSchema = z
  .object({
    incidentId: id,
    evaluationRunId: id,
    incidentTrigger: domainEnum(ALL_EVALUATION_INCIDENT_TRIGGERS),
    affectedScope: jsonObject,
    influencePaused: z.literal(true),
    openedAt: UtcTimestampSchema,
    resolvedAt: UtcTimestampSchema.nullable(),
    resolutionRef: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      (value.resolvedAt === null) === (value.resolutionRef === null) &&
      (value.resolvedAt === null || Date.parse(value.resolvedAt) >= Date.parse(value.openedAt)),
    { message: 'incident resolution must be paired and ordered' },
  );

export const BaselineResultSchema = z
  .object({
    baselineResultId: id,
    evaluationRunId: id,
    baselineKind: domainEnum(ALL_BASELINE_KINDS),
    baselineVersion: id,
    metricKind: id,
    metricValue: signedDecimal,
    candidateUniverseHash: contentAddress,
    comparatorUniverseHash: contentAddress,
    dataCutoff: UtcTimestampSchema,
    actionTimePolicyVersion: id,
    executionScenarioVersion: id,
    capitalBudget: unsignedDecimal,
    strongestEligible: z.boolean(),
    computedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => value.candidateUniverseHash === value.comparatorUniverseHash, {
    message: 'baseline and comparator candidate universes must match',
  });

export const MissedOpportunitySchema = z
  .object({
    missedOpportunityId: id,
    evaluationRunId: id,
    candidateId: id,
    outcomeProfileId: id,
    outcomeProfileVersion: id,
    declaredPopulationBoundary: id,
    existedInDiscoveryCoverage: z.boolean(),
    firstSource: id.nullable(),
    firstSourceObservedAt: UtcTimestampSchema.nullable(),
    firstSystemAvailableAt: UtcTimestampSchema.nullable(),
    funnelExit: id,
    evidenceAcquisitionExit: id.nullable(),
    missClassification: domainEnum(ALL_MISS_CLASSIFICATIONS),
    delayDecomposition: jsonObject,
    counterfactualActionTime: UtcTimestampSchema,
    frozenEvidenceRefs: z.array(id),
    frozenVersionRefs: jsonObject,
    nextEvaluationDatasetId: id,
    nextEvaluationDatasetVersion: id,
    analyzedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => (value.firstSource === null) === (value.firstSourceObservedAt === null), {
    message: 'first source and observation time must be paired',
  });

export const ChampionChallengerComparisonSchema = z
  .object({
    comparisonId: id,
    evaluationRunId: id,
    championVersion: id,
    challengerVersion: id,
    candidateUniverseHash: contentAddress,
    frozenAvailabilityBoundary: UtcTimestampSchema,
    championBudget: unsignedDecimal,
    challengerBudget: unsignedDecimal,
    budgetsEqualized: z.literal(true),
    externalSideEffectCount: z.literal(0),
    hardConstraintsPassed: z.boolean(),
    primaryUtilityGatePassed: z.boolean(),
    deterministicStackResultRef: id,
    modelRemovedResultRef: id.nullable(),
    comparedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => Number(value.championBudget) === Number(value.challengerBudget), {
    message: 'champion and challenger budgets must be equalized',
  });

export const DriftCalibrationControlSchema = z
  .object({
    controlId: id,
    evaluationRunId: id,
    controlKind: domainEnum(ALL_DRIFT_CONTROL_KINDS),
    scope: jsonObject,
    referenceDatasetRef: id,
    observedValue: signedDecimal,
    thresholdValue: signedDecimal,
    driftDetected: z.boolean(),
    response: domainEnum(ALL_DRIFT_RESPONSES),
    influenceDegraded: z.boolean(),
    measuredAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => !value.driftDetected || value.influenceDegraded, {
    message: 'detected drift must degrade influence',
  });

export const SelectionBiasDiagnosticSchema = z
  .object({
    diagnosticId: id,
    evaluationRunId: id,
    diagnosticKind: domainEnum(ALL_SELECTION_DIAGNOSTIC_KINDS),
    estimatorKind: domainEnum(ALL_ESTIMATOR_KINDS),
    diagnostics: jsonObject,
    maximumWeight: z.number().finite().positive().max(20).nullable(),
    diagnosticsValid: z.boolean(),
    claimRestriction: domainEnum(ALL_CLAIM_RESTRICTIONS),
    populationClaim: id,
    computedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const weighted = ['DESIGN_WEIGHTED', 'PROPENSITY_WEIGHTED', 'DOUBLY_ROBUST'].includes(
      value.estimatorKind,
    );
    if (weighted && (!value.diagnosticsValid || value.maximumWeight === null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diagnostics'],
        message: 'weighting requires valid diagnostics and a bounded maximum weight',
      });
    if (!value.diagnosticsValid && value.claimRestriction === 'DECLARED_UNIVERSE')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimRestriction'],
        message: 'invalid diagnostics require an observed-subset-only claim',
      });
    if (
      value.estimatorKind === 'OBSERVED_SUBSET_ONLY' &&
      value.claimRestriction !== 'RESTRICT_TO_OBSERVED_SUBSET'
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimRestriction'],
        message: 'observed-subset estimator cannot make a broader claim',
      });
  });

export type OutcomeProfile = z.infer<typeof OutcomeProfileSchema>;
export type EvaluationDataset = z.infer<typeof EvaluationDatasetSchema>;
export type EvaluationExperiment = z.infer<typeof EvaluationExperimentSchema>;
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;
export type EvaluationMetricResult = z.infer<typeof EvaluationMetricResultSchema>;
export type ClusteredIntervalRun = z.infer<typeof ClusteredIntervalRunSchema>;
export type NegativeControlRun = z.infer<typeof NegativeControlRunSchema>;
export type EvaluationIncident = z.infer<typeof EvaluationIncidentSchema>;
export type BaselineResult = z.infer<typeof BaselineResultSchema>;
export type MissedOpportunity = z.infer<typeof MissedOpportunitySchema>;
export type ChampionChallengerComparison = z.infer<typeof ChampionChallengerComparisonSchema>;
export type DriftCalibrationControl = z.infer<typeof DriftCalibrationControlSchema>;
export type SelectionBiasDiagnostic = z.infer<typeof SelectionBiasDiagnosticSchema>;
