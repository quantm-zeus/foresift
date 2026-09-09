import { z } from 'zod';
import {
  ALL_DISC_CHAIN_ACCESS_PURPOSES,
  ALL_DISC_CLAIM_BASES,
  ALL_DISC_CONSTRAINT_EFFECTS,
  ALL_DISC_CONSTRAINT_KINDS,
  ALL_DISC_ENTRY_REASONS,
  ALL_DISC_LATENESS_BASES,
  ALL_DISC_MANIPULATION_POLICIES,
  ALL_DISC_RECALL_VERDICTS,
  ALL_DISC_RIGHTS_BASES,
} from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

export const DISC_SCHEMA_REGISTRY_VERSION = 1 as const;
const NonEmptyString = z.string().trim().min(1);
const ContentAddressSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const enumSchema = <T extends string>(values: readonly T[]) => z.enum([...values] as [T, ...T[]]);
export const DiscoverySourceClassSchema = z.enum([
  'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
  'FREE_AGGREGATE_DISCOVERY',
  'AUTHORIZED_LAUNCH_FEED',
  'USER_WATCHLIST_OR_MCP',
  'AUTHORIZED_SOCIAL_AGGREGATE',
  'SELECTIVE_CHAIN_VERIFICATION',
  'RETROSPECTIVE_UNIVERSE_ENUMERATION',
  'STRATIFIED_UNIVERSE_SAMPLE',
]);
export const DiscoveryUniverseEntrySchema = z
  .object({
    assetRepresentationId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceClass: DiscoverySourceClassSchema,
    sourceObservedAt: UtcTimestampSchema.optional(),
    sourcePublishedAt: UtcTimestampSchema.optional(),
    sourceAvailableAt: UtcTimestampSchema,
    firstFetchedAt: UtcTimestampSchema.optional(),
    firstReceivedAt: UtcTimestampSchema.optional(),
    firstIngestedAt: UtcTimestampSchema,
    chainCoordinates: z.string().min(1).optional(),
    sourceRank: z.number().int().nonnegative().optional(),
    sourceMetadataHash: ContentAddressSchema,
    discoveryPolicyVersion: z.string().min(1),
    collectorCoverageManifestId: z.string().min(1).optional(),
    qualityCodes: z.array(z.string().min(1)),
  })
  .strict()
  .refine((v) => Date.parse(v.firstIngestedAt) >= Date.parse(v.sourceAvailableAt), {
    message: 'firstIngestedAt cannot precede sourceAvailableAt',
  });
export type DiscoveryUniverseEntry = z.infer<typeof DiscoveryUniverseEntrySchema>;
export const DiscoveryAttributionSchema = DiscoveryUniverseEntrySchema;

export const CheapMonitorStateSchema = z.enum([
  'NEW',
  'MONITORING_CHEAP',
  'PROMOTED_TO_VERIFY',
  'REJECTED_CHEAP',
  'EXPIRED_CHEAP',
]);
export const CheapMonitorRowSchema = z
  .object({
    candidateId: z.string().min(1),
    assetRepresentationId: z.string().min(1),
    state: CheapMonitorStateSchema,
    checkCount: z.number().int().nonnegative(),
    maxChecks: z.number().int().positive(),
    backoffSeconds: z.number().nonnegative(),
    lastCheckedAt: UtcTimestampSchema.optional(),
    nextCheckDueAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    stalenessLimitSeconds: z.number().nonnegative(),
    resourceBudgetClass: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    operationId: z.string().min(1).optional(),
    decisionHistory: z.array(z.string().min(1)),
  })
  .strict()
  .refine((v) => v.checkCount <= v.maxChecks, { message: 'checkCount exceeds finite maximum' });
