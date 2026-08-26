/**
 * Versioned Zod schemas mirroring the provider lifecycle contracts — the
 * manifest schemaRefs for FR-PROV-001…010 (`packages/shared-schemas/src/prov.ts`).
 *
 * Enforces:
 *   - §15.3 Operation definitions and capability/cost classes
 *   - §12.11 Lifecycle states and legal transitions
 *   - §15.4 Health statuses
 *   - FR-PROV-002 Verification kinds, sources, records, and TTL configurations
 *   - FR-PROV-003 Time-bounded migration exceptions with replacement plans
 *   - FR-PROV-008 Response quarantine classes and metadata findings
 *   - FR-PROV-009 Sixteen-field rights matrices, changes, artifacts, and actions
 *   - FR-PROV-010 Six fingerprint kinds and empirical dependence states
 *
 * Unknown keys are rejected (`.strict()`) on all structured objects — fail-closed
 * extends to record shape.
 */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';
import { KeyedHashSchema } from './sec.ts';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const PROV_SCHEMA_REGISTRY_VERSION = 1;

// ---------------------------------------------------------------------------
// §12.11 & FR-PROV-001: Lifecycle States and Legal Transitions
// ---------------------------------------------------------------------------

/**
 * §12.11 Provider operation lifecycle states:
 * DISCOVERED -> VERIFIED -> ACTIVE <-> DEGRADED -> DEPRECATED / BLOCKED / REMOVED
 */
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

export const ALL_PROVIDER_LIFECYCLE_STATES = ProviderLifecycleStateSchema.options;

/**
 * Legal transition graph per §12.11 and package specification:
 * - DISCOVERED -> VERIFIED, BLOCKED, REMOVED
 * - VERIFIED -> ACTIVE, DEGRADED, DEPRECATED, BLOCKED, REMOVED
 * - ACTIVE -> DEGRADED, DEPRECATED, BLOCKED, REMOVED
 * - DEGRADED -> ACTIVE, DEPRECATED, BLOCKED, REMOVED
 * - DEPRECATED -> BLOCKED, REMOVED
 * - BLOCKED -> VERIFIED, ACTIVE, REMOVED
 * - REMOVED -> terminal (no transitions allowed)
 */
export const LEGAL_LIFECYCLE_TRANSITIONS: Readonly<
  Record<ProviderLifecycleState, readonly ProviderLifecycleState[]>
> = {
  DISCOVERED: ['VERIFIED', 'BLOCKED', 'REMOVED'],
  VERIFIED: ['ACTIVE', 'DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  ACTIVE: ['DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEGRADED: ['ACTIVE', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEPRECATED: ['BLOCKED', 'REMOVED'],
  BLOCKED: ['VERIFIED', 'ACTIVE', 'REMOVED'],
  REMOVED: [],
} as const;

/** Validate whether a transition from `fromState` to `toState` is legal. */
export function isLegalLifecycleTransition(
  fromState: ProviderLifecycleState,
  toState: ProviderLifecycleState,
): boolean {
  if (fromState === toState) return true; // idempotent self-transition
  const targets = LEGAL_LIFECYCLE_TRANSITIONS[fromState];
  return targets ? targets.includes(toState) : false;
}

/** Transition reason classes for the append-only event ledger. */
export const ProviderLifecycleReasonClassSchema = z.enum([
  'INITIAL_DISCOVERY',
  'VERIFICATION_PASSED',
  'ACTIVATION',
  'TTL_EXPIRED',
  'PROBE_FAILED',
  'PROBE_RESTORED',
  'REVERIFIED',
  'DEPRECATION_ANNOUNCED',
  'SUNSET_REACHED',
  'POLICY_VIOLATION',
  'RIGHTS_REVOKED',
  'SECURITY_QUARANTINE',
  'OPERATIONAL_BLOCK',
  'UNBLOCKED',
  'PERMANENT_REMOVAL',
  'MANUAL_OVERRIDE',
]);
export type ProviderLifecycleReasonClass = z.infer<typeof ProviderLifecycleReasonClassSchema>;

/** Append-only lifecycle transition event record. */
export const ProviderLifecycleEventSchema = z
  .object({
    eventId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    fromState: ProviderLifecycleStateSchema,
    toState: ProviderLifecycleStateSchema,
    reasonClass: ProviderLifecycleReasonClassSchema,
    reasonDetail: z.string().max(1000).optional().nullable(),
    actor: z.string().min(1),
    occurredAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)),
    idempotencyKey: z.string().min(1),
  })
  .strict()
  .refine((v) => isLegalLifecycleTransition(v.fromState, v.toState), {
    message: 'illegal lifecycle state transition',
  });
