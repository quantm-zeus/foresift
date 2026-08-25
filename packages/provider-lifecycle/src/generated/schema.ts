/**
 * Drizzle mirror of SQL truth (ADR-001) — hand-maintained to match the tables
 * created by `migrations/g0_prov_*.sql` exactly, inside the dedicated `prov`
 * schema namespace (same arrangement as the proven `sec` family: keeps the
 * public-schema parity contract of @foresift/persistence untouched).
 *
 * This file NEVER defines schema semantics on its own: the SQL migrations are
 * the single source of truth and a parity test enumerates
 * `information_schema` (table_schema = 'prov') against these definitions.
 * Update both together, always.
 */
import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const prov = pgSchema('prov');

// --- g0_prov_0001_provider_operations -----------------------------------------

export const provProviders = prov.table('prov_providers', {
  providerId: text('provider_id').primaryKey(),
  providerGroup: text('provider_group').notNull(),
  displayName: text('display_name').notNull(),
  disabledByDefault: boolean('disabled_by_default').notNull().default(true),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
});

export const provOperations = prov.table(
  'prov_operations',
  {
    providerId: text('provider_id')
      .notNull()
      .references(() => provProviders.providerId),
    operationId: text('operation_id').notNull(),
    version: text('version').notNull(),
    capabilityClass: text('capability_class').notNull(),
    supportedChains: jsonb('supported_chains').notNull(),
    supportedPrograms: jsonb('supported_programs'),
    inputSchemaId: text('input_schema_id').notNull(),
    rawOutputSchemaId: text('raw_output_schema_id').notNull(),
    normalizedOutputSchemaId: text('normalized_output_schema_id').notNull(),
    quotaModelId: text('quota_model_id').notNull(),
    cachePolicyId: text('cache_policy_id').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    retryPolicyId: text('retry_policy_id').notNull(),
    declaredIndependenceGroup: text('declared_independence_group').notNull(),
    upstreamLineage: jsonb('upstream_lineage').notNull(),
    licensePolicyId: text('license_policy_id').notNull(),
    currentState: text('current_state').notNull().default('DISCOVERED'),
    healthStatus: text('health_status').notNull().default('HEALTHY'),
    costClass: text('cost_class').notNull(),
    estimatedQuotaUnits: numeric('estimated_quota_units').notNull(),
    quotaResetPolicyId: text('quota_reset_policy_id').notNull(),
    batchCapability: jsonb('batch_capability'),
    minimumCandidateStage: text('minimum_candidate_stage'),
    protectedReserveEligible: boolean('protected_reserve_eligible').notNull(),
    allowedInStrictFree: boolean('allowed_in_strict_free').notNull(),
    paidFallbackAllowed: boolean('paid_fallback_allowed').notNull(),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    sunsetAt: timestamp('sunset_at', { withTimezone: true }),
    replacementOperationId: text('replacement_operation_id'),
    verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }).notNull(),
    forbiddenOutputFields: jsonb('forbidden_output_fields').notNull(),
    negativeCapabilities: jsonb('negative_capabilities').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.operationId, t.version] })],
);

export const provOperationDependencies = prov.table('prov_operation_dependencies', {
  dependencyId: bigint('dependency_id', { mode: 'number' }).primaryKey(),
  consumerKind: text('consumer_kind').notNull(),
  consumerKey: text('consumer_key').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  criticalField: text('critical_field'),
  active: boolean('active').notNull().default(true),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
});

export const provLifecycleEvents = prov.table('prov_lifecycle_events', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  reasonClass: text('reason_class').notNull(),
  actor: text('actor').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull().default([]),
  idempotencyKey: text('idempotency_key').notNull(),
});

// --- g0_prov_0002_verification_ttl ----------------------------------------------

export const provVerificationTtlConfig = prov.table(
  'prov_verification_ttl_config',
  {
    providerId: text('provider_id').notNull(),
    kind: text('kind').notNull(),
    ttlSeconds: integer('ttl_seconds').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.kind] })],
);

export const provVerificationRecords = prov.table('prov_verification_records', {
  verificationSeq: bigint('verification_seq', { mode: 'number' }).primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  kind: text('kind').notNull(),
  source: text('source').notNull(),
  outcome: text('outcome').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
});