export type CheapMonitorRow = z.infer<typeof CheapMonitorRowSchema>;
export const MonitorBatchDescriptorSchema = z
  .object({
    batchId: z.string().min(1),
    batchSize: z.number().int().positive(),
    candidateIds: z.array(z.string().min(1)).min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    scheduledAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => v.candidateIds.length === v.batchSize, {
    message: 'batch size does not match candidateIds',
  });
export const CheapMonitorDecisionSchema = z.enum([
  'REJECT_CHEAP',
  'MONITOR_CHEAP',
  'PROMOTE_TO_VERIFY',
]);
export const PromotionDecisionSchema = z
  .object({
    decisionId: z.string().min(1),
    candidateId: z.string().min(1),
    policyVersion: z.string().min(1),
    featureSnapshotVersion: z.string().min(1),
    inputsHash: ContentAddressSchema,
    decisionVersion: z.string().min(1),
    decision: CheapMonitorDecisionSchema,
    rationale: z.string().min(1),
    decidedAt: UtcTimestampSchema,
  })
  .strict();
export type PromotionDecision = z.infer<typeof PromotionDecisionSchema>;
export const CoveragePopulationSchema = z.enum([
  'SUPPORTED_PROGRAM_UNIVERSE',
  'PROSPECTIVELY_OBSERVED_UNIVERSE',
  'AGGREGATE_PROVIDER_UNIVERSE',
  'AUTHORIZED_LAUNCH_UNIVERSE',
  'STRATIFIED_SAMPLED_UNIVERSE',
  'CURRENTLY_OBSERVED_SUBSET_ONLY',
]);
export const CoveragePopulationManifestSchema = z
  .object({
    manifestId: z.string().min(1),
    populationClass: CoveragePopulationSchema,
    collectorScopeIds: z.array(z.string().min(1)),
    sourceIds: z.array(z.string().min(1)),
    startSlot: z.string().regex(/^\d+$/),
    endSlot: z.string().regex(/^\d+$/),
    startTime: UtcTimestampSchema,
    endTime: UtcTimestampSchema,
    knownGapsCount: z.number().int().nonnegative(),
    rightsExclusions: z.array(z.string().min(1)),
    selectionProbabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
    sourceDependenceDisclosed: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      BigInt(v.endSlot) >= BigInt(v.startSlot) && Date.parse(v.endTime) > Date.parse(v.startTime),
    { message: 'population window is inverted' },
  );
export type CoveragePopulationManifest = z.infer<typeof CoveragePopulationManifestSchema>;

export const DiscClaimBasisSchema = enumSchema(ALL_DISC_CLAIM_BASES);
export type DiscClaimBasis = z.infer<typeof DiscClaimBasisSchema>;

export const DiscSourceProfileSchema = z
  .object({
    sourceId: z.string().min(1),
    profileVersion: z.number().int().positive(),
    sourceClass: DiscoverySourceClassSchema,
    coverageScope: z.record(z.string(), z.unknown()),
    rightsBasis: enumSchema(ALL_DISC_RIGHTS_BASES),
    queryFilterVersion: z.string().min(1),
    upstreamDependence: z.record(z.string(), z.unknown()),
    upstreamLineageKeys: z.array(z.string().min(1)),
    manipulationPolicy: enumSchema(ALL_DISC_MANIPULATION_POLICIES),
    collectorScopeIds: z.array(z.string().min(1)),
    effectiveFrom: UtcTimestampSchema,
    supersededAt: UtcTimestampSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.supersededAt === undefined ||
      Date.parse(value.supersededAt) > Date.parse(value.effectiveFrom),
    { message: 'source profile validity window is inverted' },
  );

export const UniverseEntryProvenanceSchema = z
  .object({
    entryId: z.string().min(1),
    normalizedIdentityId: z.string().min(1),
    entryReason: enumSchema(ALL_DISC_ENTRY_REASONS),
    coverageScopeRef: z.string().min(1),
    rightsRecord: enumSchema(ALL_DISC_RIGHTS_BASES),
    queryFilterVersion: z.string().min(1),
    upstreamDependenceDisclosed: z.record(z.string(), z.unknown()),
    firstPartyObserved: z.boolean(),
  })
  .strict();

export const DiscRecallVerdictSchema = enumSchema(ALL_DISC_RECALL_VERDICTS);
export type DiscRecallVerdict = z.infer<typeof DiscRecallVerdictSchema>;

export const RecallEstimateRecordSchema = z
  .object({
    estimateId: z.string().min(1),
    manifestId: z.string().min(1),
    evaluatedSourceId: z.string().min(1),
    claimBasis: DiscClaimBasisSchema,
    verdict: DiscRecallVerdictSchema,
    recallEstimate: z.number().min(0).max(1).optional(),
    inclusionProbabilitySource: z.string().min(1).optional(),
    independenceEvidence: z.array(z.string().min(1)),
    constraintIds: z.array(z.string().min(1)),
    asOf: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verdict === 'INDEPENDENT_ESTIMATE' && value.recallEstimate === undefined) {
      context.addIssue({ code: 'custom', message: 'an independent verdict requires an estimate' });
    }
    if (
      (value.verdict === 'INDEPENDENT_ESTIMATE' || value.verdict === 'DEPENDENT_DISCLOSED') &&
      value.independenceEvidence.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'an evidentiary verdict requires evidence refs',
      });
    }
  });
export type RecallEstimateRecord = z.infer<typeof RecallEstimateRecordSchema>;
export const RecallEstimateSchema = RecallEstimateRecordSchema;

