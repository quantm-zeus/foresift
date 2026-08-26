/**
 * Versioned Zod schemas mirroring the provider-operation lifecycle contracts —
 * the manifest schemaRefs for FR-PROV-001…010 (`packages/shared-schemas/src/prov.ts`).
 *
 * Covers:
 * - §15.3 Provider operation definitions, dependencies, capabilities, cost classes
 * - §12.11 Lifecycle states and legal transitions graph
 * - §15.4 Provider health status vocabulary
 * - FR-PROV-002 Verification kinds, records, sources, and TTL configurations
 * - FR-PROV-003 Migration exceptions and replacement plans
 * - FR-PROV-008 Response quarantine classes, findings, and metadata-only records
 * - FR-PROV-009 Sixteen-field data rights matrices, changes, artifact states, and actions
 * - FR-PROV-010 Source fingerprints and empirical dependence states
 *
 * Unknown keys are rejected (`.strict()`) — fail-closed extends to record shape.
 */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';
import { KeyedHashSchema } from './sec.ts';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const PROV_SCHEMA_REGISTRY_VERSION = 1;

// ---------------------------------------------------------------------------
// §15.2 Cost and capability classes
// ---------------------------------------------------------------------------

/** §15.2 Cost class closed vocabulary. */
export const ProviderCostClassSchema = z.enum([
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
]);
export type ProviderCostClass = z.infer<typeof ProviderCostClassSchema>;

/** §15.2 Capability class closed vocabulary. */
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

/** Prohibited capability classes that can never be enabled by configuration (§41.1, INV-001). */
export const PROHIBITED_CAPABILITY_CLASSES = [
  'PROHIBITED_TRANSACTION_BUILD',
  'PROHIBITED_SIGN',
  'PROHIBITED_SUBMIT',
  'PROHIBITED_CUSTODY',
] as const;
export type ProhibitedCapabilityClass = (typeof PROHIBITED_CAPABILITY_CLASSES)[number];

export function isProhibitedCapabilityClass(cls: string): boolean {
  return (PROHIBITED_CAPABILITY_CLASSES as readonly string[]).includes(cls);
}

// ---------------------------------------------------------------------------
// §12.11 Lifecycle states and legal transitions
// ---------------------------------------------------------------------------

/** §12.11 Seven-state provider operation lifecycle alphabet. */
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

/** Legal transition graph for provider operation lifecycle (§12.11). */
export const LEGAL_LIFECYCLE_TRANSITIONS: Record<
  ProviderLifecycleState,
  readonly ProviderLifecycleState[]
