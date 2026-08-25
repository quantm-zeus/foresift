/**
 * Versioned Zod schemas mirroring the provider-lifecycle contracts — the
 * manifest schemaRefs for FR-PROV-001…010 (`packages/shared-schemas/src/prov.ts`).
 *
 * Covers:
 * - §15.3 ProviderOperationDefinition (providerId, operationId, version, capabilityClass,
 *   costClass, healthStatus, quota fields, schemas, TTLs, deprecation metadata)
 * - §12.11 ProviderLifecycleState alphabet and legal state transition graph (FR-PROV-001)
 * - §15.4 ProviderHealthStatus vocabulary and health records
 * - FR-PROV-002 Verification kinds (9 kinds), records, sources, outcomes, and TTL configs
 * - FR-PROV-003 Migration exceptions with replacement plans
 * - FR-PROV-008 Response quarantine classes (5 classes) and quarantine finding records
 * - FR-PROV-009 / §15.6 Sixteen-field rights matrices, rights changes, artifact states, and actions
 * - FR-PROV-010 Six provider source fingerprint kinds and fingerprint records
 * - FR-PROV-005 Adapter descriptors with exact allowlist dimensions
 * - AC-272 Provider readiness evaluation schema
 *
 * Fail-closed policy: all object schemas are `.strict()` to reject unknown keys.
 */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';
import { KeyedHashSchema } from './sec.ts';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const PROV_SCHEMA_REGISTRY_VERSION = 1;

// ---------------------------------------------------------------------------
// §15.2 Cost and capability classes
// ---------------------------------------------------------------------------

export const ProviderCostClassSchema = z.enum([
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
]);
export type ProviderCostClass = z.infer<typeof ProviderCostClassSchema>;

export const ProviderCapabilityClassSchema = z.enum([
  'READ_MARKET',
  'READ_SECURITY',
  'READ_IDENTITY',
  'READ_TRANSACTION_RAW',
  'READ_TRANSACTION_HISTORY',
  'READ_ACCOUNT_STATE',
  'READ_SOCIAL_AGGREGATE',
  'STREAM_PROGRAM_EVENT',
  'QUOTE_READ_ONLY',
  'PROHIBITED_TRANSACTION_BUILD',
  'PROHIBITED_SIGN',
  'PROHIBITED_SUBMIT',
  'PROHIBITED_CUSTODY',
]);
export type ProviderCapabilityClass = z.infer<typeof ProviderCapabilityClassSchema>;

export const PROHIBITED_CAPABILITY_CLASSES = [
  'PROHIBITED_TRANSACTION_BUILD',
  'PROHIBITED_SIGN',
  'PROHIBITED_SUBMIT',
  'PROHIBITED_CUSTODY',
] as const;

export function isProhibitedCapabilityClass(capabilityClass: string): boolean {
  return (PROHIBITED_CAPABILITY_CLASSES as readonly string[]).includes(capabilityClass);
}

// ---------------------------------------------------------------------------
// §12.11 Lifecycle states and legal transitions (FR-PROV-001)
// ---------------------------------------------------------------------------

export const ProviderLifecycleStateSchema = z.enum([
  'DISCOVERED',
  'VERIFIED',
  'ACTIVE',
  'DEGRADED',
  'DEPRECATED',
  'BLOCKED',
  'REMOVED',
]);
export type ProviderLifecycleState = z.infer<typeof ProviderLifecycleStateSchema>;

/**
 * Legal transition graph (§12.11):
 * DISCOVERED -> VERIFIED, BLOCKED, REMOVED
 * VERIFIED   -> ACTIVE, DEGRADED, DEPRECATED, BLOCKED, REMOVED
 * ACTIVE     -> DEGRADED, DEPRECATED, BLOCKED, REMOVED
 * DEGRADED   -> ACTIVE, DEPRECATED, BLOCKED, REMOVED
 * DEPRECATED -> BLOCKED, REMOVED
 * BLOCKED    -> VERIFIED, DEGRADED, REMOVED
 * REMOVED    -> (terminal)
 */
export const LEGAL_LIFECYCLE_TRANSITIONS: Record<
  ProviderLifecycleState,
  readonly ProviderLifecycleState[]