export const PopulationConstraintSchema = z
  .object({
    constraintId: NonEmptyString,
    manifestId: NonEmptyString,
    kind: enumSchema(ALL_DISC_CONSTRAINT_KINDS),
    effect: enumSchema(ALL_DISC_CONSTRAINT_EFFECTS),
    sourceId: NonEmptyString.optional(),
    collectorScopeId: NonEmptyString.optional(),
    programVersion: NonEmptyString.optional(),
    windowStart: UtcTimestampSchema.optional(),
    windowEnd: UtcTimestampSchema.optional(),
    windowStartSlot: z.string().regex(/^\d+$/).optional(),
    windowEndSlot: z.string().regex(/^\d+$/).optional(),
    evidenceRefs: z.array(NonEmptyString).min(1),
    resolvedAt: UtcTimestampSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.windowStart !== undefined &&
      value.windowEnd !== undefined &&
      Date.parse(value.windowEnd) <= Date.parse(value.windowStart)
    ) {
      context.addIssue({ code: 'custom', message: 'constraint time window is inverted' });
    }
    if (
      value.windowStartSlot !== undefined &&
      value.windowEndSlot !== undefined &&
      BigInt(value.windowEndSlot) < BigInt(value.windowStartSlot)
    ) {
      context.addIssue({ code: 'custom', message: 'constraint slot window is inverted' });
    }
  });
export type PopulationConstraintRecord = z.infer<typeof PopulationConstraintSchema>;

export const ChainAccessDeclarationSchema = z
  .object({
    declarationId: z.string().min(1),
    version: z.number().int().positive(),
    purpose: enumSchema(ALL_DISC_CHAIN_ACCESS_PURPOSES),
    chainId: z.string().min(1),
    programIds: z.array(z.string().min(1)).min(1),
    maxCandidates: z.number().int().positive(),
    maxSlotsPerRun: z.number().int().positive(),
    maxCallsPerDay: z.number().int().positive(),
    maxWindowSeconds: z.number().int().positive(),
    costClass: z.enum(['FREE_UNMETERED', 'FREE_QUOTA']),
    paidFallbackAllowed: z.literal(false),
    protectedReserveCompatible: z.literal(true),
    tolerancePercent: z.number().int().min(1).max(100),
  })
  .strict();
export type ChainAccessDeclaration = z.infer<typeof ChainAccessDeclarationSchema>;

export const ChainAccessConsumptionSchema = z
  .object({
    consumptionId: NonEmptyString,
    declarationId: NonEmptyString,
    declarationVersion: z.number().int().positive(),
    runId: NonEmptyString,
    consumedAt: UtcTimestampSchema,
    slotsScanned: z.number().int().nonnegative(),
    callsMade: z.number().int().nonnegative(),
    candidatesTouched: z.number().int().nonnegative(),
    incidentId: NonEmptyString.optional(),
  })
  .strict()
  .refine((value) => value.slotsScanned + value.callsMade + value.candidatesTouched > 0, {
    message: 'chain access consumption must contain a positive count',
  });
export type ChainAccessConsumptionRecord = z.infer<typeof ChainAccessConsumptionSchema>;

export const DiscLatenessBasisSchema = enumSchema(ALL_DISC_LATENESS_BASES);
const NullableCount = z.number().int().nonnegative().nullable();
const NullableNumber = z.number().finite().nonnegative().nullable();
const NullableFiniteNumber = z.number().finite().nullable();
const NullableRate = z.number().finite().min(0).max(1).nullable();
const DistributionSchema = z
  .object({
    count: z.number().int().nonnegative(),
    min: z.number().finite(),
    p50: z.number().finite(),
    p95: z.number().finite(),
    max: z.number().finite(),
  })
  .strict()
  .refine((value) => value.min <= value.p50 && value.p50 <= value.p95 && value.p95 <= value.max, {
    message: 'distribution quantiles are not ordered',
  });

const COVERAGE_METRIC_FIELDS = [
  'uniqueDiscoveryYield',
  'pairwiseOverlap',
  'effectiveIndependentYield',
  'firstSeenLeadLagSeconds',
  'sourceEventToSystemLatencySeconds',
  'supportedProgramEventRecall',
  'sourceCoverageLossWindows',
  'extendedAtFirstSeenRate',
  'usefulTradableOutcomeYield',
  'falsePositiveYield',
  'cheapRejectYield',
  'costPerUsefulDiscovery',
  'creditsPerUsefulDiscovery',
  'bytesPerUsefulDiscovery',
  'collectorGapMisses',
  'unsupportedLayoutMisses',
  'retrospectiveNotDiscoveredCount',
  'sourceManipulationBoostedDiscoveryShare',
  'identityFailureRate',
  'unsupportedProgramExclusions',
  'priceExtensionAtFirstSystemAvailability',
] as const;