> = {
  DISCOVERED: ['VERIFIED', 'DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  VERIFIED: ['ACTIVE', 'DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  ACTIVE: ['DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEGRADED: ['ACTIVE', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEPRECATED: ['BLOCKED', 'REMOVED'],
  BLOCKED: ['REMOVED', 'DEGRADED', 'VERIFIED'],
  REMOVED: [],
};

export function isLegalLifecycleTransition(
  from: ProviderLifecycleState,
  to: ProviderLifecycleState,
): boolean {
  if (from === to) return false;
  return LEGAL_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Lifecycle transition reason class vocabulary. */
export const LifecycleTransitionReasonClassSchema = z.enum([
  'INITIAL_DISCOVERY',
  'VERIFICATION_PASSED',
  'VERIFICATION_REFRESH',
  'ACTIVATION',
  'TTL_EXPIRED',
  'PROBE_FAILED',
  'SCHEMA_DRIFT',
  'PLAN_UNVERIFIED',
  'RIGHTS_UNVERIFIED',
  'DEPRECATION_NOTICE',
  'SUNSET_REACHED',
  'SECURITY_BLOCK',
  'POLICY_VIOLATION',
  'MANUAL_INTERVENTION',
  'REMOVED_BY_OPERATOR',
  'RESTORE_ACTIVE',
  'DEGRADE_HEALTH',
]);
export type LifecycleTransitionReasonClass = z.infer<typeof LifecycleTransitionReasonClassSchema>;

/** Append-only lifecycle transition event record (`prov_lifecycle_events`). */
export const LifecycleTransitionEventSchema = z
  .object({
    eventId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    fromState: ProviderLifecycleStateSchema,
    toState: ProviderLifecycleStateSchema,
    reasonClass: LifecycleTransitionReasonClassSchema,
    actor: z.string().min(1),
    occurredAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)),
    idempotencyKey: z.string().min(1),
  })
  .strict()
  .refine((v) => isLegalLifecycleTransition(v.fromState, v.toState), {
    message: 'illegal lifecycle transition between states',
  });
export type LifecycleTransitionEvent = z.infer<typeof LifecycleTransitionEventSchema>;

// ---------------------------------------------------------------------------
// §15.4 Health statuses
// ---------------------------------------------------------------------------

/** §15.4 Provider health status vocabulary. */
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

// ---------------------------------------------------------------------------
// §15.1 Provider groups and records
// ---------------------------------------------------------------------------

export const ProviderGroupSchema = z.enum([
  'DEX_SCREENER',
  'GMGN',
  'GOPLUS',
  'HONEYPOT_IS',
  'COINGECKO_ONCHAIN',
  'HELIUS',
  'ALCHEMY',
  'DEFILLAMA',
  'MORALIS',
  'SANTIMENT',
  'LUNARCRUSH',
  'SOLANA_RPC',
  'DEX_LAUNCHPAD_DECODER',
  'FIRST_PARTY_COLLECTOR',
  'CUSTOM',
]);
export type ProviderGroup = z.infer<typeof ProviderGroupSchema>;

export const ProviderRecordSchema = z
  .object({
    providerId: z.string().min(1),
    displayName: z.string().min(1),
    group: ProviderGroupSchema,
    disabledByDefault: z.boolean().default(true),
    documentationUrl: z.string().url().optional(),
    registeredAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema.optional(),
  })
  .strict();
export type ProviderRecord = z.infer<typeof ProviderRecordSchema>;

// ---------------------------------------------------------------------------
// §15.3 Operation definitions and dependencies
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

/** Authoritative §15.3 ProviderOperationDefinition schema. */
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
    deprecatedAt: UtcTimestampSchema.optional(),
    sunsetAt: UtcTimestampSchema.optional(),
    replacementOperationId: z.string().min(1).optional(),
    verificationExpiresAt: UtcTimestampSchema,
    forbiddenOutputFields: z.array(z.string().min(1)),
    negativeCapabilities: z.array(z.string().min(1)),
  })
  .strict()
  .refine((v) => !v.sunsetAt || !v.deprecatedAt || v.sunsetAt >= v.deprecatedAt, {
    message: 'sunsetAt must be at or after deprecatedAt',
  });
export type ProviderOperationDefinition = z.infer<typeof ProviderOperationDefinitionSchema>;

/** First-class affected-features consumer kinds. */
export const ProviderDependencyConsumerKindSchema = z.enum([
  'FEATURE',
  'TOOL',
  'EXPORT',
  'ALERT_DERIVATIVE',
]);
export type ProviderDependencyConsumerKind = z.infer<typeof ProviderDependencyConsumerKindSchema>;

/** Affected-features registry row (`prov_operation_dependencies`). */
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
// FR-PROV-002: Verification kinds, records, sources, and TTL configurations
// ---------------------------------------------------------------------------

