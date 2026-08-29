import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

const ContentAddressSchema = z.string().regex(/^sha256:.+$/);
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
export const parseDiscSchema = parseDiscoverySchema;
