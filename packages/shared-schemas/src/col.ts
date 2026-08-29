import { z } from 'zod';
import { ALL_AVAILABILITY_PROVENANCE_CLASSES } from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const NonEmptySetSchema = z.array(z.string().min(1)).min(1);

export const CollectorFinalityPolicySchema = z.enum(['PROCESSED', 'CONFIRMED', 'FINALIZED']);
export const CollectorScopeDeclarationSchema = z
  .object({
    scopeId: z.string().min(1),
    scopeVersion: z.number().int().positive(),
    chainId: z.string().min(1),
    programId: z.string().min(1),
    programVersion: z.string().min(1),
    eventFamilies: NonEmptySetSchema,
    accountFilters: z.array(z.string().min(1)),
    coverageStart: UtcTimestampSchema,
    finalityPolicy: CollectorFinalityPolicySchema,
    decoderVersion: z.string().min(1),
    byteEnvelope: z.number().int().positive(),
    quotaEnvelope: z.number().nonnegative(),
    maxLagSlots: z.number().int().nonnegative(),
    maxGapAgeMs: z.number().int().nonnegative(),
    rightsPolicyRef: z.string().min(1),
    retentionPolicyRef: z.string().min(1),
    supportManifestRef: Sha256Schema,
    active: z.boolean(),
  })
  .strict();
export type CollectorScopeDeclaration = z.infer<typeof CollectorScopeDeclarationSchema>;

const AvailabilityClassSchema = z.enum(
  ALL_AVAILABILITY_PROVENANCE_CLASSES as [
    (typeof ALL_AVAILABILITY_PROVENANCE_CLASSES)[number],
    ...(typeof ALL_AVAILABILITY_PROVENANCE_CLASSES)[number][],
  ],
);
export const CollectorStreamRecordSchema = z
  .object({
    recordId: z.string().min(1),
    scopeId: z.string().min(1),
    scopeVersion: z.number().int().positive(),
    chainId: z.string().min(1),
    programId: z.string().min(1),
    programVersion: z.string().min(1),
    eventFamily: z.string().min(1),
    endpointId: z.string().min(1),
    subscriptionVersion: z.string().min(1),
    filterVersion: z.string().min(1),
    connectionGeneration: z.number().int().nonnegative(),
    slot: z.number().int().nonnegative(),
    blockHash: z.string().min(1),
    transactionSignature: z.string().min(1),
    transactionIndex: z.number().int().nonnegative().nullable(),
    instructionIndex: z.number().int().nonnegative().nullable(),
    innerInstructionIndex: z.number().int().nonnegative().nullable(),
    logIndex: z.number().int().nonnegative().nullable(),
    accountAddress: z.string().min(1).nullable(),
    accountWriteVersion: z.number().int().nonnegative().nullable(),
    receivedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    availabilityProvenance: AvailabilityClassSchema,
    finality: CollectorFinalityPolicySchema,
    rawArtifactHash: Sha256Schema,
    normalizedEventHash: Sha256Schema,
    decoderVersion: z.string().min(1),
    rightsPolicyRef: z.string().min(1),
    receiptHash: Sha256Schema,
  })
  .strict()
  .refine((v) => Date.parse(v.availableAt) >= Date.parse(v.receivedAt), {
    message: 'availableAt cannot precede collector receipt',
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
    protocolFamily: z.string().min(1),
    productFamily: z.string().min(1),
    programId: z.string().min(1),
    programDataAddress: z.string().min(1).optional(),
    deployedAtSlot: z.string().regex(/^\d+$/).optional(),
    currentProgramDataSlot: z.string().regex(/^\d+$/).optional(),
    upgradeAuthorityState: UpgradeAuthorityStateSchema,
    upgradeAuthorityAddress: z.string().min(1).optional(),
    accountLayoutVersion: z.string().min(1),
    instructionLayoutVersion: z.string().min(1),
    idlOrLayoutSha256: Sha256Schema,
    decoderVersion: z.string().min(1),
    poolMathAdapterVersion: z.string().min(1).optional(),
    transferSemanticsVersion: z.string().min(1).optional(),
    supportedEventFamilies: NonEmptySetSchema,
    requiredAccountFamilies: z.array(z.string().min(1)),
    officialReferenceUris: z.array(z.string().url()).min(1),
    officialReferencesVerifiedAt: UtcTimestampSchema,
    liveChainVerificationSlot: z.string().regex(/^\d+$/),
    liveChainVerificationHash: z.string().min(1),
    capabilityState: ProgramCapabilityStateSchema,
    unsupportedReasons: z.array(z.string().min(1)),
    validFrom: UtcTimestampSchema,
    validUntil: UtcTimestampSchema.optional(),
    contentHash: Sha256Schema,
    approvalArtifactId: z.string().min(1),
  })
  .strict()
  .refine((v) => v.validUntil === undefined || Date.parse(v.validUntil) > Date.parse(v.validFrom), {
    message: 'validUntil must follow validFrom',
  });
export type ProgramSupportManifest = z.infer<typeof ProgramSupportManifestSchema>;