export type ProviderLifecycleEvent = z.infer<typeof ProviderLifecycleEventSchema>;

// ---------------------------------------------------------------------------
// §15.4 & FR-PROV-001: Provider Health Statuses
// ---------------------------------------------------------------------------

/** §15.4 Health vocabulary tracked per operation/endpoint/plan. */
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

export const ALL_PROVIDER_HEALTH_STATUSES = ProviderHealthStatusSchema.options;

// ---------------------------------------------------------------------------
// §15.2: Cost and Capability Classes
// ---------------------------------------------------------------------------

/** §15.2 Cost class assigned to every external operation. */
export const ProviderCostClassSchema = z.enum([
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
]);
export type ProviderCostClass = z.infer<typeof ProviderCostClassSchema>;

/** §15.2 Capability class assigned to every operation. */
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

/** Prohibited capability classes that can NEVER be registered or activated. */
export const PROHIBITED_PROVIDER_CAPABILITY_CLASSES = [
  'PROHIBITED_TRANSACTION_BUILD',
  'PROHIBITED_SIGN',
  'PROHIBITED_SUBMIT',
  'PROHIBITED_CUSTODY',
] as const;

export function isProhibitedCapabilityClass(cap: string): boolean {
  return (PROHIBITED_PROVIDER_CAPABILITY_CLASSES as readonly string[]).includes(cap);
}

// ---------------------------------------------------------------------------
// §15.3 & FR-PROV-001: Operation Definitions and Dependencies
// ---------------------------------------------------------------------------

export const SupportedProgramSchema = z
  .object({
    programId: z.string().min(1),
    versions: z.array(z.string().min(1)),
  })
  .strict();
export type SupportedProgram = z.infer<typeof SupportedProgramSchema>;

export const BatchCapabilitySchema = z
  .object({
    maxEntities: z.number().int().positive(),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();
export type BatchCapability = z.infer<typeof BatchCapabilitySchema>;

/** Authoritative definition of an external provider operation (§15.3). */
export const ProviderOperationDefinitionSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    capabilityClass: ProviderCapabilityClassSchema,
    supportedChains: z.array(z.string().min(1)),
    supportedPrograms: z.array(SupportedProgramSchema).optional(),
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
    estimatedQuotaUnits: z.number().int().nonnegative(),
    quotaResetPolicyId: z.string().min(1),
    batchCapability: BatchCapabilitySchema.optional(),
    minimumCandidateStage: z.string().min(1).optional(),
    protectedReserveEligible: z.boolean(),
    allowedInStrictFree: z.boolean(),
    paidFallbackAllowed: z.boolean(),
    deprecatedAt: UtcTimestampSchema.optional().nullable(),
    sunsetAt: UtcTimestampSchema.optional().nullable(),
    replacementOperationId: z.string().min(1).optional().nullable(),
    verificationExpiresAt: UtcTimestampSchema,
    forbiddenOutputFields: z.array(z.string().min(1)),
    negativeCapabilities: z.array(z.string().min(1)),
  })
  .strict();
export type ProviderOperationDefinition = z.infer<typeof ProviderOperationDefinitionSchema>;

