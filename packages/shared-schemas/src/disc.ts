import { z } from 'zod';
import { ALL_QUALITY_CODES } from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

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
export const DiscoveryAttributionSchema = z
  .object({
    sourceId: z.string().min(1),
    sourceClass: DiscoverySourceClassSchema,
    sourceTimestamp: UtcTimestampSchema,
    systemTimestamp: UtcTimestampSchema,
    sourceRank: z.number().int().nonnegative(),
    lineageIndependenceGroup: z.string().min(1),
  })
  .strict();
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
    sourceMetadataHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    discoveryPolicyVersion: z.string().min(1),
    collectorCoverageManifestId: z.string().min(1).optional(),
    qualityCodes: z.array(
      z.enum(
        ALL_QUALITY_CODES as [
          (typeof ALL_QUALITY_CODES)[number],
          ...(typeof ALL_QUALITY_CODES)[number][],
        ],
      ),
    ),
  })
  .strict()
  .refine((v) => Date.parse(v.firstIngestedAt) >= Date.parse(v.sourceAvailableAt), {
    message: 'firstIngestedAt cannot precede sourceAvailableAt',
  });
export type DiscoveryUniverseEntry = z.infer<typeof DiscoveryUniverseEntrySchema>;

export const CheapMonitorStateSchema = z.enum([
  'NEW',
  'MONITORING_CHEAP',
  'PROMOTED_TO_VERIFY',
  'REJECTED_CHEAP',
  'EXPIRED_CHEAP',
]);
export const CheapMonitorRowSchema = z
  .object({
    monitorId: z.string().min(1),
    candidateId: z.string().min(1),
    state: CheapMonitorStateSchema,
    checksCompleted: z.number().int().nonnegative(),
    maxChecks: z.number().int().positive(),
    nextCheckAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    backoffMs: z.number().int().nonnegative(),
    maxStalenessMs: z.number().int().nonnegative(),
    resourceBudgetClass: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    lastObservationAt: UtcTimestampSchema.nullable(),
    retainedAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => v.checksCompleted <= v.maxChecks, {
    message: 'checksCompleted exceeds finite maximum',
  });
export type CheapMonitorRow = z.infer<typeof CheapMonitorRowSchema>;
export const MonitorBatchDescriptorSchema = z
  .object({
    batchId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    monitorIds: z.array(z.string().min(1)).min(1),
    maxBatchSize: z.number().int().positive(),
    scheduledAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => v.monitorIds.length <= v.maxBatchSize, { message: 'batch exceeds hard bound' });
export const CheapMonitorDecisionSchema = z.enum([
  'REJECT_CHEAP',
  'MONITOR_CHEAP',
  'PROMOTE_TO_VERIFY',
]);
export const PromotionDecisionSchema = z
  .object({
    decisionId: z.string().min(1),
    candidateId: z.string().min(1),
    decision: CheapMonitorDecisionSchema,
    frozenFeatures: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    featureVersions: z.record(z.string(), z.string().min(1)),
    policyVersion: z.string().min(1),
    decisionVersion: z.string().min(1),
    inputsHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    decidedAt: UtcTimestampSchema,
    persistenceEligible: z.boolean(),
    changeEligible: z.boolean(),
    executionEligible: z.boolean(),
    securityEligible: z.boolean(),
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
    population: CoveragePopulationSchema,
    sourceScope: z.array(z.string().min(1)),
    collectorScopeIds: z.array(z.string().min(1)),
    startAt: UtcTimestampSchema,
    endAt: UtcTimestampSchema,
    gaps: z.array(
      z
        .object({
          gapId: z.string().min(1),
          startAt: UtcTimestampSchema,
          endAt: UtcTimestampSchema,
          status: z.string().min(1),
        })
        .strict(),
    ),
    rightsExclusions: z.array(z.string().min(1)),
    programVersions: z.array(z.string().min(1)),
    selectionProbabilities: z.record(z.string(), z.number().min(0).max(1)),
    knownMissingSources: z.array(z.string().min(1)),
    sourceDependenceAssessment: z.string().min(1),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict()
  .refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), {
    message: 'population window is inverted',
  });
export type CoveragePopulationManifest = z.infer<typeof CoveragePopulationManifestSchema>;

export const DISCOVERY_SCHEMAS = {
  DiscoveryUniverseEntry: DiscoveryUniverseEntrySchema,
  DiscoverySourceClass: DiscoverySourceClassSchema,
  CheapMonitorRow: CheapMonitorRowSchema,
  MonitorBatchDescriptor: MonitorBatchDescriptorSchema,
  CheapMonitorDecision: CheapMonitorDecisionSchema,
  PromotionDecision: PromotionDecisionSchema,
  CoveragePopulationManifest: CoveragePopulationManifestSchema,
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
