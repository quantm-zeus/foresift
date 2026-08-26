/**
 * Drizzle mirror of SQL truth (ADR-001) — hand-maintained to match the tables
 * created by `migrations/g0_prov_*.sql` exactly, inside the dedicated `prov`
 * schema namespace (same arrangement as the security perimeter's `sec`
 * schema: keeps the proven public-schema parity contract of
 * @foresift/persistence untouched).
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
} from 'drizzle-orm/pg-core';

export const prov = pgSchema('prov');

// --- g0_prov_0001_provider_operations ------------------------------------------

export const provProviders = prov.table('prov_providers', {
  providerId: text('provider_id').primaryKey(),
  displayName: text('display_name').notNull(),
  providerGroup: text('provider_group').notNull(),
  disabledByDefault: boolean('disabled_by_default').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const provOperations = prov.table(
  'prov_operations',
  {
    providerId: text('provider_id').notNull(),
    operationId: text('operation_id').notNull(),
    version: text('version').notNull(),
    capabilityClass: text('capability_class').notNull(),
    costClass: text('cost_class').notNull(),
    currentState: text('current_state').notNull(),
    healthStatus: text('health_status').notNull(),
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
    estimatedQuotaUnits: numeric('estimated_quota_units').notNull(),
    quotaResetPolicyId: text('quota_reset_policy_id').notNull(),
    batchMaxEntities: integer('batch_max_entities'),
    batchMaxBytes: integer('batch_max_bytes'),
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
  (t) => [primaryKey({ name: 'prov_operations_pk', columns: [t.providerId, t.operationId, t.version] })],
);

export const provOperationDependencies = prov.table('prov_operation_dependencies', {
  dependencyId: text('dependency_id').primaryKey(),
  consumerKind: text('consumer_kind').notNull(),
  consumerKey: text('consumer_key').notNull(),
  criticalField: text('critical_field'),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  active: boolean('active').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
});

export const provLifecycleEvents = prov.table('prov_lifecycle_events', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reasonClass: text('reason_class').notNull(),
  actor: text('actor').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  auditEntrySeq: bigint('audit_entry_seq', { mode: 'number' }),
  idempotencyKey: text('idempotency_key').notNull(),
});

// --- g0_prov_0002_verification_ttl -----------------------------------------------

export const provVerificationRecords = prov.table('prov_verification_records', {
  recordId: text('record_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  kind: text('kind').notNull(),
  source: text('source').notNull(),
  outcome: text('outcome').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  recordedBy: text('recorded_by').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
});

export const provVerificationTtlConfig = prov.table('prov_verification_ttl_config', {
  configId: text('config_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  kind: text('kind').notNull(),
  ttlSeconds: integer('ttl_seconds').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// --- g0_prov_0003_migration_exceptions ---------------------------------------------

export const provMigrationExceptions = prov.table('prov_migration_exceptions', {
  exceptionId: text('exception_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  approver: text('approver').notNull(),
  replacementPlanRef: text('replacement_plan_ref').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  exceptionExpiresAt: timestamp('exception_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: text('revoked_by'),
});

// --- g0_prov_0004_quarantine -----------------------------------------------------------

export const provResponseQuarantine = prov.table('prov_response_quarantine', {
  quarantineId: text('quarantine_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  detectedClasses: text('detected_classes').array().notNull(),
  fieldPaths: jsonb('field_paths').notNull(),
  payloadSha256: text('payload_sha256').notNull(),
  byteSize: integer('byte_size').notNull(),
  disposition: text('disposition').notNull(),
  modelContextExclusion: text('model_context_exclusion').notNull(),
  detectorVersion: text('detector_version').notNull(),
  auditEntrySeq: bigint('audit_entry_seq', { mode: 'number' }),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
});

// --- g0_prov_0005_rights_fingerprints ---------------------------------------------------

export const provRightsDeclarations = prov.table(
  'prov_rights_declarations',
  {
    declarationId: text('declaration_id').primaryKey(),
    providerId: text('provider_id').notNull(),
    operationId: text('operation_id').notNull(),
    operationVersion: text('operation_version').notNull(),
    rightsVersion: text('rights_version').notNull(),
    commercialUseAllowed: boolean('commercial_use_allowed').notNull(),
    personalResearchAllowed: boolean('personal_research_allowed').notNull(),
    cacheAllowed: boolean('cache_allowed').notNull(),
    maximumCacheDuration: text('maximum_cache_duration'),
    rawRetentionAllowed: boolean('raw_retention_allowed').notNull(),
    derivedFeaturesAllowed: boolean('derived_features_allowed').notNull(),
    modelTrainingAllowed: boolean('model_training_allowed').notNull(),
    redistributionAllowed: boolean('redistribution_allowed').notNull(),
    publicAlertDerivativeAllowed: boolean('public_alert_derivative_allowed').notNull(),
    attributionRequired: boolean('attribution_required').notNull(),
    userByokRequired: boolean('user_byok_required').notNull(),
    rawExportAllowed: boolean('raw_export_allowed').notNull(),
    jurisdictionRestrictions: jsonb('jurisdiction_restrictions').notNull(),
    termsVersion: text('terms_version').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }).notNull(),
  },
);

export const provRightsChanges = prov.table('prov_rights_changes', {
  changeId: text('change_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  fromRightsVersion: text('from_rights_version').notNull(),
  toRightsVersion: text('to_rights_version').notNull(),
  newlyProhibitedUses: text('newly_prohibited_uses').array().notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  declaredBy: text('declared_by').notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
});

export const provProviderArtifacts = prov.table('prov_provider_artifacts', {
  artifactId: text('artifact_id').primaryKey(),
  objectRef: text('object_ref').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  rightsVersionAtCapture: text('rights_version_at_capture').notNull(),
  state: text('state').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
});

export const provRightsChangeActions = prov.table('prov_rights_change_actions', {
  actionId: text('action_id').primaryKey(),
  changeId: text('change_id').notNull(),
  artifactId: text('artifact_id').notNull(),
  action: text('action').notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
  executedBy: text('executed_by').notNull(),
});

export const provSourceFingerprints = prov.table('prov_source_fingerprints', {
  fingerprintId: text('fingerprint_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  kind: text('kind').notNull(),
  version: integer('version').notNull(),
  payloadCanonical: text('payload_canonical').notNull(),
  payloadSha256: text('payload_sha256').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  estimatorInputs: jsonb('estimator_inputs').notNull(),
});
