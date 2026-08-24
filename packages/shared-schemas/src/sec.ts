/**
 * Versioned Zod schemas mirroring the security-perimeter contracts — the
 * manifest schemaRefs for FR-SEC-001…012 (`packages/shared-schemas/src/sec.ts`).
 *
 * Mirrors are by construction: severity, quarantine-state, isolation-mode,
 * and audit-action-class vocabularies are pinned HERE and consumed by
 * `@foresift/security` / `@foresift/tenant-isolation` so build-time and
 * runtime layers cannot drift. Structural fail-closed rules are encoded as
 * refines; BEHAVIORAL enforcement (freshness windows, chain verification,
 * signature checks) lives in the security package, not here. Keyed-hash and
 * reference-only rules are structural: no schema field accepts secret
 * MATERIAL — only key references and `sha256:<hex>` keyed hashes.
 */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const SEC_SCHEMA_REGISTRY_VERSION = 1;

/** `sha256:<64 hex>` of stored bytes — a keyed hash AT REST, never material. */
export const KeyedHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, {
  message: 'must be a sha256:<hex> keyed hash',
});

/** Opaque reference into a separated keystore or credential store. */
export const KeyReferenceSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, { message: 'must be an opaque key reference' });

// --- FR-SEC-002: audit chain -------------------------------------------------

/** §35.9 audit coverage vocabulary — every auditable change class. */
export const AuditActionClassSchema = z.enum([
  'AUTHENTICATION_AUTHORIZATION',
  'TOOL_RESOURCE_ACCESS',
  'PROVIDER_COLLECTOR_ACCESS',
  'BLOCKED_OPERATION',
  'CONFIGURATION_CHANGE',
  'CAPABILITY_CHANGE',
  'COST_CHANGE',
  'RIGHTS_CHANGE',
  'SOURCE_DEPENDENCE_CHANGE',
  'POOL_ADAPTER_CHANGE',
  'PUBLIC_GATE_CHANGE',
  'APPROVAL_STEP_UP',
  'IMPORT_PROMOTION',
  'PAUSE_RETIREMENT_ROLLBACK',
  'SECRET_LIFECYCLE',
  'INCIDENT_RECOVERY',
]);
export type AuditActionClass = z.infer<typeof AuditActionClassSchema>;

/** One append-only audit entry as persisted (hashes computed over canonical payload). */
export const AuditEventRecordSchema = z
  .object({
    seq: z.number().int().positive(),
    occurredAt: UtcTimestampSchema,
    actor: z.string().min(1),
    actionClass: AuditActionClassSchema,
    /** Free-form subject reference (route, resource id, capability scope…). */
    subject: z.string(),
    /** Canonical JSON text — the exact bytes hashed. */
    payloadCanonical: z.string().min(2),
    payloadSha256: KeyedHashSchema,
    prevEntryHash: z.union([KeyedHashSchema, z.literal('GENESIS')]),
    entryHash: KeyedHashSchema,
  })
  .strict();
export type AuditEventRecord = z.infer<typeof AuditEventRecordSchema>;

/** Periodic batch checkpoint mirrored to an independently verifiable location. */
export const AuditCheckpointRecordSchema = z
  .object({
    checkpointId: z.string().min(1),
    fromSeq: z.number().int().positive(),
    toSeq: z.number().int().positive(),
    chainHeadHash: KeyedHashSchema,
    /** Chained with prior checkpoints; GENESIS for the first batch. */
    prevCheckpointHash: z.union([KeyedHashSchema, z.literal('GENESIS')]),
    checkpointHash: KeyedHashSchema,
    /** Optional batch signature over the checkpoint hash (where supported). */
    signature: z.string().nullish(),
    storedAt: UtcTimestampSchema,
    /** Object-store artifact reference of the independently verifiable copy. */
    objectRef: z.string().min(1).nullable(),
  })
  .strict()
  .refine((v) => v.toSeq >= v.fromSeq, { message: 'checkpoint range must be non-empty ascending' });
export type AuditCheckpointRecord = z.infer<typeof AuditCheckpointRecordSchema>;

