/**
 * Versioned Zod schemas mirroring the provider-lifecycle contracts — the
 * manifest schemaRefs for FR-PROV-001 (§12.11 lifecycle states + legal
 * transitions, §15.3 operation definitions), FR-PROV-002 (verification
 * kinds/records/TTL configs), FR-PROV-003 (migration exceptions with
 * replacement plans), FR-PROV-008 (quarantine classes and metadata-only
 * findings), FR-PROV-009 (sixteen-field rights matrices + changes + artifact
 * states + actions) and FR-PROV-010 (the six source-fingerprint kinds).
 *
 * The provider family has no `@foresift/domain` vocabulary yet, so the closed
 * alphabets below are local literals kept in parity by tests: the seven
 * §12.11 lifecycle states and their legal-transition graph, the twelve §15.4
 * health statuses, the §15.2 cost/capability class vocabularies, the nine
 * verification kinds, the five FR-PROV-008 quarantine classes, the seven
 * affected-use path kinds, the three artifact states, the two change-action
 * kinds, the four dependency consumer kinds, and the six fingerprint kinds.
 *
 * Fail-closed structural rules encoded here:
 * - every record is `.strict()` — unknown keys are refused;
 * - the lifecycle-event ledger accepts ONLY transitions in the exported legal
 *   graph (terminals have no outgoing edges);
 * - operation definitions structurally refuse the four PROHIBITED_*
 *   capability classes — a prohibited capability is unrepresentable in any
 *   registered operation record (registration-time refusal is layered on top);
 * - quarantine records are METADATA-ONLY: there is no payload-body field to
 *   persist hazardous material into, disposition is pinned to REJECTED and
 *   model-context exclusion to ENFORCED;
 * - migration exceptions are time-bounded by construction (`expiresAt` must
 *   follow `grantedAt`); expiry enforcement at use time lives in the engine.
 *
 * Timestamps are ISO-8601 UTC strings ending in `Z`; payload hashes reuse the
 * package-wide `sha256:<hex>` keyed-hash shape from `sec.ts`.
 */
import { z } from 'zod';
import { compareTimestamps, type UtcTimestamp } from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';
import { KeyedHashSchema } from './sec.ts';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const PROV_SCHEMA_REGISTRY_VERSION = 1;

/**
 * Instant comparison inside refines: values have already passed
 * `UtcTimestampSchema`, so this bridge only closes the Zod-inferred-`string`
 * vs `UtcTimestamp` type gap.
 */
function compareStamps(a: string, b: string): number {
  return compareTimestamps(a as UtcTimestamp, b as UtcTimestamp);
}

// ---------------------------------------------------------------------------
// §12.11 Provider operation lifecycle — states and legal transitions
// ---------------------------------------------------------------------------

export const PROVIDER_LIFECYCLE_STATES = [
  'DISCOVERED',
  'VERIFIED',
  'ACTIVE',
  'DEGRADED',
  'DEPRECATED',
  'BLOCKED',
  'REMOVED',
] as const;

export type ProvLifecycleState = (typeof PROVIDER_LIFECYCLE_STATES)[number];

export const ProviderLifecycleStateSchema = z.enum(PROVIDER_LIFECYCLE_STATES);

/** States with no outgoing edge: deprecation, blocking and removal are final. */
export const TERMINAL_PROVIDER_LIFECYCLE_STATES = [
  'DEPRECATED',
  'BLOCKED',
  'REMOVED',
] as const;

/**
 * Legal-transition graph (FR-PROV-001): DISCOVERED→VERIFIED→ACTIVE;
 * ACTIVE⇄DEGRADED (expiry-driven exits land here without touching stored
 * historical evidence); ACTIVE→{DEPRECATED,BLOCKED,REMOVED}; terminals end.
 */
export const PROVIDER_LIFECYCLE_TRANSITIONS = {
  DISCOVERED: ['VERIFIED'],
  VERIFIED: ['ACTIVE'],
  ACTIVE: ['DEGRADED', 'DEPRECATED', 'BLOCKED', 'REMOVED'],
  DEGRADED: ['ACTIVE'],
  DEPRECATED: [],
  BLOCKED: [],
  REMOVED: [],
} as const satisfies Record<ProvLifecycleState, readonly ProvLifecycleState[]>;

