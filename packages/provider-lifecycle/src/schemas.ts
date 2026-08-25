/**
 * Provider-lifecycle Zod schemas — the package-internal authority for the
 * §15 vocabularies and record shapes (FR-PROV-001…010).
 *
 * The manifest's schemaRefs for this family target
 * `packages/shared-schemas/src/prov.ts`, which lands with its owning lane;
 * `packages/shared-schemas/**` is outside THIS package's binding write
 * scopes, so the schemas this engine enforces live here until convergence
 * reconciles the two homes (plan risk table: lifecycle state drift is
 * countered by parity tests asserting graph ↔ SQL CHECK ↔ schema agree).
 *
 * Structural fail-closed rules are encoded as refines; BEHAVIORAL enforcement
 * (freshness windows, exception expiry, transition legality) lives in the
 * engine modules, not here. No field accepts secret material or response
 * payload bytes — quarantine records are metadata-only by construction.
 */
import { z } from 'zod';
import { UtcTimestampSchema } from '@foresift/shared-schemas';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const PROV_SCHEMA_REGISTRY_VERSION = 1;

// --- §12.11 lifecycle states ---------------------------------------------------

/** The seven-state alphabet, in PRD order. */
export const LifecycleStateSchema = z.enum([
  'DISCOVERED',
  'VERIFIED',
  'ACTIVE',
  'DEGRADED',
  'DEPRECATED',
  'BLOCKED',
  'REMOVED',
]);
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

/** One append-only lifecycle transition event (INV-004 reconstructability). */
export const LifecycleEventRecordSchema = z
  .object({
    seq: z.number().int().positive(),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    fromState: LifecycleStateSchema.nullable(),
    toState: LifecycleStateSchema,
    reasonClass: z.string().min(1),
    actor: z.string().min(1),
    occurredAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)),
    idempotencyKey: z.string().min(1),
  })
  .strict();
export type LifecycleEventRecord = z.infer<typeof LifecycleEventRecordSchema>;

/**
 * Closed reason-class vocabulary for guarded transitions. Every append names
 * exactly one; expiry-driven exits from ACTIVE must use `*_EXPIRED` classes
 * so sweeps are distinguishable from operator actions in the ledger.
 */
export const TRANSITION_REASON_CLASSES = [
  'REGISTERED_DISCOVERED',
  'VERIFICATION_PROMOTED',
  'ACTIVATION_APPROVED',
  'DOCUMENTATION_EXPIRED',
  'PRICING_PLAN_EXPIRED',
  'QUOTA_VERIFICATION_EXPIRED',
  'RIGHTS_EXPIRED',
  'SCHEMA_EXPIRED',
  'ENDPOINT_EXPIRED',
  'AUTHENTICATION_EXPIRED',
  'DEPRECATION_EXPIRED',
  'LIVE_PROBE_EXPIRED',
  'HEALTH_INCIDENT',
  'RECOVERY_VERIFIED',
  'DEPRECATION_MARKED',
  'OPERATOR_BLOCK',
  'CAPABILITY_VIOLATION_BLOCK',
  'OPERATOR_REMOVAL',
  'REPLACEMENT_ACTIVATED',
] as const;
export type TransitionReasonClass = (typeof TRANSITION_REASON_CLASSES)[number];

/** Reason classes that MUST only ever accompany an exit from ACTIVE. */
export const EXPIRY_REASON_CLASSES: readonly TransitionReasonClass[] =
  TRANSITION_REASON_CLASSES.filter((r) => r.endsWith('_EXPIRED'));

// --- §15.2 cost & capability classes ---------------------------------------------

export const CostClassSchema = z.enum([
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
]);
export type CostClass = z.infer<typeof CostClassSchema>;