> = {
  DISCOVERED: ['VERIFIED', 'BLOCKED', 'REMOVED'],
  VERIFIED: ['ACTIVE', 'DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  ACTIVE: ['DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEGRADED: ['ACTIVE', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEPRECATED: ['BLOCKED', 'REMOVED'],
  BLOCKED: ['VERIFIED', 'DEGRADED', 'REMOVED'],
  REMOVED: [],
} as const;

export function isLegalLifecycleTransition(
  from: ProviderLifecycleState,
  to: ProviderLifecycleState,
): boolean {
  return LEGAL_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const ProviderLifecycleTransitionEventSchema = z
  .object({
    eventId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    fromState: ProviderLifecycleStateSchema,
    toState: ProviderLifecycleStateSchema,
    reasonClass: z.string().min(1),
    actor: z.string().min(1),
    occurredAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)),
    idempotencyKey: z.string().min(1),
  })
  .strict()
  .refine((v) => isLegalLifecycleTransition(v.fromState, v.toState), {
    message: 'illegal lifecycle state transition',
  });
export type ProviderLifecycleTransitionEvent = z.infer<
  typeof ProviderLifecycleTransitionEventSchema
>;

// ---------------------------------------------------------------------------
// §15.4 Health statuses
// ---------------------------------------------------------------------------

export const ProviderHealthStatusSchema = z.enum([
  'HEALTHY',
  'DEGRADED',
  'SCHEMA_DRIFT',
  'PLAN_UNVERIFIED',
  'RIGHTS_UNVERIFIED',
  'DEPRECATED',
  'SUNSET_PENDING',
  'QUOTA_LOW',
  'QUOTA_EXHAUSTED',
  'AUTH_FAILED',
  'UNSUPPORTED',
  'DISABLED',
]);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

export const ProviderHealthRecordSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    status: ProviderHealthStatusSchema,
    endpointRegion: z.string().min(1).nullable(),
    chainId: z.string().min(1).nullable(),
    programId: z.string().min(1).nullable(),
    checkedAt: UtcTimestampSchema,
    reason: z.string().min(1).nullable(),
    evidenceRef: z.string().min(1).nullable(),
  })
  .strict();
export type ProviderHealthRecord = z.infer<typeof ProviderHealthRecordSchema>;

// ---------------------------------------------------------------------------
// §15.3 Operation definitions (FR-PROV-001)
// ---------------------------------------------------------------------------

export const SupportedProgramEntrySchema = z
  .object({
    programId: z.string().min(1),
    versions: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type SupportedProgramEntry = z.infer<typeof SupportedProgramEntrySchema>;

export const BatchCapabilitySchema = z
  .object({
    maxEntities: z.number().int().positive(),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();
export type BatchCapability = z.infer<typeof BatchCapabilitySchema>;

export const ProviderOperationDefinitionSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    capabilityClass: ProviderCapabilityClassSchema,
    supportedChains: z.array(z.string().min(1)).min(1),
    supportedPrograms: z.array(SupportedProgramEntrySchema).optional(),
    inputSchemaId: z.string().min(1),
    rawOutputSchemaId: z.string().min(1),
    normalizedOutputSchemaId: z.string().min(1),
    quotaModelId: z.string().min(1),
    cachePolicyId: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    retryPolicyId: z.string().min(1),
    declaredIndependenceGroup: z.string().min(1),
    upstreamLineage: z.array(z.string().min(1)),
    licensePolicyId: z.string().min(1),
    healthStatus: ProviderHealthStatusSchema,
    costClass: ProviderCostClassSchema,
    estimatedQuotaUnits: z.number().nonnegative(),
    quotaResetPolicyId: z.string().min(1),
    batchCapability: BatchCapabilitySchema.optional(),
    minimumCandidateStage: z.string().min(1).optional(),
    protectedReserveEligible: z.boolean(),
    allowedInStrictFree: z.boolean(),
    paidFallbackAllowed: z.boolean(),
    deprecatedAt: UtcTimestampSchema.optional(),
    sunsetAt: UtcTimestampSchema.optional(),
    replacementOperationId: z.string().min(1).optional(),
    verificationExpiresAt: UtcTimestampSchema,
    forbiddenOutputFields: z.array(z.string().min(1)),
    negativeCapabilities: z.array(z.string().min(1)),
  })
  .strict();
export type ProviderOperationDefinition = z.infer<typeof ProviderOperationDefinitionSchema>;

/** Stateful summary record tracking FR-PROV-001 operational metadata. */
export const ProviderOperationRecordSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    currentState: ProviderLifecycleStateSchema,
    healthStatus: ProviderHealthStatusSchema,
    lastDocumentationVerificationAt: UtcTimestampSchema.nullable(),
    lastLiveProbeAt: UtcTimestampSchema.nullable(),
    replacementOperationId: z.string().min(1).nullable(),
    sunsetAt: UtcTimestampSchema.nullable(),
    deprecatedAt: UtcTimestampSchema.nullable(),
    affectedFeatures: z.array(z.string().min(1)),
  })
  .strict();