/** Continuous-verifier run result (first-divergence diagnostics). */
export const AuditVerifyRunRecordSchema = z
  .object({
    runId: z.string().min(1),
    verifiedFromSeq: z.number().int().nonnegative(),
    verifiedToSeq: z.number().int().positive(),
    verdict: z.enum(['OK', 'FAILED']),
    firstDivergenceSeq: z.number().int().positive().nullable(),
    divergenceKind: z.enum(['GAP', 'REORDERING', 'MUTATION', 'DELETION', 'CHAIN_BREAK']).nullable(),
    expectedHash: z.string().nullish(),
    actualHash: z.string().nullish(),
    ranAt: UtcTimestampSchema,
  })
  .strict()
  .refine((v) => (v.verdict === 'FAILED') === (v.divergenceKind !== null), {
    message: 'divergence diagnostics required exactly when verdict FAILED',
  })
  .refine((v) => !(v.verdict === 'OK' && v.firstDivergenceSeq !== null), {
    message: 'a passing verify run has no divergence',
  });
export type AuditVerifyRunRecord = z.infer<typeof AuditVerifyRunRecordSchema>;

// --- FR-SEC-001: step-up policy & high-impact gate ----------------------------

/** Authenticator classes; TOTP alone is NEVER sufficient (§35.1). */
export const StepUpAuthenticatorClassSchema = z.enum([
  'PASSKEY_PLATFORM',
  'PASSKEY_ROAMING_HARDWARE',
  'HARDWARE_SECURITY_KEY',
  'RECOVERY_TOTP',
]);
export type StepUpAuthenticatorClass = z.infer<typeof StepUpAuthenticatorClassSchema>;

/** Phishing-resistant classes acceptable as the sole production factor. */
export const PHISHING_RESISTANT_CLASSES: readonly StepUpAuthenticatorClass[] = [
  'PASSKEY_PLATFORM',
  'PASSKEY_ROAMING_HARDWARE',
  'HARDWARE_SECURITY_KEY',
];

export const StepUpPolicySchema = z
  .object({
    /** Maximum age of an accepted proof, in seconds. */
    freshnessWindowSeconds: z.number().int().positive(),
    minimumAuthenticatorClass: StepUpAuthenticatorClassSchema.exclude(['RECOVERY_TOTP']),
    requireUserPresence: z.boolean(),
    requireUserVerification: z.boolean(),
  })
  .strict();
export type StepUpPolicy = z.infer<typeof StepUpPolicySchema>;

export const StepUpProofSchema = z
  .object({
    proofId: z.string().min(1),
    actor: z.string().min(1),
    authenticatorClass: StepUpAuthenticatorClassSchema,
    completedAt: UtcTimestampSchema,
    userPresence: z.boolean(),
    userVerification: z.boolean(),
    /** Relying-party challenge binding (opaque id, never material). */
    challengeRef: z.string().min(1),
  })
  .strict();
export type StepUpProof = z.infer<typeof StepUpProofSchema>;

/** Appendix B `admin:high:*` class — exactly the actions requiring step-up. */
export const HighImpactActionScopeSchema = z.enum([
  'admin:high:configuration-activate',
  'admin:high:provider-operation-state',
  'admin:high:collector-state',
  'admin:high:pool-adapter-state',
  'admin:high:alpha-artifact-state',
  'admin:high:public-authorization',
  'admin:high:kill-switch',
  'admin:high:secret-rotation',
  'admin:high:restore',
  'admin:high:release-conformance',
]);
export type HighImpactActionScope = z.infer<typeof HighImpactActionScopeSchema>;

/** Typed refusal dimensions — one per missing/stale requirement. */
export const ActionGateRefusalReasonSchema = z.enum([
  'STEP_UP_MISSING',
  'STEP_UP_STALE',
  'AUTHENTICATOR_CLASS_INSUFFICIENT',
  'SCOPE_MISMATCH',
  'CSRF_INVALID',
  'IDEMPOTENCY_KEY_MISSING',
  'REASON_MISSING',
  'AUDIT_HEALTH_BLOCKED',
]);
export type ActionGateRefusalReason = z.infer<typeof ActionGateRefusalReasonSchema>;