/** Nine verification kinds (eight requirement-named kinds + LIVE_PROBE). */
export const VerificationKindSchema = z.enum([
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
export type VerificationKind = z.infer<typeof VerificationKindSchema>;

export const ALL_VERIFICATION_KINDS: readonly VerificationKind[] = [
  'DOCUMENTATION',
  'PRICING_PLAN',
  'QUOTA',
  'RIGHTS',
  'SCHEMA',
  'ENDPOINT',
  'AUTHENTICATION',
  'DEPRECATION',
  'LIVE_PROBE',
];

/** AC-270 Verification sources: official documentation and live contract. */
export const VerificationSourceSchema = z.enum(['OFFICIAL_DOC', 'LIVE_CONTRACT']);
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

export const VerificationOutcomeSchema = z.enum(['PASSED', 'FAILED']);
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

/** Durable verification record (`prov_verification_records`). */
export const VerificationRecordSchema = z
  .object({
    recordId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    kind: VerificationKindSchema,
    source: VerificationSourceSchema,
    outcome: VerificationOutcomeSchema,
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)),
    notes: z.string().optional(),
  })
  .strict()
  .refine((v) => v.expiresAt >= v.verifiedAt, {
    message: 'expiresAt must be at or after verifiedAt',
  });
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;

/** Per-kind and per-provider TTL configuration. */
export const VerificationTtlConfigSchema = z
  .object({
    providerId: z.string().min(1).optional(),
    kind: VerificationKindSchema,
    ttlSeconds: z.number().int().positive(),
    gracePeriodSeconds: z.number().int().nonnegative().default(0),
  })
  .strict();
export type VerificationTtlConfig = z.infer<typeof VerificationTtlConfigSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-003: Migration exceptions with replacement plans
// ---------------------------------------------------------------------------

export const ReplacementPlanStatusSchema = z.enum([
  'PROPOSED',
  'APPROVED',
  'IN_PROGRESS',
  'COMPLETED',
  'SUPERSEDED',
]);
export type ReplacementPlanStatus = z.infer<typeof ReplacementPlanStatusSchema>;

/** Replacement plan bound to a migration exception. */
export const ReplacementPlanSchema = z
  .object({
    planId: z.string().min(1),
    targetOperationId: z.string().min(1),
    targetProviderId: z.string().min(1).optional(),
    targetVersion: z.string().min(1).optional(),
    milestoneTarget: z.string().min(1),
    migrationDeadline: UtcTimestampSchema,
    status: ReplacementPlanStatusSchema,
  })
  .strict();
export type ReplacementPlan = z.infer<typeof ReplacementPlanSchema>;