export type ProviderOperationRecord = z.infer<typeof ProviderOperationRecordSchema>;

export const ProviderDependencyConsumerKindSchema = z.enum([
  'FEATURE',
  'TOOL',
  'EXPORT',
  'ALERT_DERIVATIVE',
]);
export type ProviderDependencyConsumerKind = z.infer<typeof ProviderDependencyConsumerKindSchema>;

export const ProviderOperationDependencySchema = z
  .object({
    dependencyId: z.string().min(1),
    consumerKind: ProviderDependencyConsumerKindSchema,
    consumerKey: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    active: z.boolean(),
    registeredAt: UtcTimestampSchema,
  })
  .strict();
export type ProviderOperationDependency = z.infer<typeof ProviderOperationDependencySchema>;

// ---------------------------------------------------------------------------
// FR-PROV-002: Verification kinds, records, TTL configs
// ---------------------------------------------------------------------------

export const ProviderVerificationKindSchema = z.enum([
  'DOCUMENTATION',
  'PRICING_PLAN',
  'QUOTA',
  'RIGHTS',
  'SCHEMA',
  'ENDPOINT',
  'AUTHENTICATION',
  'DEPRECATION',
  'LIVE_PROBE',
]);
export type ProviderVerificationKind = z.infer<typeof ProviderVerificationKindSchema>;

export const VerificationSourceSchema = z.enum(['OFFICIAL_DOC', 'LIVE_CONTRACT']);
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

export const VerificationOutcomeSchema = z.enum(['PASSED', 'FAILED', 'INCONCLUSIVE']);
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

export const ProviderVerificationRecordSchema = z
  .object({
    verificationId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    kind: ProviderVerificationKindSchema,
    source: VerificationSourceSchema,
    outcome: VerificationOutcomeSchema,
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)).min(1),
    notes: z.string().nullable().optional(),
  })
  .strict()
  .refine((v) => v.expiresAt > v.verifiedAt, {
    message: 'expiresAt must be after verifiedAt',
  });
export type ProviderVerificationRecord = z.infer<typeof ProviderVerificationRecordSchema>;