export const ActionGateDecisionSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('ALLOW'),
      action: HighImpactActionScopeSchema,
      actor: z.string().min(1),
      stepUpProofId: z.string().min(1),
      idempotencyKey: z.string().min(1),
      evaluatedAt: UtcTimestampSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal('REFUSE'),
      action: HighImpactActionScopeSchema,
      actor: z.string().min(1),
      reasons: z.array(ActionGateRefusalReasonSchema).min(1),
      evaluatedAt: UtcTimestampSchema,
    })
    .strict(),
]);
export type ActionGateDecision = z.infer<typeof ActionGateDecisionSchema>;

// --- FR-SEC-001 / ADR-055: MCP origin + protocol verdicts ---------------------

export const OriginVerdictSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('ALLOW'), origin: z.string().min(1) }).strict(),
  z
    .object({
      decision: z.literal('REFUSE'),
      origin: z.string().nullable(),
      reason: z.enum([
        'NOT_ALLOWLISTED',
        'PUNYCODE_CONFUSED',
        'TRAILING_DOT',
        'MIXED_SCHEME',
        'WRONG_PORT',
        'WRONG_HOST',
        'MALFORMED',
        'ABSENT_POLICY_REFUSES',
      ]),
    })
    .strict(),
]);
export type OriginVerdict = z.infer<typeof OriginVerdictSchema>;

export const ProtocolVerdictSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('ALLOW') }).strict(),
  z
    .object({
      decision: z.literal('REFUSE'),
      reason: z.enum([
        'REVISION_UNSUPPORTED',
        'CONTENT_TYPE_INVALID',
        'METHOD_INVALID',
        'MESSAGE_OVERSIZE',
        'SESSION_BINDING_INVALID',
        'CURSOR_UNAUTHORIZED',
      ]),
    })
    .strict(),
]);
export type ProtocolVerdict = z.infer<typeof ProtocolVerdictSchema>;

/** Baseline protocol revision per ADR-004; later revisions opt-in. */
export const MCP_PROTOCOL_BASELINE_REVISION = '2025-11-25' as const;

// --- FR-SEC-001 / ADR-055: OAuth token binding --------------------------------

export const OAuthTokenBindingSchema = z
  .object({
    subject: z.string().min(1),
    clientId: z.string().min(1),
    /** Exact redirect URI registered for this client (exact match rule). */
    redirectUri: z.string().url(),
    audience: z.string().min(1),
    /** RFC 8707 resource indicator bound to this token. */
    resourceIndicator: z.string().min(1),
    scopes: z.array(z.string().min(1)).min(1),
    expiresAt: UtcTimestampSchema,
    pkceRequired: z.literal(true),
  })
  .strict();
export type OAuthTokenBinding = z.infer<typeof OAuthTokenBindingSchema>;

// --- FR-SEC-004: egress allowlist & decisions ----------------------------------

/** Exact destination allowlist entry for one egress plane. */
export const EgressAllowlistEntrySchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    scheme: z.literal('https'),
    plane: z.enum(['CONTROL_PLANE', 'COLLECTOR', 'ALPHA_LAB']),
  })
  .strict();
export type EgressAllowlistEntry = z.infer<typeof EgressAllowlistEntrySchema>;

export const EgressDecisionSchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('ALLOW'),
      host: z.string().min(1),
      /** Pinned resolved addresses validated against denied ranges. */
      pinnedAddresses: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      decision: z.literal('REFUSE'),
      reason: z.enum([
        'HOST_NOT_ALLOWLISTED',
        'SCHEME_REFUSED',
        'PORT_UNSAFE',
        'ADDRESS_DENIED',
        'RESOLUTION_REFUSED',
        'REBINDING_DETECTED',
        'REDIRECT_UNAPPROVED',
        'REDIRECT_LIMIT_EXCEEDED',
        'RESPONSE_BYTES_EXCEEDED',
        'RESPONSE_TIME_EXCEEDED',
        'DECOMPRESSION_RATIO_EXCEEDED',
        'CONTENT_TYPE_REFUSED',
        'URL_MALFORMED',
      ]),
      detail: z.string().max(500),
    })
    .strict(),
]);
export type EgressDecision = z.infer<typeof EgressDecisionSchema>;