export function isLegalLifecycleTransition(
  from: ProvLifecycleState,
  to: ProvLifecycleState,
): boolean {
  return (PROVIDER_LIFECYCLE_TRANSITIONS[from] as readonly string[]).includes(to);
}

// ---------------------------------------------------------------------------
// §15.4 health statuses, §15.2 cost and capability classes
// ---------------------------------------------------------------------------

export const PROVIDER_HEALTH_STATUSES = [
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
] as const;

export const ProviderHealthStatusSchema = z.enum(PROVIDER_HEALTH_STATUSES);

export const COST_CLASSES = [
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
] as const;

export const CostClassSchema = z.enum(COST_CLASSES);

export const CAPABILITY_CLASSES = [
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
] as const;

/** Full §15.2 vocabulary — mirrored for scanner surfaces, not for registration. */
export const CapabilityClassSchema = z.enum(CAPABILITY_CLASSES);

/** These four can never appear on a registered operation (see refine below). */
export const PROHIBITED_CAPABILITY_CLASSES = [
  'PROHIBITED_TRANSACTION_BUILD',
  'PROHIBITED_SIGN',
  'PROHIBITED_SUBMIT',
  'PROHIBITED_CUSTODY',
] as const satisfies readonly (typeof CAPABILITY_CLASSES)[number][];

// ---------------------------------------------------------------------------
// Provider identity and §15.3 operation definitions
// ---------------------------------------------------------------------------

export const ProvProviderSchema = z
  .object({
    providerId: z.string().min(1),
    providerGroup: z.string().min(1),
    disabledByDefault: z.boolean(),
  })
  .strict();

const SupportedProgramSchema = z
  .object({ programId: z.string().min(1), versions: z.array(z.string().min(1)).min(1) })
  .strict();

const BatchCapabilitySchema = z
  .object({
    maxEntities: z.number().int().min(1),
    maxBytes: z.number().int().min(1).optional(),
  })
  .strict();

/**
 * Exact §15.3 mirror. Prohibited capability classes are structurally
 * unrepresentable; every other gate (allowlists, STRICT_FREE plan proof,
 * deprecation blocks) is enforced by the registration/use-time engines.
 */
export const ProvOperationDefinitionSchema = z
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
    healthStatus: ProviderHealthStatusSchema,
    costClass: CostClassSchema,
    estimatedQuotaUnits: z.number().min(0),
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
  .refine((v) => !v.capabilityClass.startsWith('PROHIBITED_'), {
    message: 'prohibited capability classes cannot be registered as an operation',
  });

// Affected-feature dependency registry (FR-PROV-001 "affected features").

export const PROV_CONSUMER_KINDS = ['FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE'] as const;

export const ProvOperationDependencySchema = z
  .object({
    dependencyId: z.string().min(1),
    consumerKind: z.enum(PROV_CONSUMER_KINDS),
    consumerKey: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    active: z.boolean(),
    registeredAt: UtcTimestampSchema,
  })
  .strict();

// Append-only lifecycle transition ledger (prov_lifecycle_events mirror).

const ReasonClassSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, {
  message: 'expected UPPER_SNAKE reason class',
});

/**
 * One ledger entry. The legal transition graph is enforced HERE at the
 * record boundary: self-transitions and edges leaving terminal states are
 * unrepresentable, so stored history can never contain an illegal move.
 */
export const ProvLifecycleEventSchema = z
  .object({
    eventId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    fromState: ProviderLifecycleStateSchema,
    toState: ProviderLifecycleStateSchema,
    reasonClass: ReasonClassSchema,
    actor: z.string().min(1),
    occurredAt: UtcTimestampSchema,
    evidenceRefs: z.array(z.string().min(1)),
    idempotencyKey: z.string().min(1),
  })
  .strict()
  .refine((v) => v.fromState !== v.toState, { message: 'self-transitions are not state changes' })
  .refine((v) => isLegalLifecycleTransition(v.fromState, v.toState), {
    message: 'transition is outside the §12.11 legal graph',
  });