export const CoverageMetricSetSchema = z
  .object({
    metricSetId: NonEmptyString,
    manifestId: NonEmptyString,
    populationClass: CoveragePopulationSchema,
    sourceId: NonEmptyString,
    profileVersion: z.number().int().positive().nullable(),
    collectorScopeIds: z.array(NonEmptyString),
    asOf: UtcTimestampSchema,
    uniqueDiscoveryYield: NullableCount,
    pairwiseOverlap: z.record(NonEmptyString, z.number().int().nonnegative()).nullable(),
    effectiveIndependentYield: NullableNumber,
    firstSeenLeadLagSeconds: DistributionSchema.nullable(),
    sourceEventToSystemLatencySeconds: DistributionSchema.nullable(),
    providerLatenessBasis: DiscLatenessBasisSchema.nullable(),
    supportedProgramEventRecall: NullableRate,
    sourceCoverageLossWindows: NullableCount,
    extendedAtFirstSeenRate: NullableRate,
    usefulTradableOutcomeYield: NullableRate,
    falsePositiveYield: NullableRate,
    cheapRejectYield: NullableRate,
    costPerUsefulDiscovery: NullableNumber,
    creditsPerUsefulDiscovery: NullableNumber,
    bytesPerUsefulDiscovery: NullableNumber,
    collectorGapMisses: NullableCount,
    unsupportedLayoutMisses: NullableCount,
    retrospectiveNotDiscoveredCount: NullableCount,
    sourceManipulationBoostedDiscoveryShare: NullableRate,
    identityFailureRate: NullableRate,
    unsupportedProgramExclusions: NullableCount,
    priceExtensionAtFirstSystemAvailability: NullableFiniteNumber,
    qualityCodes: z.record(NonEmptyString, z.array(NonEmptyString).min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    for (const field of COVERAGE_METRIC_FIELDS) {
      if (value[field] === null && (value.qualityCodes[field]?.length ?? 0) === 0) {
        context.addIssue({
          code: 'custom',
          path: ['qualityCodes', field],
          message: `null metric ${field} requires a quality code`,
        });
      }
    }
    if (value.sourceEventToSystemLatencySeconds === null && value.providerLatenessBasis !== null) {
      context.addIssue({ code: 'custom', message: 'lateness basis requires a latency metric' });
    }
  });
export type CoverageMetricSet = z.infer<typeof CoverageMetricSetSchema>;

export const DISCOVERY_SCHEMAS = {
  DiscoveryUniverseEntry: DiscoveryUniverseEntrySchema,
  DiscoverySourceClass: DiscoverySourceClassSchema,
  CheapMonitorRow: CheapMonitorRowSchema,
  MonitorBatchDescriptor: MonitorBatchDescriptorSchema,
  CheapMonitorDecision: CheapMonitorDecisionSchema,
  PromotionDecision: PromotionDecisionSchema,
  CoveragePopulationManifest: CoveragePopulationManifestSchema,
  DiscClaimBasis: DiscClaimBasisSchema,
  DiscSourceProfile: DiscSourceProfileSchema,
  UniverseEntryProvenance: UniverseEntryProvenanceSchema,
  DiscRecallVerdict: DiscRecallVerdictSchema,
  RecallEstimateRecord: RecallEstimateRecordSchema,
  RecallEstimate: RecallEstimateSchema,
  PopulationConstraint: PopulationConstraintSchema,
  ChainAccessDeclaration: ChainAccessDeclarationSchema,
  ChainAccessConsumption: ChainAccessConsumptionSchema,
  CoverageMetricSet: CoverageMetricSetSchema,
} as const;
export class DiscoverySchemaError extends Error {
  readonly code = 'DISCOVERY_SCHEMA_INVALID' as const;
  constructor(
    readonly schemaName: keyof typeof DISCOVERY_SCHEMAS,
    readonly issues: readonly z.ZodIssue[],
  ) {
    super(`${schemaName} payload refused`);
    this.name = 'DiscoverySchemaError';
  }
}
export function parseDiscoverySchema<T extends keyof typeof DISCOVERY_SCHEMAS>(
  name: T,
  payload: unknown,
): z.infer<(typeof DISCOVERY_SCHEMAS)[T]> {
  const parsed = DISCOVERY_SCHEMAS[name].safeParse(payload);
  if (!parsed.success) throw new DiscoverySchemaError(name, parsed.error.issues);
  return parsed.data as z.infer<(typeof DISCOVERY_SCHEMAS)[T]>;
}
export const parseDiscSchema = parseDiscoverySchema;