// --- FR-SEC-005: untrusted-content envelope ------------------------------------

/** The seven untrusted content classes (§35.4, AC-257/AC-258 fixtures). */
export const UntrustedContentSourceSchema = z.enum([
  'TOKEN_METADATA',
  'SOCIAL_TEXT',
  'WEBSITE',
  'PROVIDER_TEXT',
  'NOTEBOOK',
  'MODEL_OUTPUT',
  'IMPORTED_ARTIFACT',
]);
export type UntrustedContentSource = z.infer<typeof UntrustedContentSourceSchema>;

/** Roles that must NEVER receive untrusted content. */
export const PROTECTED_INSTRUCTION_ROLES: readonly string[] = ['system', 'developer'];

export const UntrustedContentEnvelopeSchema = z
  .object({
    source: UntrustedContentSourceSchema,
    /** Labeled data — carried verbatim, never interpreted as instructions. */
    content: z.string(),
    acquiredAt: UtcTimestampSchema,
    provenanceRef: z.string().min(1),
  })
  .strict();
export type UntrustedContentEnvelope = z.infer<typeof UntrustedContentEnvelopeSchema>;

// --- FR-SEC-007: secret lifecycle records ---------------------------------------

export const SecretClassificationSchema = z.enum([
  'PROVIDER_API_KEY',
  'DATABASE_CREDENTIAL',
  'MCP_CREDENTIAL_HASH',
  'ADMIN_SESSION_SECRET',
  'ENCRYPTION_KEY_REFERENCE',
  'PRODUCER_SIGNING_KEY_REFERENCE',
]);
export type SecretClassification = z.infer<typeof SecretClassificationSchema>;

export const SecretLifecycleEventSchema = z
  .object({
    secretRef: KeyReferenceSchema,
    classification: SecretClassificationSchema,
    event: z.enum(['CREATED', 'VERIFIED', 'ROTATED', 'REVOKED', 'EXPIRED', 'LAST_USED']),
    environment: z.enum(['PRODUCTION', 'COLLECTOR', 'ALPHA_LAB']),
    at: UtcTimestampSchema,
    /** Rotation overlap window end (where supported); null otherwise. */
    overlapUntil: UtcTimestampSchema.nullish(),
    /** Incident that triggered invalidation, when applicable. */
    invalidatedByIncidentId: z.string().nullish(),
  })
  .strict();
export type SecretLifecycleEvent = z.infer<typeof SecretLifecycleEventSchema>;

// --- FR-SEC-008: import manifests, quarantine, scan findings --------------------

export const ImportFormatSchema = z.enum([
  'VERSIONED_JSON',
  'VERSIONED_JSONL',
  'PARQUET',
  'APPROVED_COMPRESSED_CONTAINER',
]);
export type ImportFormat = z.infer<typeof ImportFormatSchema>;

/**
 * Quarantine state machine: intake → scanning → validation → terminal
 * REJECTED | SHADOW_ELIGIBLE. There is NO ACTIVE state — imported artifacts
 * can never directly activate policy (ADR-046).
 */
export const ImportQuarantineStateSchema = z.enum([
  'RECEIVED',
  'QUARANTINED',
  'SCANNED',
  'VALIDATING',
  'REJECTED',
  'SHADOW_ELIGIBLE',
]);
export type ImportQuarantineState = z.infer<typeof ImportQuarantineStateSchema>;

export const ImportArtifactManifestSchema = z
  .object({
    manifestVersion: z.number().int().positive(),
    producerKeyId: z.string().min(1),
    datasetId: z.string().min(1),
    format: ImportFormatSchema,
    contentSha256: KeyedHashSchema,
    /** Canonical-serialization hash where the format defines one. */
    canonicalSha256: KeyedHashSchema.nullish(),
    schemaVersion: z.string().min(1),
    cutoffAt: UtcTimestampSchema,
    codeHash: z.string().min(1),
    deterministicSeed: z.string().min(1),
    fileCount: z.number().int().positive(),
    totalBytes: z.number().int().positive(),
    holdoutStatus: z.enum(['HELD_OUT', 'LEAKAGE_RISK', 'EVALUATION_ONLY']),
  })
  .strict();