/** Full §15.2 capability-class vocabulary INCLUDING the prohibited classes. */
export const CapabilityClassSchema = z.enum([
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
export type CapabilityClass = z.infer<typeof CapabilityClassSchema>;

/**
 * Prohibited capability classes (§41.1): never representable in SQL truth,
 * never registrable, never enableable by configuration. Registration refuses
 * these OUTRIGHT — they exist in the vocabulary only so validation can name
 * what it refused.
 */
export const PROHIBITED_CAPABILITY_CLASSES: readonly CapabilityClass[] = [
  'PROHIBITED_TRANSACTION_BUILD',
  'PROHIBITED_SIGN',
  'PROHIBITED_SUBMIT',
  'PROHIBITED_CUSTODY',
];

/** Admissible (read-only) capability classes — the SQL CHECK alphabet. */
export const ADMISSIBLE_CAPABILITY_CLASSES: readonly CapabilityClass[] = CapabilityClassSchema.options.filter(
  (c) => !PROHIBITED_CAPABILITY_CLASSES.includes(c as CapabilityClass),
) as readonly CapabilityClass[];

// --- §15.4 health statuses --------------------------------------------------------

export const HealthStatusSchema = z.enum([
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
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

// --- §15.3 operation definition ----------------------------------------------------

const SupportedProgramSchema = z
  .object({ programId: z.string().min(1), versions: z.array(z.string().min(1)).min(1) })
  .strict();

/** Exactly the §15.3 `ProviderOperationDefinition` shape. Strict. */
export const OperationDefinitionSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    capabilityClass: CapabilityClassSchema,
    supportedChains: z.array(z.string().min(1)).min(1),
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
    healthStatus: HealthStatusSchema,
    costClass: CostClassSchema,
    estimatedQuotaUnits: z.number().nonnegative(),
    quotaResetPolicyId: z.string().min(1),
    batchCapability: z
      .object({ maxEntities: z.number().int().positive(), maxBytes: z.number().int().positive().optional() })
      .strict()
      .optional(),
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
  .refine((v) => !PROHIBITED_CAPABILITY_CLASSES.includes(v.capabilityClass), {
    message: 'prohibited capability classes are unrepresentable in the registry',
  });
export type OperationDefinition = z.infer<typeof OperationDefinitionSchema>;

/** Affected-feature dependency registration (§15.4 "affected features"). */
export const ConsumerKindSchema = z.enum(['FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE']);
export type ConsumerKind = z.infer<typeof ConsumerKindSchema>;

export const OperationDependencyRecordSchema = z
  .object({
    dependencyId: z.number().int().positive(),
    consumerKind: ConsumerKindSchema,
    consumerKey: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    criticalField: z.string().min(1).nullable(),
    active: z.boolean(),
    registeredAt: UtcTimestampSchema,
  })
  .strict();
export type OperationDependencyRecord = z.infer<typeof OperationDependencyRecordSchema>;

// --- FR-PROV-002: verification kinds/records/TTL config ----------------------------

/** Eight requirement-named kinds plus LIVE_PROBE (FR-PROV-001 "last live probe"). */
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

export const VerificationSourceSchema = z.enum(['OFFICIAL_DOC', 'LIVE_CONTRACT']);
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

export const VerificationOutcomeSchema = z.enum(['SUCCEEDED', 'FAILED']);
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

export const VerificationRecordSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    kind: VerificationKindSchema,
    source: VerificationSourceSchema,
    outcome: VerificationOutcomeSchema,
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine((v) => v.expiresAt > v.verifiedAt, {
    message: 'verification expiry must be after the verified instant',
  });
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;

/** Per-kind/per-provider TTL configuration row; absence refuses (fail-closed). */
export const VerificationTtlConfigRecordSchema = z
  .object({
    providerId: z.string().min(1),
    kind: VerificationKindSchema,
    ttlSeconds: z.number().int().positive(),
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type VerificationTtlConfigRecord = z.infer<typeof VerificationTtlConfigRecordSchema>;

// --- FR-PROV-003: migration exceptions -----------------------------------------------

export const MigrationExceptionRecordSchema = z
  .object({
    exceptionId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    approver: z.string().min(1),
    replacementPlanRef: z.string().min(1),
    replacementOperationId: z.string().min(1).nullable(),
    grantedAt: UtcTimestampSchema,
    exceptionExpiresAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.nullable(),
    evidenceRefs: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine((v) => v.exceptionExpiresAt > v.grantedAt, {
    message: 'exception expiry must be after the granted instant',
  });
export type MigrationExceptionRecord = z.infer<typeof MigrationExceptionRecordSchema>;

// --- FR-PROV-008: response quarantine ------------------------------------------------

/** The five malicious-response classes of FR-PROV-008. */
export const QuarantineClassSchema = z.enum([
  'TRANSACTION_PAYLOAD',
  'SIGNING_REQUEST',
  'EXECUTABLE_INSTRUCTION',
  'PRIVATE_KEY_FIELD',
  'UNEXPECTED_WRITE_CAPABILITY',
]);
export type QuarantineClass = z.infer<typeof QuarantineClassSchema>;

/** Metadata-only quarantine record — NO payload column exists anywhere. */
export const QuarantineRecordSchema = z
  .object({
    quarantineId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    detectedClasses: z.array(QuarantineClassSchema).min(1),
    fieldPaths: z.array(z.string().min(1)),
    payloadSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/, {
      message: 'must be a sha256:<hex> hash of the rejected bytes',
    }),
    byteSize: z.number().int().nonnegative(),
    disposition: z.literal('REJECTED'),
    auditRef: z.string().min(1),
    modelContextExclusion: z.literal('ENFORCED'),
    detectedAt: UtcTimestampSchema,
  })
  .strict();
export type QuarantineRecord = z.infer<typeof QuarantineRecordSchema>;

// --- FR-PROV-009: rights matrices, changes, artifacts, actions -------------------------

/** The sixteen §15.6 declaration fields. */
export const RightsMatrixSchema = z
  .object({
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
  })
  .strict();
export type RightsMatrix = z.infer<typeof RightsMatrixSchema>;

export const RightsDeclarationRecordSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    rightsVersion: z.number().int().positive(),
    matrix: RightsMatrixSchema,
    declaredAt: UtcTimestampSchema,
  })
  .strict();
export type RightsDeclarationRecord = z.infer<typeof RightsDeclarationRecordSchema>;

/**
 * Use paths gated by rights. A tightening change computes the set of paths
 * that became prohibited between two versions; every path here fails closed
 * when its governing right is false.
 */
export const RightsUsePathSchema = z.enum([
  'COMMERCIAL_USE',
  'PERSONAL_RESEARCH',
  'CACHE',
  'RAW_RETENTION_STORAGE',
  'DERIVED_FEATURES',
  'MODEL_TRAINING_USE',
  'REDISTRIBUTION',
  'PUBLIC_ALERT_DERIVATIVE',
  'RAW_EXPORT',
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
    changedAt: UtcTimestampSchema,
    changedBy: z.string().min(1),
  })
  .strict()
  .refine((v) => v.toRightsVersion > v.fromRightsVersion, {
    message: 'rights versions advance monotonically',
  });
export type RightsChangeRecord = z.infer<typeof RightsChangeRecordSchema>;

export const ArtifactStateSchema = z.enum(['ACTIVE', 'QUARANTINED', 'RETIRED']);
export type ArtifactState = z.infer<typeof ArtifactStateSchema>;

export const ProviderArtifactRecordSchema = z
  .object({
    artifactId: z.string().min(1),
    objectRef: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    rightsVersion: z.number().int().positive(),
    state: ArtifactStateSchema,
    capturedAt: UtcTimestampSchema,
  })
  .strict();
export type ProviderArtifactRecord = z.infer<typeof ProviderArtifactRecordSchema>;

export const RightsChangeActionKindSchema = z.enum(['QUARANTINE', 'RETIRE']);
export type RightsChangeActionKind = z.infer<typeof RightsChangeActionKindSchema>;

export const RightsChangeActionRecordSchema = z
  .object({
    actionId: z.string().min(1),
    changeId: z.string().min(1),
    artifactId: z.string().min(1),
    action: RightsChangeActionKindSchema,
    createdAt: UtcTimestampSchema,
    executedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type RightsChangeActionRecord = z.infer<typeof RightsChangeActionRecordSchema>;

// --- FR-PROV-010: source fingerprints --------------------------------------------------

export const FingerprintKindSchema = z.enum([
  'UPSTREAM_LINEAGE',
  'VALUE_CORRELATION',
  'TIMING_BEHAVIOR',
  'OUTAGE_CORRELATION',
  'SCHEMA_CHARACTERISTICS',
  'FIRST_SEEN_BEHAVIOR',
]);
export type FingerprintKind = z.infer<typeof FingerprintKindSchema>;

export const SourceFingerprintRecordSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    kind: FingerprintKindSchema,
    fingerprintVersion: z.number().int().positive(),
    /** Canonical JSON payload — estimator inputs, never payload/response material. */
    payloadCanonical: z.string().min(2),
    estimatorInputRefs: z.array(z.string().min(1)),
    computedAt: UtcTimestampSchema,
  })
  .strict();
export type SourceFingerprintRecord = z.infer<typeof SourceFingerprintRecordSchema>;
