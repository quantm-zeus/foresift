/** Runtime schemas for outcome maturity and promotion evidence (FR-MAT-001…012). */
import { z } from 'zod';
import {
  ALL_CENSOR_REASONS,
  ALL_EVIDENCE_RESOLUTIONS,
  ALL_EXPIRY_SIDE_EFFECTS,
  ALL_INVALID_DATA_REASONS,
  ALL_MAT_HORIZONS,
  ALL_MAT_PRIMARY_ORDERINGS,
  ALL_MATURITY_STATES,
  ALL_PROMOTION_OUTCOME_LABELS,
  ALL_SUBJECTIVE_LABEL_FAMILIES,
} from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

export const MAT_SCHEMA_REGISTRY_VERSION = 1 as const;

const id = z.string().min(1);
const jsonObject = z.record(z.unknown());
const evidenceRefs = z.array(id);
const unsignedDecimal = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const signedDecimal = z.string().regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const domainEnum = <T extends string>(values: readonly [T, ...T[]] | readonly T[]) =>
  z.enum([...values] as [T, ...T[]]);

const MaturityStateSchema = domainEnum(ALL_MATURITY_STATES);
const HorizonSchema = domainEnum(ALL_MAT_HORIZONS);

export const OutcomeMaturityStateSchema = z
  .object({
    maturityStateId: id,
    candidateId: id,
    outcomeProfileId: id,
    outcomeProfileVersion: id,
    horizon: HorizonSchema,
    scenarioId: id,
    scenarioVersion: id,
    maturityState: MaturityStateSchema,
    censorReason: domainEnum(ALL_CENSOR_REASONS).nullable(),
    invalidReason: domainEnum(ALL_INVALID_DATA_REASONS).nullable(),
    maturedAt: UtcTimestampSchema.nullable(),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    evidenceRefs,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const censored = value.maturityState === 'CENSORED';
    const invalid = value.maturityState === 'INVALID_DATA';
    if (censored !== (value.censorReason !== null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['censorReason'],
        message: 'censor reason is required exactly for CENSORED outcomes',
      });
    if (invalid !== (value.invalidReason !== null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['invalidReason'],
        message: 'invalid reason is required exactly for INVALID_DATA outcomes',
      });
    const terminal = ['FULLY_MATURED', 'CENSORED', 'INVALID_DATA'].includes(value.maturityState);
    if (terminal !== (value.maturedAt !== null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maturedAt'],
        message: 'terminal maturity states require a maturity timestamp',
      });
    if (Date.parse(value.availableAt) < Date.parse(value.observedAt))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availableAt'],
        message: 'availability cannot precede observation',
      });
  });