// --- g0_prov_0003_migration_exceptions -------------------------------------------

export const provMigrationExceptions = prov.table('prov_migration_exceptions', {
  exceptionId: text('exception_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  approver: text('approver').notNull(),
  replacementPlanRef: text('replacement_plan_ref').notNull(),
  replacementOperationId: text('replacement_operation_id'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
  exceptionExpiresAt: timestamp('exception_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  evidenceRefs: jsonb('evidence_refs').notNull(),
});

// --- g0_prov_0004_quarantine -------------------------------------------------------

export const provResponseQuarantine = prov.table('prov_response_quarantine', {
  quarantineId: text('quarantine_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  detectedClasses: text('detected_classes').array().notNull(),
  fieldPaths: jsonb('field_paths').notNull().default([]),
  payloadSha256: text('payload_sha256').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  disposition: text('disposition').notNull().default('REJECTED'),
  auditRef: text('audit_ref').notNull(),
  modelContextExclusion: text('model_context_exclusion').notNull().default('ENFORCED'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
});

// --- g0_prov_0005_rights_fingerprints -----------------------------------------------

export const provRightsDeclarations = prov.table(
  'prov_rights_declarations',
  {
    providerId: text('provider_id').notNull(),
    operationId: text('operation_id').notNull(),
    rightsVersion: integer('rights_version').notNull(),
    commercialUseAllowed: boolean('commercial_use_allowed').notNull(),
    personalResearchAllowed: boolean('personal_research_allowed').notNull(),
    cacheAllowed: boolean('cache_allowed').notNull(),
    maximumCacheDurationSeconds: bigint('maximum_cache_duration_seconds', { mode: 'number' }),
    rawRetentionAllowed: boolean('raw_retention_allowed').notNull(),
    derivedFeaturesAllowed: boolean('derived_features_allowed').notNull(),
    modelTrainingAllowed: boolean('model_training_allowed').notNull(),
    redistributionAllowed: boolean('redistribution_allowed').notNull(),
    publicAlertDerivativeAllowed: boolean('public_alert_derivative_allowed').notNull(),
    attributionRequired: boolean('attribution_required').notNull(),
    userByokRequired: boolean('user_byok_required').notNull(),
    rawExportAllowed: boolean('raw_export_allowed').notNull(),
    jurisdictionRestrictions: jsonb('jurisdiction_restrictions').notNull().default([]),
    termsVersion: text('terms_version').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }).notNull(),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.operationId, t.rightsVersion] })],
);

export const provRightsChanges = prov.table('prov_rights_changes', {
  changeId: text('change_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  fromRightsVersion: integer('from_rights_version').notNull(),
  toRightsVersion: integer('to_rights_version').notNull(),
  newlyProhibitedUses: text('newly_prohibited_uses').array().notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  changedBy: text('changed_by').notNull(),
});

export const provProviderArtifacts = prov.table('prov_provider_artifacts', {
  artifactId: text('artifact_id').primaryKey(),
  objectRef: text('object_ref').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  rightsVersion: integer('rights_version').notNull(),
  state: text('state').notNull().default('ACTIVE'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
});

export const provRightsChangeActions = prov.table(
  'prov_rights_change_actions',
  {
    actionId: text('action_id').primaryKey(),
    changeId: text('change_id')
      .notNull()
      .references(() => provRightsChanges.changeId),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => provProviderArtifacts.artifactId),
    action: text('action').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
  },
  // SQL truth: PRIMARY KEY (action_id) + UNIQUE (change_id, artifact_id).
  (t) => [unique('prov_rights_change_actions_unique_per_artifact').on(t.changeId, t.artifactId)],
);

export const provSourceFingerprints = prov.table(
  'prov_source_fingerprints',
  {
    providerId: text('provider_id').notNull(),
    operationId: text('operation_id').notNull(),
    operationVersion: text('operation_version').notNull(),
    fingerprintKind: text('fingerprint_kind').notNull(),
    fingerprintVersion: integer('fingerprint_version').notNull(),
    payloadCanonical: text('payload_canonical').notNull(),
    estimatorInputRefs: jsonb('estimator_input_refs').notNull().default([]),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.providerId,
        t.operationId,
        t.operationVersion,
        t.fingerprintKind,
        t.fingerprintVersion,
      ],
    }),
  ],
);