export const ProviderVerificationTtlConfigSchema = z
  .object({
    configId: z.string().min(1),
    providerId: z.string().min(1).nullable(),
    kind: ProviderVerificationKindSchema,
    ttlSeconds: z.number().int().positive(),
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type ProviderVerificationTtlConfig = z.infer<typeof ProviderVerificationTtlConfigSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-003: Migration exceptions with replacement plans
// ---------------------------------------------------------------------------

export const ReplacementPlanStatusSchema = z.enum([
  'DRAFT',
  'APPROVED',
  'IN_PROGRESS',
  'COMPLETED',
  'ABANDONED',
]);
export type ReplacementPlanStatus = z.infer<typeof ReplacementPlanStatusSchema>;

export const ReplacementPlanSchema = z
  .object({
    planId: z.string().min(1),
    targetProviderId: z.string().min(1),
    targetOperationId: z.string().min(1),
    targetVersion: z.string().min(1),
    plannedMigrationDeadline: UtcTimestampSchema,
    milestones: z.array(z.string().min(1)).min(1),
    status: ReplacementPlanStatusSchema,
  })
  .strict();
export type ReplacementPlan = z.infer<typeof ReplacementPlanSchema>;

export const MigrationExceptionSchema = z
  .object({
    exceptionId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    approver: z.string().min(1),
    reason: z.string().min(1),
    replacementPlanId: z.string().min(1),
    replacementPlan: ReplacementPlanSchema.optional(),
    createdAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .refine((v) => v.expiresAt > v.createdAt, {
    message: 'expiresAt must be after createdAt',
  });
export type MigrationException = z.infer<typeof MigrationExceptionSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-008: Quarantine classes and finding records
// ---------------------------------------------------------------------------

export const QuarantineClassSchema = z.enum([
  'TRANSACTION_PAYLOAD',
  'SIGNING_REQUEST',
  'EXECUTABLE_INSTRUCTION',
  'PRIVATE_KEY_FIELD',
  'UNEXPECTED_WRITE_CAPABILITY',
]);
export type QuarantineClass = z.infer<typeof QuarantineClassSchema>;

export const ResponseQuarantineRecordSchema = z
  .object({
    quarantineId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    detectedClasses: z.array(QuarantineClassSchema).min(1),
    fieldPaths: z.array(z.string().min(1)).min(1),
    payloadSha256: KeyedHashSchema,
    byteSize: z.number().int().nonnegative(),
    disposition: z.literal('REJECTED'),
    modelContextExclusion: z.literal('ENFORCED'),
    auditChainRef: z.string().min(1),
    quarantinedAt: UtcTimestampSchema,
    details: z.string().nullable().optional(),
  })
  .strict();
export type ResponseQuarantineRecord = z.infer<typeof ResponseQuarantineRecordSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-009 / §15.6: Sixteen-field rights matrices, changes, artifact states
// ---------------------------------------------------------------------------

export const ProviderRightsMatrixSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    rightsVersion: z.number().int().positive(),
    commercialUseAllowed: z.boolean(),
    personalResearchAllowed: z.boolean(),
    cacheAllowed: z.boolean(),
    maximumCacheDurationSeconds: z.number().int().nonnegative(),
    rawRetentionAllowed: z.boolean(),
    derivedFeaturesAllowed: z.boolean(),
    modelTrainingAllowed: z.boolean(),
    redistributionAllowed: z.boolean(),
    publicAlertDerivativeAllowed: z.boolean(),
    attributionRequired: z.boolean(),
    userByokRequired: z.boolean(),
    rawExportAllowed: z.boolean(),
    jurisdictionRestrictions: z.array(z.string().min(1)),
    termsVersion: z.string().min(1),
    verifiedAt: UtcTimestampSchema,
    verificationExpiresAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => v.verificationExpiresAt > v.verifiedAt, {
    message: 'verificationExpiresAt must be after verifiedAt',
  });
export type ProviderRightsMatrix = z.infer<typeof ProviderRightsMatrixSchema>;

export const RightsUsePathSchema = z.enum([
  'STORAGE',
  'DERIVED_USE',
  'REDISTRIBUTION',
  'CACHING',
  'EXPORT',
  'MODEL_TRAINING',
  'PUBLIC_ALERT',
]);
export type RightsUsePath = z.infer<typeof RightsUsePathSchema>;

export const RightsChangeRecordSchema = z
  .object({
    changeId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    fromRightsVersion: z.number().int().positive(),
    toRightsVersion: z.number().int().positive(),
    newlyProhibitedUses: z.array(RightsUsePathSchema),
    tightened: z.boolean(),
    changedAt: UtcTimestampSchema,
    actor: z.string().min(1),
    auditRef: z.string().min(1),
  })
  .strict();
export type RightsChangeRecord = z.infer<typeof RightsChangeRecordSchema>;

export const ProviderArtifactStateSchema = z.enum(['ACTIVE', 'QUARANTINED', 'RETIRED']);
export type ProviderArtifactState = z.infer<typeof ProviderArtifactStateSchema>;

export const ProviderArtifactRecordSchema = z
  .object({
    artifactId: z.string().min(1),
    objectRef: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    rightsVersion: z.number().int().positive(),
    state: ProviderArtifactStateSchema,
    capturedAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type ProviderArtifactRecord = z.infer<typeof ProviderArtifactRecordSchema>;

export const RightsActionKindSchema = z.enum(['QUARANTINE', 'RETIRE']);
export type RightsActionKind = z.infer<typeof RightsActionKindSchema>;

export const RightsChangeActionRecordSchema = z
  .object({
    actionId: z.string().min(1),
    changeId: z.string().min(1),
    artifactId: z.string().min(1),
    action: RightsActionKindSchema,
    executedAt: UtcTimestampSchema,
    details: z.string().nullable().optional(),
  })
  .strict();
export type RightsChangeActionRecord = z.infer<typeof RightsChangeActionRecordSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-010: Six provider source fingerprint kinds
// ---------------------------------------------------------------------------

export const ProviderFingerprintKindSchema = z.enum([
  'UPSTREAM_LINEAGE',
  'VALUE_CORRELATION',
  'TIMING_BEHAVIOR',
  'OUTAGE_CORRELATION',
  'SCHEMA_CHARACTERISTICS',
  'FIRST_SEEN_BEHAVIOR',
]);
export type ProviderFingerprintKind = z.infer<typeof ProviderFingerprintKindSchema>;

export const SourceFingerprintRecordSchema = z
  .object({
    fingerprintId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    kind: ProviderFingerprintKindSchema,
    fingerprintPayloadCanonical: z.string().min(2),
    fingerprintSha256: KeyedHashSchema,
    computedAt: UtcTimestampSchema,
    estimatorInputRefs: z.array(z.string().min(1)),
  })
  .strict();
export type SourceFingerprintRecord = z.infer<typeof SourceFingerprintRecordSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-005: Adapter allowlist descriptors
// ---------------------------------------------------------------------------

export const ProviderAdapterDescriptorSchema = z
  .object({
    adapterId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    pathTemplate: z.string().min(1),
    httpMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']),
    acceptedContentTypes: z.array(z.string().min(1)).min(1),
    allowedRequestFields: z.array(z.string().min(1)),
    responseSchemaId: z.string().min(1),
  })
  .strict();
export type ProviderAdapterDescriptor = z.infer<typeof ProviderAdapterDescriptorSchema>;

// ---------------------------------------------------------------------------
// AC-272: Provider readiness evaluation
// ---------------------------------------------------------------------------

export const ProviderReadinessStatusSchema = z.enum(['ELIGIBLE', 'BLOCKED']);
export type ProviderReadinessStatus = z.infer<typeof ProviderReadinessStatusSchema>;

export const ProviderReadinessEvaluationSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    status: ProviderReadinessStatusSchema,
    blockingReasons: z.array(z.string().min(1)),
    evaluatedAt: UtcTimestampSchema,
    rightsVerified: z.boolean(),
    lifecycleHealthy: z.boolean(),
    verificationFresh: z.boolean(),
    prohibitedExposuresAbsent: z.boolean(),
  })
  .strict()
  .refine((v) => v.status !== 'ELIGIBLE' || v.blockingReasons.length === 0, {
    message: 'ELIGIBLE status must have zero blocking reasons',
  })
  .refine((v) => v.status !== 'BLOCKED' || v.blockingReasons.length > 0, {
    message: 'BLOCKED status must have at least one blocking reason',
  });
export type ProviderReadinessEvaluation = z.infer<typeof ProviderReadinessEvaluationSchema>;

// ---------------------------------------------------------------------------
// Registry (parse-by-name entrypoint mirroring data/dr/sec families)
// ---------------------------------------------------------------------------

export const PROV_SCHEMAS = {
  ProviderOperationDefinition: ProviderOperationDefinitionSchema,
  ProviderOperationRecord: ProviderOperationRecordSchema,
  ProviderOperationDependency: ProviderOperationDependencySchema,
  ProviderLifecycleTransitionEvent: ProviderLifecycleTransitionEventSchema,
  ProviderHealthRecord: ProviderHealthRecordSchema,
  ProviderVerificationRecord: ProviderVerificationRecordSchema,
  ProviderVerificationTtlConfig: ProviderVerificationTtlConfigSchema,
  ReplacementPlan: ReplacementPlanSchema,
  MigrationException: MigrationExceptionSchema,
  ResponseQuarantineRecord: ResponseQuarantineRecordSchema,
  ProviderRightsMatrix: ProviderRightsMatrixSchema,
  RightsChangeRecord: RightsChangeRecordSchema,
  ProviderArtifactRecord: ProviderArtifactRecordSchema,
  RightsChangeActionRecord: RightsChangeActionRecordSchema,
  SourceFingerprintRecord: SourceFingerprintRecordSchema,
  ProviderReadinessEvaluation: ProviderReadinessEvaluationSchema,
  ProviderAdapterDescriptor: ProviderAdapterDescriptorSchema,
} as const;

export type ProvSchemaName = keyof typeof PROV_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. Throws ZodError on failure. */
export function parseProvSchema<T extends ProvSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof PROV_SCHEMAS)[T]> {
  return PROV_SCHEMAS[name].parse(payload) as z.infer<(typeof PROV_SCHEMAS)[T]>;
}