// ---------------------------------------------------------------------------
// Verification kinds, records and TTL configs (FR-PROV-002)
// ---------------------------------------------------------------------------

export const VERIFICATION_KINDS = [
  'DOCUMENTATION',
  'PRICING_PLAN',
  'QUOTA',
  'RIGHTS',
  'SCHEMA',
  'ENDPOINT',
  'AUTHENTICATION',
  'DEPRECATION',
  'LIVE_PROBE',
] as const;

export const VerificationKindSchema = z.enum(VERIFICATION_KINDS);

export const VERIFICATION_SOURCES = ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const;

export const VerificationSourceSchema = z.enum(VERIFICATION_SOURCES);

export const VERIFICATION_OUTCOMES = ['PASSED', 'FAILED'] as const;

export const VerificationOutcomeSchema = z.enum(VERIFICATION_OUTCOMES);

/**
 * One verification outcome. A PASSED record carries its TTL deadline (after
 * which new active use of decision-critical fields is prevented); a FAILED
 * record grants nothing and therefore has no expiry window.
 */
export const ProvVerificationRecordSchema = z
  .object({
    verificationId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    kind: VerificationKindSchema,
    source: VerificationSourceSchema,
    outcome: VerificationOutcomeSchema,
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema.nullable(),
    evidenceRefs: z.array(z.string().min(1)),
  })
  .strict()
  .refine((v) => v.outcome !== 'PASSED' || v.expiresAt !== null, {
    message: 'passed verifications carry their TTL deadline',
  })
  .refine(
    (v) =>
      v.outcome !== 'PASSED' ||
      v.expiresAt === null ||
      compareStamps(v.expiresAt, v.verifiedAt) > 0,
    { message: 'verification expiry must follow its verification instant' },
  )
  .refine((v) => v.outcome !== 'FAILED' || v.expiresAt === null, {
    message: 'failed verifications grant no freshness window',
  });

/**
 * Per-kind/per-provider TTL configuration. `providerId === null` is the
 * platform default row; ABSENCE of any matching config fails closed (treated
 * as expired) — that rule lives in the freshness engine, not in the shape.
 */
