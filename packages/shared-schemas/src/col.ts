import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

const ContentAddressSchema = z.string().regex(/^sha256:.+$/);
const NonEmptyStringsSchema = z.array(z.string().min(1)).min(1);

export const CollectorScopeDeclarationSchema = z
  .object({
    scopeId: z.string().min(1),
    chainId: z.string().min(1),
    programId: z.string().min(1),
    programVersion: z.string().min(1),
    accountLayoutVersion: z.string().min(1),
    supportedEventFamilies: NonEmptyStringsSchema,
    coverageStartSlot: z.string().regex(/^\d+$/),
    coverageStartTime: UtcTimestampSchema,
    finalityPolicy: z.enum(['confirmed', 'finalized']),
    decoderVersion: z.string().min(1),
    quotaStreamedByteEnvelope: z
      .object({ maxBytesPerSec: z.number().positive(), maxEventsPerSec: z.number().positive() })
      .strict(),
    maximumLagSlots: z.number().int().nonnegative(),
    maximumGapAgeSeconds: z.number().int().nonnegative(),
    rightsPolicy: z.string().min(1),
  })
  .strict();
export type CollectorScopeDeclaration = z.infer<typeof CollectorScopeDeclarationSchema>;

export const CollectorStreamRecordSchema = z
  .object({
    recordId: z.string().min(1),
    endpoint: z.string().min(1),
    subscriptionFilterVersion: z.string().min(1),
    connectionGeneration: z.number().int().nonnegative(),
    slot: z.string().regex(/^\d+$/),
    blockHash: z.string().min(1),
    transactionSignature: z.string().min(1),
    instructionIndex: z.number().int().nonnegative(),
    logIndex: z.number().int().nonnegative().optional(),
    accountCoordinates: z.array(z.string().min(1)).min(1),
    receivedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    ingestedAt: UtcTimestampSchema,
    finality: z.enum(['processed', 'confirmed', 'finalized']),
    rawArtifactHash: ContentAddressSchema,
    decoderVersion: z.string().min(1),
    rightsPolicy: z.string().min(1),
    normalizedEventHash: ContentAddressSchema,
    eventType: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine((v) => Date.parse(v.availableAt) >= Date.parse(v.receivedAt), {
    message: 'availableAt cannot precede collector receipt',
  })
  .refine((v) => Date.parse(v.ingestedAt) >= Date.parse(v.availableAt), {
    message: 'ingestedAt cannot precede availability',
  });
export type CollectorStreamRecord = z.infer<typeof CollectorStreamRecordSchema>;

export const ProgramCapabilityStateSchema = z.enum([
  'UNAVAILABLE',
  'DEGRADED',
  'SHADOW',
  'ACTIVE',
  'RETIRED',
]);
export const UpgradeAuthorityStateSchema = z.enum(['IMMUTABLE', 'ACTIVE', 'REVOKED', 'UNKNOWN']);
export const ProgramSupportManifestSchema = z
  .object({
    manifestId: z.string().min(1),
    chainId: z.string().min(1),
    protocolFamily: z.enum(['PUMP', 'RAYDIUM', 'ORCA', 'METEORA', 'JUPITER']),
    productFamily: z.string().min(1),
    programId: z.string().min(1),
    programDataAddress: z.string().min(1).optional(),
    deployedAtSlot: z.string().regex(/^\d+$/).optional(),
    currentProgramDataSlot: z.string().regex(/^\d+$/).optional(),
    upgradeAuthorityState: UpgradeAuthorityStateSchema,
    upgradeAuthorityAddress: z.string().min(1).optional(),
    accountLayoutVersion: z.string().min(1),
    instructionLayoutVersion: z.string().min(1),
    idlOrLayoutSha256: ContentAddressSchema,
    decoderVersion: z.string().min(1),
    poolMathAdapterVersion: z.string().min(1).optional(),
    transferSemanticsVersion: z.string().min(1).optional(),
    supportedEventFamilies: NonEmptyStringsSchema,
    requiredAccountFamilies: z.array(z.string().min(1)),
    officialReferenceUris: z.array(z.string().url()).min(1),
    officialReferencesVerifiedAt: UtcTimestampSchema,
    liveChainVerificationSlot: z.string().regex(/^\d+$/),
    liveChainVerificationHash: ContentAddressSchema,
    capabilityState: ProgramCapabilityStateSchema,
    unsupportedReasons: z.array(z.string().min(1)),
    validFrom: UtcTimestampSchema,
    validUntil: UtcTimestampSchema.optional(),
    contentHash: ContentAddressSchema,
    approvalArtifactId: z.string().min(1),
  })
  .strict()
  .refine((v) => v.validUntil === undefined || Date.parse(v.validUntil) > Date.parse(v.validFrom), {
    message: 'validUntil must follow validFrom',
  });
export type ProgramSupportManifest = z.infer<typeof ProgramSupportManifestSchema>;

export const CollectorPartitionStateSchema = z.enum([
  'DISABLED',
  'STARTING',
  'SYNCING',
  'LIVE',
  'DEGRADED',
  'GAP_DETECTED',
  'BACKFILLING',
  'PAUSED',
  'FAILED',
]);
export type CollectorPartitionState = z.infer<typeof CollectorPartitionStateSchema>;
export const CollectorGapStateSchema = z.enum([
  'OPEN',
  'BACKFILL_QUEUED',
  'BACKFILLING',
  'RESOLVED_COMPLETE',
  'RESOLVED_EMPTY_PROOF',
  'PARTIAL',
  'UNRESOLVED',
  'WAIVED_FOR_NARROW_SCOPE',
]);

export const CollectorDecodePauseSchema = z
  .object({
    pauseId: z.string().min(1),
    scopeId: z.string().min(1),
    programId: z.string().min(1),
    programVersion: z.string().min(1),
    decoderVersion: z.string().min(1),
    reason: z.enum([
      'UNKNOWN_INSTRUCTION_VARIANT',
      'ACCOUNT_LAYOUT_CHANGE',
      'DECODER_DRIFT',
      'PARITY_FAILURE',
      'PROGRAM_UPGRADE',
    ]),
    rawEventsPreserved: z.literal(true),
    pausedAt: UtcTimestampSchema,
    revalidatedAt: UtcTimestampSchema.nullable(),
    incidentId: z.string().min(1),
  })
  .strict();
export type CollectorDecodePause = z.infer<typeof CollectorDecodePauseSchema>;
export const CollectorIncidentSchema = z
  .object({
    incidentId: z.string().min(1),
    scopeId: z.string().min(1).nullable(),
    partitionId: z.string().min(1).nullable(),
    kind: z.string().min(1),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
    openedAt: UtcTimestampSchema,
    resolvedAt: UtcTimestampSchema.nullable(),
    evidenceRefs: z.array(z.string().min(1)),
  })
  .strict();

export const CollectorHealthSchema = z
  .object({
    partitionId: z.string().min(1),
    connectedState: z.enum(['CONNECTED', 'DISCONNECTED', 'CONNECTING']),
    endpointGeneration: z.number().int().nonnegative(),
    headSlot: z.string().regex(/^\d+$/),
    finalizedSlot: z.string().regex(/^\d+$/),
    checkpointLag: z.number().int().nonnegative(),
    gapCount: z.number().int().nonnegative(),
    gapDurationSeconds: z.number().nonnegative(),
    backfillStatus: z.enum(['IDLE', 'QUEUED', 'RUNNING', 'PARTIAL', 'BLOCKED']),
    decodeFailureRate: z.number().min(0).max(1),
    streamedBytes: z.number().nonnegative(),
    eventRate: z.number().nonnegative(),
    deduplicationRate: z.number().min(0).max(1),
    resourceConsumption: z
      .object({ cpuPercent: z.number().nonnegative(), memoryMb: z.number().nonnegative() })
      .strict(),
    sampledAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => BigInt(v.finalizedSlot) <= BigInt(v.headSlot), {
    message: 'finalizedSlot cannot exceed headSlot',
  });
export type CollectorHealth = z.infer<typeof CollectorHealthSchema>;

const CeilingSchema = z.number().nonnegative();
export const CollectorCeilingSetSchema = z
  .object({
    ceilingSetId: z.string().min(1),
    cpuCoreLimit: CeilingSchema,
    memoryMbLimit: CeilingSchema,
    networkBandwidthMbps: CeilingSchema,
    activeSubscriptionLimit: CeilingSchema,
    eventRatePerSecLimit: CeilingSchema,
    rawStorageDailyMbLimit: CeilingSchema,
    retryMaxPerHour: CeilingSchema,
    monthlyCreditQuota: CeilingSchema,
    sustainableContractId: z.string().min(1),
  })
  .strict();
export type CollectorCeilingSet = z.infer<typeof CollectorCeilingSetSchema>;
export const FirstSeenLatencySpansSchema = z
  .object({
    eventToCollectorMs: z.number().nonnegative(),
    collectorToFeatureMs: z.number().nonnegative(),
    featureToDecisionMs: z.number().nonnegative(),
    decisionToDeliveryMs: z.number().nonnegative(),
    providerComparisonMs: z.number().nonnegative(),
    isFirstPartyVerifiedScope: z.boolean(),
  })
  .strict();
export type FirstSeenLatencySpans = z.infer<typeof FirstSeenLatencySpansSchema>;

export const COLLECTOR_SCHEMAS = {
  CollectorScopeDeclaration: CollectorScopeDeclarationSchema,
  CollectorStreamRecord: CollectorStreamRecordSchema,
  ProgramSupportManifest: ProgramSupportManifestSchema,
  CollectorPartitionState: CollectorPartitionStateSchema,
  CollectorGapState: CollectorGapStateSchema,
  CollectorDecodePause: CollectorDecodePauseSchema,
  CollectorIncident: CollectorIncidentSchema,
  CollectorHealth: CollectorHealthSchema,
  CollectorCeilingSet: CollectorCeilingSetSchema,
  FirstSeenLatencySpans: FirstSeenLatencySpansSchema,
} as const;
export class CollectorSchemaError extends Error {
  readonly code = 'COLLECTOR_SCHEMA_INVALID' as const;
  constructor(
    readonly schemaName: keyof typeof COLLECTOR_SCHEMAS,
    readonly issues: readonly z.ZodIssue[],
  ) {
    super(`${schemaName} payload refused`);
    this.name = 'CollectorSchemaError';
  }
}
export function parseCollectorSchema<T extends keyof typeof COLLECTOR_SCHEMAS>(
  name: T,
  payload: unknown,
): z.infer<(typeof COLLECTOR_SCHEMAS)[T]> {
  const parsed = COLLECTOR_SCHEMAS[name].safeParse(payload);
  if (!parsed.success) throw new CollectorSchemaError(name, parsed.error.issues);
  return parsed.data as z.infer<(typeof COLLECTOR_SCHEMAS)[T]>;
}
export const parseColSchema = parseCollectorSchema;