/** Time-bounded migration exception record (`prov_migration_exceptions`). */
export const MigrationExceptionSchema = z
  .object({
    exceptionId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    approvedBy: z.string().min(1),
    reason: z.string().min(1),
    replacementPlan: ReplacementPlanSchema,
    createdAt: UtcTimestampSchema,
    exceptionExpiresAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => v.exceptionExpiresAt > v.createdAt, {
    message: 'exceptionExpiresAt must be after createdAt',
  });
export type MigrationException = z.infer<typeof MigrationExceptionSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-008: Quarantine classes, findings, and metadata-only records
// ---------------------------------------------------------------------------

/** Five malicious-response detection classes (FR-PROV-008, AC-271). */
export const QuarantineDetectionClassSchema = z.enum([
  'TRANSACTION_PAYLOAD',
  'SIGNING_REQUEST',
  'EXECUTABLE_INSTRUCTION',
  'PRIVATE_KEY_FIELD',
  'UNEXPECTED_WRITE_CAPABILITY',
]);
export type QuarantineDetectionClass = z.infer<typeof QuarantineDetectionClassSchema>;

export const ALL_QUARANTINE_DETECTION_CLASSES: readonly QuarantineDetectionClass[] = [
  'TRANSACTION_PAYLOAD',
  'SIGNING_REQUEST',
  'EXECUTABLE_INSTRUCTION',
  'PRIVATE_KEY_FIELD',
  'UNEXPECTED_WRITE_CAPABILITY',
];

/** Specific scanner finding within a provider response. */
export const QuarantineFindingSchema = z
  .object({
    findingId: z.string().min(1),
    detectedClass: QuarantineDetectionClassSchema,
    fieldPath: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();
export type QuarantineFinding = z.infer<typeof QuarantineFindingSchema>;

/**
 * Metadata-only response quarantine record (`prov_response_quarantine`).
 * NOTE: Persists detection metadata, hashes, field paths, and byte sizes —
 * structurally NEVER persists payload or key material (INV-001, INV-003, Constitution XV).
 */
export const ResponseQuarantineRecordSchema = z
  .object({
    quarantineId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    detectedClasses: z.array(QuarantineDetectionClassSchema).min(1),
    fieldPaths: z.array(z.string().min(1)),
    payloadSha256: KeyedHashSchema,
    byteSize: z.number().int().nonnegative(),
    disposition: z.literal('REJECTED'),
    auditRef: z.string().min(1),
    modelContextExclusion: z.literal('ENFORCED'),
    quarantinedAt: UtcTimestampSchema,
  })
  .strict();
export type ResponseQuarantineRecord = z.infer<typeof ResponseQuarantineRecordSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-009: Sixteen-field rights matrices, changes, artifact states, actions
// ---------------------------------------------------------------------------

const baseRightsMatrixShape = {
  commercialUseAllowed: z.boolean(),
  personalResearchAllowed: z.boolean(),
  cacheAllowed: z.boolean(),
  maximumCacheDurationSeconds: z.number().int().nonnegative().nullable(),
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
};

/**
 * Authoritative sixteen-field data rights matrix (§15.6).
 *
 * All sixteen fields:
 * 1.  commercialUseAllowed (commercial_use_allowed)
 * 2.  personalResearchAllowed (personal_research_allowed)
 * 3.  cacheAllowed (cache_allowed)
 * 4.  maximumCacheDurationSeconds (maximum_cache_duration)
 * 5.  rawRetentionAllowed (raw_retention_allowed)
 * 6.  derivedFeaturesAllowed (derived_features_allowed)
 * 7.  modelTrainingAllowed (model_training_allowed)
 * 8.  redistributionAllowed (redistribution_allowed)
 * 9.  publicAlertDerivativeAllowed (public_alert_derivative_allowed)
 * 10. attributionRequired (attribution_required)
 * 11. userByokRequired (user_byok_required)
 * 12. rawExportAllowed (raw_export_allowed)
 * 13. jurisdictionRestrictions (jurisdiction_restrictions)
 * 14. termsVersion (terms_version)
 * 15. verifiedAt (verified_at)
 * 16. verificationExpiresAt (verification_expires_at)
 */
export const ProviderRightsMatrixSchema = z
  .object(baseRightsMatrixShape)
  .strict()
  .refine((v) => v.verificationExpiresAt >= v.verifiedAt, {
    message: 'verificationExpiresAt must be at or after verifiedAt',
  })
  .refine((v) => v.cacheAllowed || v.maximumCacheDurationSeconds === null, {
    message: 'maximumCacheDurationSeconds must be null when cacheAllowed is false',
  });
export type ProviderRightsMatrix = z.infer<typeof ProviderRightsMatrixSchema>;

/** Fully identified versioned rights declaration (`prov_rights_declarations`). */
export const ProviderRightsDeclarationSchema = z
  .object({
    ...baseRightsMatrixShape,
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    rightsVersion: z.number().int().positive(),
  })
  .strict()
  .refine((v) => v.verificationExpiresAt >= v.verifiedAt, {
    message: 'verificationExpiresAt must be at or after verifiedAt',
  })
  .refine((v) => v.cacheAllowed || v.maximumCacheDurationSeconds === null, {
    message: 'maximumCacheDurationSeconds must be null when cacheAllowed is false',
  });
export type ProviderRightsDeclaration = z.infer<typeof ProviderRightsDeclarationSchema>;

/** Controlled usage paths that may become restricted by rights updates. */
export const RightsUsePathSchema = z.enum([
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
export type RightsUsePath = z.infer<typeof RightsUsePathSchema>;

/** Versioned rights change diff record (`prov_rights_changes`). */
export const ProviderRightsChangeSchema = z
  .object({
    changeId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    fromRightsVersion: z.number().int().nonnegative(),
    toRightsVersion: z.number().int().positive(),
    newlyProhibitedUses: z.array(RightsUsePathSchema),
    changedAt: UtcTimestampSchema,
    actor: z.string().min(1),
    auditRef: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => v.toRightsVersion > v.fromRightsVersion, {
    message: 'toRightsVersion must be greater than fromRightsVersion',
  });
export type ProviderRightsChange = z.infer<typeof ProviderRightsChangeSchema>;

/** Artifact lifecycle state in rights management (`prov_provider_artifacts`). */
export const ProviderArtifactStateSchema = z.enum(['ACTIVE', 'QUARANTINED', 'RETIRED']);
export type ProviderArtifactState = z.infer<typeof ProviderArtifactStateSchema>;

/** Registered provider-derived artifact record (`prov_provider_artifacts`). */
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
    updatedAt: UtcTimestampSchema.optional(),
  })
  .strict();
export type ProviderArtifactRecord = z.infer<typeof ProviderArtifactRecordSchema>;

/** Action to perform on an artifact when rights tighten (`prov_rights_change_actions`). */
export const RightsChangeActionTypeSchema = z.enum(['QUARANTINE', 'RETIRE']);
export type RightsChangeActionType = z.infer<typeof RightsChangeActionTypeSchema>;

/** Action execution record for an affected artifact (`prov_rights_change_actions`). */
export const ProviderRightsChangeActionSchema = z
  .object({
    actionId: z.string().min(1),
    changeId: z.string().min(1),
    artifactId: z.string().min(1),
    action: RightsChangeActionTypeSchema,
    reason: z.string().min(1),
    executedAt: UtcTimestampSchema,
    actor: z.string().min(1),
  })
  .strict();
export type ProviderRightsChangeAction = z.infer<typeof ProviderRightsChangeActionSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-010: Six source fingerprint kinds and dependence states
// ---------------------------------------------------------------------------

/** Six source fingerprint kinds (§15.7, FR-PROV-010). */
export const SourceFingerprintKindSchema = z.enum([
  'UPSTREAM_LINEAGE',
  'VALUE_CORRELATION',
  'TIMING_BEHAVIOR',
  'OUTAGE_CORRELATION',
  'SCHEMA_CHARACTERISTICS',
  'FIRST_SEEN_BEHAVIOR',
]);
export type SourceFingerprintKind = z.infer<typeof SourceFingerprintKindSchema>;

export const ALL_SOURCE_FINGERPRINT_KINDS: readonly SourceFingerprintKind[] = [
  'UPSTREAM_LINEAGE',
  'VALUE_CORRELATION',
  'TIMING_BEHAVIOR',
  'OUTAGE_CORRELATION',
  'SCHEMA_CHARACTERISTICS',
  'FIRST_SEEN_BEHAVIOR',
];

/** §15.7 Empirical dependence relationship state vocabulary. */
export const ProviderDependenceStateSchema = z.enum([
  'INDEPENDENT_WITHIN_TESTED_SCOPE',
  'PARTIALLY_DEPENDENT',
  'HIGHLY_DEPENDENT',
  'UNKNOWN_DEPENDENCE',
  'SAME_UPSTREAM',
]);
export type ProviderDependenceState = z.infer<typeof ProviderDependenceStateSchema>;

/** Source fingerprint storage record (`prov_source_fingerprints`). */
export const SourceFingerprintRecordSchema = z
  .object({
    fingerprintId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    kind: SourceFingerprintKindSchema,
    canonicalPayload: z.string().min(2),
    payloadSha256: KeyedHashSchema,
    estimatorInputRefs: z.array(z.string().min(1)),
    computedAt: UtcTimestampSchema,
  })
  .strict();
export type SourceFingerprintRecord = z.infer<typeof SourceFingerprintRecordSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-005 & AC-272 Supporting Schemas: Readiness & Adapter Allowlist
// ---------------------------------------------------------------------------

/** AC-272 Provider readiness verdict. */
export const ProviderReadinessVerdictSchema = z.enum(['ELIGIBLE', 'BLOCKED']);
export type ProviderReadinessVerdict = z.infer<typeof ProviderReadinessVerdictSchema>;

/** AC-272 Provider readiness evaluation report. */
export const ProviderReadinessReportSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    verdict: ProviderReadinessVerdictSchema,
    reasons: z.array(z.string().min(1)),
    evaluatedAt: UtcTimestampSchema,
  })
  .strict();
export type ProviderReadinessReport = z.infer<typeof ProviderReadinessReportSchema>;

/** FR-PROV-005 Adapter contract allowlist descriptor. */
export const ProviderAdapterAllowlistSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    scheme: z.enum(['http', 'https']),
    host: z.string().min(1),
    port: z.number().int().positive(),
    pathTemplate: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']),
    contentTypes: z.array(z.string().min(1)),
    allowedRequestFields: z.array(z.string().min(1)),
    responseSchemaId: z.string().min(1),
    redirectPolicy: z.enum(['FOLLOW', 'ERROR', 'MANUAL']).default('ERROR'),
    maxResponseBytes: z.number().int().positive(),
    dnsIpPolicy: z.string().min(1).default('PUBLIC_ONLY'),
  })
  .strict();