export const ProvVerificationTtlConfigSchema = z
  .object({
    configId: z.string().min(1),
    providerId: z.string().min(1).nullable(),
    kind: VerificationKindSchema,
    ttlSeconds: z.number().int().min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Migration exceptions with replacement plans (FR-PROV-003)
// ---------------------------------------------------------------------------

/**
 * An explicit time-bounded exception letting a deprecated/maintenance-only
 * operation remain usable against an approved replacement plan. Lapsed or
 * revoked exceptions authorize nothing — use-time evaluation against the
 * injected clock is the engine's job; the shape guarantees the bound exists.
 */
export const ProvMigrationExceptionSchema = z
  .object({
    exceptionId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1).optional(),
    approver: z.string().min(1),
    replacementPlanRef: z.string().min(1),
    replacementOperationId: z.string().min(1).optional(),
    grantedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .refine((v) => compareStamps(v.expiresAt, v.grantedAt) > 0, {
    message: 'exceptions must be strictly time-bounded (expiresAt > grantedAt)',
  })
  .refine((v) => v.revokedAt === null || compareStamps(v.revokedAt, v.grantedAt) > 0, {
    message: 'revocation instant must follow the grant',
  });

// ---------------------------------------------------------------------------
// Response quarantine classes and findings (FR-PROV-008)
// ---------------------------------------------------------------------------

export const PROV_QUARANTINE_CLASSES = [
  'TRANSACTION_PAYLOAD',
  'SIGNING_REQUEST',
  'EXECUTABLE_INSTRUCTION',
  'PRIVATE_KEY_FIELD',
  'UNEXPECTED_WRITE_CAPABILITY',
] as const;

export const QuarantineClassSchema = z.enum(PROV_QUARANTINE_CLASSES);

/** Metadata-only per-detection finding: WHERE the hazard was seen, never WHAT. */
export const ProvQuarantineFindingSchema = z
  .object({
    detectedClass: QuarantineClassSchema,
    fieldPath: z.string().min(1),
  })
  .strict();

/**
 * Metadata-only quarantine record. There is NO payload-body field — rejected
 * response material is structurally unpersistable; only its keyed hash,
 * size, classes and field paths survive. Disposition and model-context
 * exclusion are pinned constants, and the declared class set must exactly
 * match the set of finding classes.
 */
export const ProvResponseQuarantineSchema = z
  .object({
    quarantineId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1).optional(),
    detectedClasses: z.array(QuarantineClassSchema).min(1),
    findings: z.array(ProvQuarantineFindingSchema).min(1),
    payloadSha256: KeyedHashSchema,
    byteSize: z.number().int().positive(),
    disposition: z.literal('REJECTED'),
    auditChainRef: z.string().min(1),
    modelContextExclusion: z.literal('ENFORCED'),
    detectedAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (v) =>
      v.detectedClasses.length === new Set(v.findings.map((f) => f.detectedClass)).size &&
      v.detectedClasses.every((c) => v.findings.some((f) => f.detectedClass === c)),
    { message: 'detectedClasses must exactly match the distinct finding classes' },
  );

// ---------------------------------------------------------------------------
// Sixteen-field rights matrices, changes, artifacts, actions (FR-PROV-009)
// ---------------------------------------------------------------------------

/** The sixteen §15.6 matrix fields, camelCase, in declaration order. */
export const RIGHTS_MATRIX_FIELDS = [
  'commercialUseAllowed',
  'personalResearchAllowed',
  'cacheAllowed',
  'maximumCacheDurationSeconds',
  'rawRetentionAllowed',
  'derivedFeaturesAllowed',
  'modelTrainingAllowed',
  'redistributionAllowed',
  'publicAlertDerivativeAllowed',
  'attributionRequired',
  'userByokRequired',
  'rawExportAllowed',
  'jurisdictionRestrictions',
  'termsVersion',
  'verifiedAt',
  'verificationExpiresAt',
] as const;

export type RightsMatrixField = (typeof RIGHTS_MATRIX_FIELDS)[number];

/**
 * One versioned rights declaration carrying the sixteen §15.6 fields plus
 * identity. A cache right must declare its maximum duration (an unbounded
 * cache right is refused); expiry follows verification.
 */
export const ProvRightsDeclarationSchema = z
  .object({
    declarationId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    rightsVersion: z.number().int().min(1),
    commercialUseAllowed: z.boolean(),
    personalResearchAllowed: z.boolean(),
    cacheAllowed: z.boolean(),
    maximumCacheDurationSeconds: z.number().int().min(1).nullable(),
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
  .refine((v) => (v.cacheAllowed ? v.maximumCacheDurationSeconds !== null : true), {
    message: 'an allowed cache must declare its maximum duration',
  })
  .refine((v) => (v.cacheAllowed ? true : v.maximumCacheDurationSeconds === null), {
    message: 'a prohibited cache carries no duration',
  })
  .refine((v) => compareStamps(v.verificationExpiresAt, v.verifiedAt) > 0, {
    message: 'rights verification expiry must follow its verification instant',
  });

/** The use-path families a rights change can newly prohibit (plan data model). */
export const PROV_USE_PATH_KINDS = [
  'CACHE',
  'RAW_RETENTION',
  'DERIVED_FEATURES',
  'MODEL_USE',
  'REDISTRIBUTION',
  'EXPORT',
  'STORAGE',
] as const;

export const UsePathKindSchema = z.enum(PROV_USE_PATH_KINDS);

/**
 * A rights change between two declaration versions. Tightenings list the
 * newly prohibited paths; loosenings may list none — reactivation still
 * requires reverification upstream (engine rule), never this record alone.
 */
export const ProvRightsChangeSchema = z
  .object({
    changeId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    fromRightsVersion: z.number().int().min(1),
    toRightsVersion: z.number().int().min(1),
    newlyProhibitedUses: z.array(UsePathKindSchema),
    termsVersion: z.string().min(1),
    changedAt: UtcTimestampSchema,
    evidenceRef: z.string().min(1),
  })
  .strict()
  .refine((v) => v.toRightsVersion > v.fromRightsVersion, {
    message: 'rights versions only move forward',
  });

export const PROV_ARTIFACT_STATES = ['ACTIVE', 'QUARANTINED', 'RETIRED'] as const;

export const ArtifactStateSchema = z.enum(PROV_ARTIFACT_STATES);

/** Capture-time registration of a persisted provider-derived artifact. */
export const ProvProviderArtifactSchema = z
  .object({
    artifactId: z.string().min(1),
    objectRef: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    rightsVersionAtCapture: z.number().int().min(1),
    capturedAt: UtcTimestampSchema,
    state: ArtifactStateSchema,
  })
  .strict();

export const PROV_RIGHTS_ACTION_KINDS = ['QUARANTINE', 'RETIRE'] as const;

export const RightsActionKindSchema = z.enum(PROV_RIGHTS_ACTION_KINDS);

/**
 * Durable action binding one artifact to one rights change. `executedAt`
 * stays null until performed — pending enumeration is recorded, never lost.
 */
export const ProvRightsChangeActionSchema = z
  .object({
    actionId: z.string().min(1),
    changeId: z.string().min(1),
    artifactId: z.string().min(1),
    actionKind: RightsActionKindSchema,
    executedAt: UtcTimestampSchema.nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Source fingerprints (FR-PROV-010)
// ---------------------------------------------------------------------------

export const PROV_FINGERPRINT_KINDS = [
  'UPSTREAM_LINEAGE',
  'VALUE_CORRELATION',
  'TIMING_BEHAVIOR',
  'OUTAGE_CORRELATION',
  'SCHEMA_CHARACTERISTICS',
  'FIRST_SEEN_BEHAVIOR',
] as const;

export const FingerprintKindSchema = z.enum(PROV_FINGERPRINT_KINDS);

/**
 * One versioned fingerprint capture. `payload` is canonical JSON produced by
 * the capture engine; `estimatorInputRefs` point at the dependence-estimator
 * observation inputs (`DependenceObservationInputs` family) this capture
 * feeds — UPSTREAM_LINEAGE captures may legitimately reference none.
 */
export const ProvSourceFingerprintSchema = z
  .object({
    fingerprintId: z.string().min(1),
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    operationVersion: z.string().min(1),
    kind: FingerprintKindSchema,
    fingerprintVersion: z.number().int().min(1),
    payload: z.record(z.string(), z.unknown()),
    computedAt: UtcTimestampSchema,
    estimatorInputRefs: z.array(z.string().min(1)),
  })
  .strict();

// ---------------------------------------------------------------------------
// Versioned registry
// ---------------------------------------------------------------------------

export const PROV_SCHEMAS = {
  Provider: ProvProviderSchema,
  OperationDefinition: ProvOperationDefinitionSchema,
  OperationDependency: ProvOperationDependencySchema,
  LifecycleEvent: ProvLifecycleEventSchema,
  VerificationRecord: ProvVerificationRecordSchema,
  VerificationTtlConfig: ProvVerificationTtlConfigSchema,
  MigrationException: ProvMigrationExceptionSchema,
  ResponseQuarantine: ProvResponseQuarantineSchema,
  RightsDeclaration: ProvRightsDeclarationSchema,
  RightsChange: ProvRightsChangeSchema,
  ProviderArtifact: ProvProviderArtifactSchema,
  RightsChangeAction: ProvRightsChangeActionSchema,
  SourceFingerprint: ProvSourceFingerprintSchema,
} as const;

export type ProvSchemaName = keyof typeof PROV_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. Throws ZodError on failure. */
export function parseProvSchema<T extends ProvSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof PROV_SCHEMAS)[T]> {
  return PROV_SCHEMAS[name].parse(payload) as z.infer<(typeof PROV_SCHEMAS)[T]>;
}