/** Registry row projection with lifecycle state and verification timestamps. */
export const ProviderOperationRecordSchema = ProviderOperationDefinitionSchema.extend({
  currentState: ProviderLifecycleStateSchema,
  lastDocumentationVerifiedAt: UtcTimestampSchema.optional().nullable(),
  lastLiveProbeAt: UtcTimestampSchema.optional().nullable(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
}).strict();
export type ProviderOperationRecord = z.infer<typeof ProviderOperationRecordSchema>;

/** First-class consumer kinds referencing provider operations (§15.4). */
export const OperationConsumerKindSchema = z.enum([
  'FEATURE',
  'TOOL',
  'EXPORT',
  'ALERT_DERIVATIVE',
]);
export type OperationConsumerKind = z.infer<typeof OperationConsumerKindSchema>;

/** First-class affected feature/tool dependency registration. */
export const ProviderOperationDependencySchema = z
  .object({
    dependencyId: z.string().min(1),
    consumerKind: OperationConsumerKindSchema,
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
// FR-PROV-002: Verification Kinds, Records, and TTL Configs
// ---------------------------------------------------------------------------

/** Nine verification kinds: 8 from FR-PROV-002 text + live probe from FR-PROV-001. */
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

export const ALL_PROVIDER_VERIFICATION_KINDS = ProviderVerificationKindSchema.options;

/** Verification sources per AC-270. */
export const VerificationSourceSchema = z.enum(['OFFICIAL_DOC', 'LIVE_CONTRACT']);
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

/** Verification outcome status. */
export const VerificationOutcomeSchema = z.enum(['PASSED', 'FAILED']);
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

/** One durable verification record with evidence pointers and expiry. */
export const ProviderVerificationRecordSchema = z
  .object({
    recordId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    kind: ProviderVerificationKindSchema,
    source: VerificationSourceSchema,
    outcome: VerificationOutcomeSchema,
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)),
    details: z.string().max(1000).optional().nullable(),
  })
  .strict()
  .refine((v) => v.expiresAt >= v.verifiedAt, {
    message: 'expiresAt must not be earlier than verifiedAt',
  });
export type ProviderVerificationRecord = z.infer<typeof ProviderVerificationRecordSchema>;

/** Per-kind and per-provider TTL configuration. */
export const ProviderTtlConfigSchema = z
  .object({
    configId: z.string().min(1),
    providerId: z.string().min(1).optional().nullable(),
    operationId: z.string().min(1).optional().nullable(),
    kind: ProviderVerificationKindSchema,
    ttlSeconds: z.number().int().positive(),
    configuredAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema.optional().nullable(),
  })
  .strict();
export type ProviderTtlConfig = z.infer<typeof ProviderTtlConfigSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-003: Time-Bounded Migration Exceptions with Replacement Plans
// ---------------------------------------------------------------------------

/** Time-bounded migration exception authorizing active use of deprecated operations. */
export const ProviderMigrationExceptionSchema = z
  .object({
    exceptionId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    approver: z.string().min(1),
    replacementPlanRef: z.string().min(1),
    replacementOperationId: z.string().min(1).optional().nullable(),
    reason: z.string().min(1),
    createdAt: UtcTimestampSchema,
    exceptionExpiresAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.optional().nullable(),
  })
  .strict()
  .refine((v) => v.exceptionExpiresAt > v.createdAt, {
    message: 'exceptionExpiresAt must be strictly greater than createdAt',
  });
export type ProviderMigrationException = z.infer<typeof ProviderMigrationExceptionSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-008: Quarantine Classes and Findings (Metadata-Only Persistence)
// ---------------------------------------------------------------------------

/** Five malicious-response detection classes per FR-PROV-008. */
export const ResponseQuarantineClassSchema = z.enum([
  'TRANSACTION_PAYLOAD',
  'SIGNING_REQUEST',
  'EXECUTABLE_INSTRUCTION',
  'PRIVATE_KEY_FIELD',
  'UNEXPECTED_WRITE_CAPABILITY',
]);
export type ResponseQuarantineClass = z.infer<typeof ResponseQuarantineClassSchema>;

export const ALL_RESPONSE_QUARANTINE_CLASSES = ResponseQuarantineClassSchema.options;

/**
 * Metadata-only quarantine record. Persists hashes, paths, sizes, and audit refs;
 * NEVER persists payload bodies or private key material (Constitution XV).
 */
export const ResponseQuarantineFindingSchema = z
  .object({
    findingId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    detectedClasses: z.array(ResponseQuarantineClassSchema).min(1),
    fieldPaths: z.array(z.string().min(1)),
    payloadSha256: KeyedHashSchema,
    byteSize: z.number().int().nonnegative(),
    disposition: z.literal('REJECTED'),
    auditReference: z.string().min(1),
    modelContextExclusion: z.literal('ENFORCED'),
    quarantinedAt: UtcTimestampSchema,
    details: z.string().max(1000).optional().nullable(),
  })
  .strict();
export type ResponseQuarantineFinding = z.infer<typeof ResponseQuarantineFindingSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-009: Sixteen-Field Rights Matrices, Changes, Artifacts, and Actions
// ---------------------------------------------------------------------------

/** Uses that can be individually permitted or prohibited by rights policies. */
export const RightsUseKindSchema = z.enum([
  'COMMERCIAL_USE',
  'PERSONAL_RESEARCH',
  'CACHE',
  'RAW_RETENTION',
  'DERIVED_FEATURES',
  'MODEL_TRAINING',
  'REDISTRIBUTION',
  'PUBLIC_ALERT_DERIVATIVE',
  'RAW_EXPORT',
]);
export type RightsUseKind = z.infer<typeof RightsUseKindSchema>;

export const ALL_RIGHTS_USE_KINDS = RightsUseKindSchema.options;

/** Sixteen-field data rights matrix declaration per §15.6. */
export const ProviderRightsMatrixSchema = z
  .object({
    matrixId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    rightsVersion: z.string().min(1),
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
  .refine((v) => v.verificationExpiresAt >= v.verifiedAt, {
    message: 'verificationExpiresAt must not be earlier than verifiedAt',
  });
export type ProviderRightsMatrix = z.infer<typeof ProviderRightsMatrixSchema>;

/** Rights change record capturing newly-prohibited use paths. */
export const ProviderRightsChangeSchema = z
  .object({
    changeId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    fromRightsVersion: z.string().min(1),
    toRightsVersion: z.string().min(1),
    newlyProhibitedUses: z.array(RightsUseKindSchema),
    changedAt: UtcTimestampSchema,
    reason: z.string().min(1),
  })
  .strict();
export type ProviderRightsChange = z.infer<typeof ProviderRightsChangeSchema>;

/** State of a provider-derived persisted artifact. */
export const ProviderArtifactStateSchema = z.enum(['ACTIVE', 'QUARANTINED', 'RETIRED']);
export type ProviderArtifactState = z.infer<typeof ProviderArtifactStateSchema>;

/** Provider-derived artifact registered for rights lifecycle management. */
export const ProviderArtifactRecordSchema = z
  .object({
    artifactId: z.string().min(1),
    objectRef: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    rightsVersion: z.string().min(1),
    state: ProviderArtifactStateSchema,
    capturedAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type ProviderArtifactRecord = z.infer<typeof ProviderArtifactRecordSchema>;

/** Action taken on an artifact following a rights tightening. */
export const RightsChangeActionTypeSchema = z.enum(['QUARANTINE', 'RETIRE']);
export type RightsChangeActionType = z.infer<typeof RightsChangeActionTypeSchema>;

/** Durable action record for an artifact affected by a rights change. */
export const ProviderRightsChangeActionSchema = z
  .object({
    actionId: z.string().min(1),
    changeId: z.string().min(1),
    artifactId: z.string().min(1),
    actionType: RightsChangeActionTypeSchema,
    executedAt: UtcTimestampSchema,
    details: z.string().max(1000).optional().nullable(),
  })
  .strict();
export type ProviderRightsChangeAction = z.infer<typeof ProviderRightsChangeActionSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-010: Six Fingerprint Kinds & Empirical Dependence
// ---------------------------------------------------------------------------

/** Six source fingerprint kinds per §15.7. */
export const SourceFingerprintKindSchema = z.enum([
  'UPSTREAM_LINEAGE',
  'VALUE_CORRELATION',
  'TIMING_BEHAVIOR',
  'OUTAGE_CORRELATION',
  'SCHEMA_CHARACTERISTICS',
  'FIRST_SEEN_BEHAVIOR',
]);
export type SourceFingerprintKind = z.infer<typeof SourceFingerprintKindSchema>;

export const ALL_SOURCE_FINGERPRINT_KINDS = SourceFingerprintKindSchema.options;

/** Empirical dependence vocabulary per §15.7. */
export const ProviderDependenceStateSchema = z.enum([
  'INDEPENDENT_WITHIN_TESTED_SCOPE',
  'PARTIALLY_DEPENDENT',
  'HIGHLY_DEPENDENT',
  'UNKNOWN_DEPENDENCE',
  'SAME_UPSTREAM',
]);
export type ProviderDependenceState = z.infer<typeof ProviderDependenceStateSchema>;

/** Captured source fingerprint record for empirical dependence estimation. */
export const SourceFingerprintRecordSchema = z
  .object({
    fingerprintId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    fingerprintKind: SourceFingerprintKindSchema,
    fingerprintPayload: z.record(z.string(), z.unknown()),
    payloadSha256: KeyedHashSchema,
    computedAt: UtcTimestampSchema,
    estimatorInputRefs: z.array(z.string().min(1)),
  })
  .strict();
export type SourceFingerprintRecord = z.infer<typeof SourceFingerprintRecordSchema>;

// ---------------------------------------------------------------------------
// AC-272: Provider Activation Readiness Status
// ---------------------------------------------------------------------------

export const ProviderReadinessDecisionSchema = z.enum(['ELIGIBLE', 'BLOCKED']);
export type ProviderReadinessDecision = z.infer<typeof ProviderReadinessDecisionSchema>;

/** Provider-side readiness report evaluated over rights, lifecycle, and capabilities. */
export const ProviderReadinessStatusSchema = z
  .object({
    readiness: ProviderReadinessDecisionSchema,
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    evaluatedAt: UtcTimestampSchema,
    blockers: z.array(z.string().min(1)),
    reason: z.string().max(1000).optional().nullable(),
  })
  .strict();
export type ProviderReadinessStatus = z.infer<typeof ProviderReadinessStatusSchema>;

// ---------------------------------------------------------------------------
// Versioned Schema Registry
// ---------------------------------------------------------------------------

export const PROV_SCHEMAS = {
  ProviderLifecycleEvent: ProviderLifecycleEventSchema,
  ProviderOperationDefinition: ProviderOperationDefinitionSchema,
  ProviderOperationRecord: ProviderOperationRecordSchema,
  ProviderOperationDependency: ProviderOperationDependencySchema,
  ProviderVerificationRecord: ProviderVerificationRecordSchema,
  ProviderTtlConfig: ProviderTtlConfigSchema,
  ProviderMigrationException: ProviderMigrationExceptionSchema,
  ResponseQuarantineFinding: ResponseQuarantineFindingSchema,
  ProviderRightsMatrix: ProviderRightsMatrixSchema,
  ProviderRightsChange: ProviderRightsChangeSchema,
  ProviderArtifactRecord: ProviderArtifactRecordSchema,
  ProviderRightsChangeAction: ProviderRightsChangeActionSchema,
  SourceFingerprintRecord: SourceFingerprintRecordSchema,
  ProviderReadinessStatus: ProviderReadinessStatusSchema,
} as const;

export type ProvSchemaName = keyof typeof PROV_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. Throws ZodError on failure. */
export function parseProvSchema<T extends ProvSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof PROV_SCHEMAS)[T]> {
  return PROV_SCHEMAS[name].parse(payload) as z.infer<(typeof PROV_SCHEMAS)[T]>;
}