export type ImportArtifactManifest = z.infer<typeof ImportArtifactManifestSchema>;

export const ImportScanFindingSchema = z
  .object({
    findingId: z.string().min(1),
    artifactId: z.string().min(1),
    scanner: z.enum(['FORMAT_INSPECTION', 'PATH_ANALYSIS', 'CONTENT_SCAN', 'SIGNATURE_CHECK']),
    verdict: z.enum(['CLEAN', 'SUSPICIOUS', 'MALICIOUS']),
    detail: z.string().max(1000),
  })
  .strict();
export type ImportScanFinding = z.infer<typeof ImportScanFindingSchema>;

// --- FR-SEC-009: tenant contexts -------------------------------------------------

export const TenantIsolationModeSchema = z.enum(['PERSONAL', 'WORKSPACE', 'PUBLIC']);
export type TenantIsolationMode = z.infer<typeof TenantIsolationModeSchema>;

export const TenantContextSchema = z
  .object({
    tenantId: z.string().min(1),
    mode: TenantIsolationModeSchema,
    actor: z.string().min(1),
    sessionRef: z.string().min(1),
  })
  .strict();
export type TenantContext = z.infer<typeof TenantContextSchema>;

/** The eleven isolated surfaces (AC-275 matrix). */
export const TENANT_ISOLATED_SURFACES = [
  'ROWS',
  'ARTIFACTS',
  'CACHE',
  'QUEUES',
  'SESSIONS',
  'QUOTAS',
  'LOGS',
  'METRICS',
  'SIGNED_URLS',
  'MODEL_CONTEXT',
  'RESOURCE_URIS',
] as const;
export const TenantIsolatedSurfaceSchema = z.enum(TENANT_ISOLATED_SURFACES);
export type TenantIsolatedSurface = z.infer<typeof TenantIsolatedSurfaceSchema>;

// --- FR-SEC-010: abuse decisions --------------------------------------------------

export const AbuseDecisionSchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('ALLOW'),
      subject: z.string().min(1),
      costWeight: z.number().nonnegative(),
      evaluatedAt: UtcTimestampSchema,
    })
    .strict(),
  z
    .object({
      decision: z.literal('DEGRADE'),
      subject: z.string().min(1),
      reason: z.enum(['QUOTA_EXHAUSTED', 'AMPLIFICATION_COST']),
      evaluatedAt: UtcTimestampSchema,
    })
    .strict(),
  z
    .object({
      decision: z.literal('REFUSE'),
      subject: z.string().min(1),
      reason: z.enum([
        'FLOOD_LIMIT_EXCEEDED',
        'ENUMERATION_SUSPECTED',
        'PROMPT_ATTACK_SCREENED',
        'SCRAPING_SUSPECTED',
      ]),
      evaluatedAt: UtcTimestampSchema,
    })
    .strict(),
]);

// --- FR-SEC-011: incidents ---------------------------------------------------------

export const IncidentSeveritySchema = z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

export const IncidentContainmentStateSchema = z.enum([
  'OPEN',
  'CONTAINED',
  'RECOVERY_VERIFIED',
  'RESOLVED',
]);
export type IncidentContainmentState = z.infer<typeof IncidentContainmentStateSchema>;

export const SecurityIncidentRecordSchema = z
  .object({
    incidentId: z.string().min(1),
    kind: z.enum([
      'AUDIT_CHAIN_FAILURE',
      'CREDENTIAL_COMPROMISE',
      'INTRUSION_SUSPECTED',
      'DATA_LEAKAGE',
      'DEPENDENCY_COMPROMISE',
      'ABUSE_CAMPAIGN',
      'OTHER',
    ]),
    severity: IncidentSeveritySchema,
    owner: z.string().min(1),
    openedAt: UtcTimestampSchema,
    containment: IncidentContainmentStateSchema,
    evidenceRefs: z.array(z.string().min(1)).min(1),
    notificationPolicyFlags: z
      .object({
        ownerNotified: z.boolean(),
        customersNotified: z.boolean(),
        providerReviewRequested: z.boolean(),
      })
      .strict(),
    recoveryVerifiedAt: UtcTimestampSchema.nullish(),
    postmortemRef: z.string().nullish(),
    regressionTestRef: z.string().nullish(),
    resolvedAt: UtcTimestampSchema.nullish(),
  })
  .strict()
  .refine((v) => !(v.containment === 'RESOLVED') || v.resolvedAt !== null, {
    message: 'a RESOLVED incident records its resolution instant',
  });