export type ProviderAdapterAllowlist = z.infer<typeof ProviderAdapterAllowlistSchema>;

// ---------------------------------------------------------------------------
// Registry (parse-by-name entrypoint mirroring data/sec/dr families)
// ---------------------------------------------------------------------------

export const PROV_SCHEMAS = {
  ProviderCostClass: ProviderCostClassSchema,
  ProviderCapabilityClass: ProviderCapabilityClassSchema,
  ProviderLifecycleState: ProviderLifecycleStateSchema,
  LifecycleTransitionEvent: LifecycleTransitionEventSchema,
  ProviderHealthStatus: ProviderHealthStatusSchema,
  ProviderRecord: ProviderRecordSchema,
  SupportedProgram: SupportedProgramSchema,
  BatchCapability: BatchCapabilitySchema,
  ProviderOperationDefinition: ProviderOperationDefinitionSchema,
  ProviderOperationDependency: ProviderOperationDependencySchema,
  VerificationRecord: VerificationRecordSchema,
  VerificationTtlConfig: VerificationTtlConfigSchema,
  ReplacementPlan: ReplacementPlanSchema,
  MigrationException: MigrationExceptionSchema,
  QuarantineFinding: QuarantineFindingSchema,
  ResponseQuarantineRecord: ResponseQuarantineRecordSchema,
  ProviderRightsMatrix: ProviderRightsMatrixSchema,
  ProviderRightsDeclaration: ProviderRightsDeclarationSchema,
  ProviderRightsChange: ProviderRightsChangeSchema,
  ProviderArtifactRecord: ProviderArtifactRecordSchema,
  ProviderRightsChangeAction: ProviderRightsChangeActionSchema,
  SourceFingerprintRecord: SourceFingerprintRecordSchema,
  ProviderReadinessReport: ProviderReadinessReportSchema,
  ProviderAdapterAllowlist: ProviderAdapterAllowlistSchema,
} as const;

export type ProvSchemaName = keyof typeof PROV_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. Throws ZodError on failure. */
export function parseProvSchema<T extends ProvSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof PROV_SCHEMAS)[T]> {
  return PROV_SCHEMAS[name].parse(payload) as z.infer<(typeof PROV_SCHEMAS)[T]>;
}