export const CollectorPartitionStateKindSchema = z.enum([
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
export const CollectorPartitionStateSchema = z
  .object({
    partitionId: z.string().min(1),
    scopeId: z.string().min(1),
    scopeVersion: z.number().int().positive(),
    state: CollectorPartitionStateKindSchema,
    fencingToken: z.number().int().positive(),
    shardId: z.string().min(1),
    leaseRef: z.string().min(1),
    checkpoint: z.number().int().nonnegative(),
    transitionedAt: UtcTimestampSchema,
    auditRef: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type CollectorPartitionState = z.infer<typeof CollectorPartitionStateSchema>;

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

export const CollectorResourceConsumptionSchema = z
  .object({
    cpuPercent: z.number().nonnegative(),
    memoryBytes: z.number().nonnegative(),
    networkBytes: z.number().nonnegative(),
    subscriptions: z.number().int().nonnegative(),
    rawStorageBytes: z.number().nonnegative(),
    retries: z.number().int().nonnegative(),
    monthlyCredits: z.number().nonnegative(),
  })
  .strict();
export const CollectorHealthSchema = z
  .object({
    partitionId: z.string().min(1),
    measuredAt: UtcTimestampSchema,
    connected: z.boolean(),
    endpointGeneration: z.number().int().nonnegative(),
    headSlot: z.number().int().nonnegative(),
    finalizedSlot: z.number().int().nonnegative(),
    checkpointLag: z.number().int().nonnegative(),
    gapCount: z.number().int().nonnegative(),
    oldestGapDurationMs: z.number().int().nonnegative(),
    backfillStatus: z.enum(['IDLE', 'QUEUED', 'RUNNING', 'PARTIAL', 'BLOCKED']),
    decodeFailureRate: z.number().min(0).max(1),
    streamedBytes: z.number().nonnegative(),
    eventRate: z.number().nonnegative(),
    deduplicationRate: z.number().min(0).max(1),
    resourceConsumption: CollectorResourceConsumptionSchema,
  })
  .strict()
  .refine((v) => v.finalizedSlot <= v.headSlot, {
    message: 'finalizedSlot cannot exceed headSlot',
  });
export type CollectorHealth = z.infer<typeof CollectorHealthSchema>;

const CeilingSchema = z.number().nonnegative();
export const CollectorCeilingSetSchema = z
  .object({
    contractId: z.string().min(1),
    version: z.string().min(1),
    horizonDays: z.number().int().min(30),
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    result: z.enum(['PASS', 'FAIL', 'UNVERIFIED']),
    minimumHeadroomFraction: z.number().min(0).max(1),
    degradationPolicyVersion: z.string().min(1),
    cpuPercent: CeilingSchema,
    memoryBytes: CeilingSchema,
    networkBytes: CeilingSchema,
    subscriptions: CeilingSchema,
    eventRate: CeilingSchema,
    rawStorageBytes: CeilingSchema,
    retries: CeilingSchema,
    monthlyCredits: CeilingSchema,
    paidOverageAllowed: z.literal(false),
    reserveConsumptionAllowed: z.literal(false),
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.verifiedAt), {
    message: 'capacity contract expiry must follow verification',
  });
export type CollectorCeilingSet = z.infer<typeof CollectorCeilingSetSchema>;

export const FirstSeenLatencySpansSchema = z
  .object({
    subjectId: z.string().min(1),
    scopeId: z.string().min(1),
    scopeVerified: z.boolean(),
    sourceEventAt: UtcTimestampSchema,
    collectorReceiptAt: UtcTimestampSchema,
    providerAvailableAt: UtcTimestampSchema.nullable(),
    featureReadyAt: UtcTimestampSchema.nullable(),
    decisionReadyAt: UtcTimestampSchema.nullable(),
    deliveredAt: UtcTimestampSchema.nullable(),
    recordedAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => Date.parse(v.collectorReceiptAt) >= Date.parse(v.sourceEventAt), {
    message: 'receipt cannot precede source event',
  });
export type FirstSeenLatencySpans = z.infer<typeof FirstSeenLatencySpansSchema>;

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
export const COLLECTOR_SCHEMAS = {
  CollectorScopeDeclaration: CollectorScopeDeclarationSchema,
  CollectorStreamRecord: CollectorStreamRecordSchema,
  ProgramSupportManifest: ProgramSupportManifestSchema,
  CollectorPartitionState: CollectorPartitionStateSchema,
  CollectorDecodePause: CollectorDecodePauseSchema,
  CollectorIncident: CollectorIncidentSchema,
  CollectorHealth: CollectorHealthSchema,
  CollectorCeilingSet: CollectorCeilingSetSchema,
  FirstSeenLatencySpans: FirstSeenLatencySpansSchema,
} as const;
export function parseCollectorSchema<T extends keyof typeof COLLECTOR_SCHEMAS>(
  name: T,
  payload: unknown,
): z.infer<(typeof COLLECTOR_SCHEMAS)[T]> {
  const parsed = COLLECTOR_SCHEMAS[name].safeParse(payload);
  if (!parsed.success) throw new CollectorSchemaError(name, parsed.error.issues);
  return parsed.data as z.infer<(typeof COLLECTOR_SCHEMAS)[T]>;
}