export const MaturityTransitionSchema = z
  .object({
    transitionId: id,
    maturityStateId: id,
    fromState: MaturityStateSchema,
    toState: MaturityStateSchema,
    reason: id,
    evidenceRefs,
    transitionedAt: UtcTimestampSchema,
    recordedAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      (value.fromState === 'PENDING' &&
        ['PARTIALLY_MATURED', 'FULLY_MATURED', 'CENSORED', 'INVALID_DATA'].includes(
          value.toState,
        )) ||
      (value.fromState === 'PARTIALLY_MATURED' &&
        ['FULLY_MATURED', 'CENSORED', 'INVALID_DATA'].includes(value.toState)),
    { message: 'maturity transition must be monotone' },
  );

export const DenominatorDisclosureSchema = z
  .object({
    disclosureId: id,
    evaluationRunId: id,
    outcomeProfileId: id,
    outcomeProfileVersion: id,
    horizon: HorizonSchema,
    observationCollectionScope: id,
    reportScope: id,
    eligibleCount: z.number().int().nonnegative(),
    fullyMaturedValidCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    partiallyMaturedCount: z.number().int().nonnegative(),
    censoredCount: z.number().int().nonnegative(),
    invalidDataCount: z.number().int().nonnegative(),
    lowResolutionCount: z.number().int().nonnegative(),
    rightsBlockedCount: z.number().int().nonnegative(),
    unobservedCount: z.number().int().nonnegative(),
    disclosedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.fullyMaturedValidCount +
        value.pendingCount +
        value.partiallyMaturedCount +
        value.censoredCount +
        value.invalidDataCount +
        value.lowResolutionCount +
        value.rightsBlockedCount +
        value.unobservedCount <=
      value.eligibleCount,
    { message: 'disclosed denominator classes cannot exceed eligible count' },
  );

export const SubjectiveUtilityRecordSchema = z
  .object({
    subjectiveUtilityId: id,
    subjectId: id,
    candidateId: id,
    labelFamily: domainEnum(ALL_SUBJECTIVE_LABEL_FAMILIES),
    utilityLabel: id,
    utilityValue: signedDecimal.nullable(),
    rationale: z.string().nullable(),
    recordedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict();

export const OutcomeSamplingStratumSchema = z
  .object({
    stratumId: id,
    samplingPlanId: id,
    dimensions: jsonObject,
    eligibleCount: z.number().int().nonnegative(),
    targetSampleCount: z.number().int().nonnegative(),
    registeredAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => value.targetSampleCount <= value.eligibleCount, {
    message: 'target sample count cannot exceed eligible count',
  });

export const OutcomeSamplingAssignmentSchema = z
  .object({
    assignmentId: id,
    samplingPlanId: id,
    candidateId: id,
    stratumId: id,
    inclusionProbability: z.number().finite().positive().max(1),
    selected: z.boolean(),
    selectionTime: UtcTimestampSchema,
    selectionReason: id,
    seedProvenance: id.refine(
      (value) => !value.startsWith('raw:'),
      'raw seed material is forbidden',
    ),
    createdAt: UtcTimestampSchema,
  })
  .strict();

export const PromotionEvidenceRecordSchema = z
  .object({
    promotionEvidenceId: id,
    candidateId: id,
    outcomeProfileId: id,
    outcomeProfileVersion: id,
    scenarioId: id,
    scenarioVersion: id,
    outcomeLabel: domainEnum(ALL_PROMOTION_OUTCOME_LABELS),
    outcomeMaturity: MaturityStateSchema,
    evidenceResolution: domainEnum(ALL_EVIDENCE_RESOLUTIONS),
    requiredNotional: unsignedDecimal,
    requiredDelayPolicyId: id,
    requiredAdapterVersion: id,
    requiredRouteId: id,
    requiredExitPolicyId: id,
    exactConfigurationMatch: z.boolean(),
    productionPromotionEligible: z.boolean(),
    primaryOrdering: domainEnum(ALL_MAT_PRIMARY_ORDERINGS),
    pathAmbiguous: z.boolean(),
    optimisticSensitivity: jsonObject.nullable(),
    expirySideEffect: domainEnum(ALL_EXPIRY_SIDE_EFFECTS).nullable(),
    expirySideEffectAt: UtcTimestampSchema.nullable(),
    gainObservedAt: UtcTimestampSchema.nullable(),
    postExpiryGainExcluded: z.boolean(),
    capacityLimited: z.boolean(),
    maximumExecutableNotional: unsignedDecimal.nullable(),
    totalDeployablePortfolioCapacity: unsignedDecimal.nullable(),
    largerCapitalSimulationRef: id.nullable(),
    evidenceRefs,
    recordedAt: UtcTimestampSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.productionPromotionEligible &&
      !(
        value.outcomeLabel === 'TRADABLE_SUCCESS' &&
        value.outcomeMaturity === 'FULLY_MATURED' &&
        value.evidenceResolution !== 'COARSE_SIGNAL' &&
        value.exactConfigurationMatch
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['productionPromotionEligible'],
        message: 'promotion requires fully matured exact tradable-success evidence',
      });
    if (value.pathAmbiguous && value.primaryOrdering !== 'ADVERSE_FEASIBLE')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryOrdering'],
        message: 'ambiguous paths require adverse feasible ordering',
      });
    if (
      value.optimisticSensitivity !== null &&
      !(value.pathAmbiguous && value.primaryOrdering === 'ADVERSE_FEASIBLE')
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['optimisticSensitivity'],
        message: 'optimistic sensitivity is secondary to an adverse ambiguous primary',
      });
    if ((value.expirySideEffect === null) !== (value.expirySideEffectAt === null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expirySideEffectAt'],
        message: 'expiry side effect and timestamp must be paired',
      });
    if (
      value.gainObservedAt !== null &&
      value.expirySideEffectAt !== null &&
      Date.parse(value.gainObservedAt) > Date.parse(value.expirySideEffectAt) &&
      !value.postExpiryGainExcluded
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['postExpiryGainExcluded'],
        message: 'post-expiry gains must be excluded',
      });
    if (
      (value.maximumExecutableNotional === null) !==
        (value.totalDeployablePortfolioCapacity === null) ||
      (value.capacityLimited && value.maximumExecutableNotional === null)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maximumExecutableNotional'],
        message: 'capacity-limited evidence requires paired capacity disclosure',
      });
  });

export type OutcomeMaturityState = z.infer<typeof OutcomeMaturityStateSchema>;
export type MaturityTransition = z.infer<typeof MaturityTransitionSchema>;
export type DenominatorDisclosure = z.infer<typeof DenominatorDisclosureSchema>;
export type SubjectiveUtilityRecord = z.infer<typeof SubjectiveUtilityRecordSchema>;
export type OutcomeSamplingStratum = z.infer<typeof OutcomeSamplingStratumSchema>;
export type OutcomeSamplingAssignment = z.infer<typeof OutcomeSamplingAssignmentSchema>;
export type PromotionEvidenceRecord = z.infer<typeof PromotionEvidenceRecordSchema>;