// --- AC-278/279: pauses + activation ledger ----------------------------------------

export const CapabilityPauseRecordSchema = z
  .object({
    pauseId: z.string().min(1),
    /** Smallest affected scope string (capability-level, never global-first). */
    scope: z.string().min(1),
    reason: z.string().min(1),
    openingIncidentId: z.string().min(1),
    pausedAt: UtcTimestampSchema,
    resumedAt: UtcTimestampSchema.nullish(),
    resumedByActor: z.string().nullish(),
  })
  .strict()
  .refine(
    (v) =>
      (v.resumedAt === undefined || v.resumedAt === null) ===
      (v.resumedByActor === undefined || v.resumedByActor === null),
    {
      message: 'resume requires both instant and explicit auditing actor',
    },
  );

export const ActivationEventTypeSchema = z.enum([
  'ACTIVATE',
  'ROLLBACK_RESTORE',
  'ROLLBACK',
  'RESUME_AFTER_RE_EVALUATION',
]);
export type ActivationEventType = z.infer<typeof ActivationEventTypeSchema>;

export const ActivationEventRecordSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: ActivationEventTypeSchema,
    scope: z.string().min(1),
    at: UtcTimestampSchema,
    actor: z.string().min(1),
    /** Immutable approved-set snapshot reference (never inline config). */
    approvedSetSnapshotRef: z.string().min(1),
    /** Prior event this rollback restores (ROLLBACK_RESTORE only). */
    restoredFromEventId: z.string().nullish(),
    /** Marker requiring actionable-candidate re-evaluation before alerts resume. */
    reevaluationMarker: z.string().nullish(),
  })
  .strict();

// --- FR-SEC-012: threat-model register entries --------------------------------------

export const ThreatBoundarySchema = z.enum([
  'MCP',
  'ADMIN',
  'WEBHOOKS',
  'PROVIDERS',
  'COLLECTOR',
  'MODEL',
  'DATABASE',
  'OBJECT_STORE',
  'ALPHA_LAB',
  'NOTIFICATIONS',
  'PUBLIC_DISTRIBUTION',
]);
export type ThreatBoundary = z.infer<typeof ThreatBoundarySchema>;

export const ThreatModelRegisterEntrySchema = z
  .object({
    boundary: ThreatBoundarySchema,
    assets: z.array(z.string().min(1)).min(1),
    trustAssumptions: z.array(z.string().min(1)).min(1),
    topThreats: z.array(z.string().min(1)).min(1),
    controlsDeliveredByPackage: z.array(z.string().min(1)),
    mappedSuites: z
      .array(
        z
          .object({
            suitePath: z.string().min(1),
            status: z.enum(['DELIVERED', 'DEFERRED_TO_PACKAGE']),
            deferredTo: z.string().nullish(),
          })
          .strict()
          .refine((s) => s.status === 'DELIVERED' || (s.deferredTo ?? '').length > 0, {
            message: 'deferred suites name their future owning package',
          }),
      )
      .min(1),
  })
  .strict();

// --- FR-SEC-003: prohibited-capability findings --------------------------------------

export const ProhibitedCapabilityCategorySchema = z.enum([
  'PRIVATE_KEY_SEED',
  'SIGNING',
  'TRANSACTION_BUILD_SIGN_SUBMIT',
  'SWAP_ORDER_EXECUTION',
  'BRIDGE_STAKING',
  'CUSTODY_WALLET_MANAGEMENT',
  'EXCHANGE_TRADING',
  'COPY_TRADING',
]);
export type ProhibitedCapabilityCategory = z.infer<typeof ProhibitedCapabilityCategorySchema>;

export const ProhibitedCapabilityFindingSchema = z
  .object({
    findingId: z.string().min(1),
    category: ProhibitedCapabilityCategorySchema,
    surface: z.enum([
      'SOURCE_SCAN',
      'DEPENDENCY_MANIFEST',
      'ROUTE_INVENTORY',
      'SCHEMA_INVENTORY',
      'ENV_SCHEMA',
      'RUNTIME_CANARY',
    ]),
    reference: z.string().min(1),
    matchedPattern: z.string().min(1),
  })
  .strict();

// --- FR-SEC-010/012: claims policy & public-output redaction --------------------------

export const ClaimsPolicyChannelSchema = z.enum(['MARKETING', 'UI', 'API', 'EXPORT']);

export const ClaimsPolicyResultSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('COMPLIANT'), channel: ClaimsPolicyChannelSchema }).strict(),
  z
    .object({
      verdict: z.literal('REFUSED'),
      channel: ClaimsPolicyChannelSchema,
      claimClasses: z
        .array(
          z.enum([
            'GUARANTEED_PROFIT',
            'RISK_FREE',
            'UNIVERSAL_RECALL',
            'UNCALIBRATED_PROBABILITY',
            'UNSUPPORTED_PERFORMANCE',
          ]),
        )
        .min(1),
    })
    .strict(),
]);

export const PublicOutputEnvelopeSchema = z
  .object({
    evidenceRefs: z.array(z.string().min(1)).min(1),
    timestamps: z.array(UtcTimestampSchema).min(1),
    executionAssumptions: z.array(z.string().min(1)).min(1),
    limitations: z.array(z.string().min(1)).min(1),
    disclaimer: z.string().min(1),
  })
  .strict();
export type PublicOutputEnvelope = z.infer<typeof PublicOutputEnvelopeSchema>;

export const PublicRedactionResultSchema = z.discriminatedUnion('verdict', [
  z
    .object({ verdict: z.literal('COMPLIANT'), redactionsApplied: z.number().int().nonnegative() })
    .strict(),
  z
    .object({
      verdict: z.literal('REFUSED'),
      reason: z.enum(['REQUIRED_FIELD_MISSING', 'SENSITIVE_DETAIL_PRESENT']),
      detail: z.string().max(500),
    })
    .strict(),
]);

// --- Registry (parse-by-name entrypoint mirroring the data/dr families) ------

export const SEC_SCHEMAS = {
  AuditEventRecord: AuditEventRecordSchema,
  AuditCheckpointRecord: AuditCheckpointRecordSchema,
  AuditVerifyRunRecord: AuditVerifyRunRecordSchema,
  StepUpPolicy: StepUpPolicySchema,
  StepUpProof: StepUpProofSchema,
  ActionGateDecision: ActionGateDecisionSchema,
  OriginVerdict: OriginVerdictSchema,
  ProtocolVerdict: ProtocolVerdictSchema,
  OAuthTokenBinding: OAuthTokenBindingSchema,
  EgressAllowlistEntry: EgressAllowlistEntrySchema,
  EgressDecision: EgressDecisionSchema,
  UntrustedContentEnvelope: UntrustedContentEnvelopeSchema,
  SecretLifecycleEvent: SecretLifecycleEventSchema,
  ImportArtifactManifest: ImportArtifactManifestSchema,
  ImportScanFinding: ImportScanFindingSchema,
  TenantContext: TenantContextSchema,
  SecurityIncidentRecord: SecurityIncidentRecordSchema,
  CapabilityPauseRecord: CapabilityPauseRecordSchema,
  ActivationEventRecord: ActivationEventRecordSchema,
  ThreatModelRegisterEntry: ThreatModelRegisterEntrySchema,
  ProhibitedCapabilityFinding: ProhibitedCapabilityFindingSchema,
} as const;

export type SecSchemaName = keyof typeof SEC_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. Throws ZodError on failure. */
export function parseSecSchema<T extends SecSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof SEC_SCHEMAS)[T]> {
  return SEC_SCHEMAS[name].parse(payload) as z.infer<(typeof SEC_SCHEMAS)[T]>;
}
