/**
 * Drizzle mirror of SQL truth (ADR-001) — hand-maintained to match the tables
 * created by `migrations/g0_prov_*.sql` exactly, inside the dedicated `prov`
 * schema namespace (same failure-domain arrangement as the proven `sec`
 * namespace: keeps the public-schema parity contract of @foresift/persistence
 * byte-identical).
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
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const prov = pgSchema('prov');

// --- g0_prov_0001_provider_operations ----------------------------------------

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
    supportedChains: text('supported_chains').array().notNull(),
    supportedPrograms: jsonb('supported_programs').notNull(),
    inputSchemaId: text('input_schema_id').notNull(),
    rawOutputSchemaId: text('raw_output_schema_id').notNull(),
    normalizedOutputSchemaId: text('normalized_output_schema_id').notNull(),
    quotaModelId: text('quota_model_id').notNull(),
    cachePolicyId: text('cache_policy_id').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    retryPolicyId: text('retry_policy_id').notNull(),
    declaredIndependenceGroup: text('declared_independence_group').notNull(),
    upstreamLineage: text('upstream_lineage').array().notNull(),
    licensePolicyId: text('license_policy_id').notNull(),
    estimatedQuotaUnits: integer('estimated_quota_units').notNull(),
    quotaResetPolicyId: text('quota_reset_policy_id').notNull(),
    batchCapability: jsonb('batch_capability'),
    minimumCandidateStage: text('minimum_candidate_stage'),
    protectedReserveEligible: boolean('protected_reserve_eligible').notNull(),
    allowedInStrictFree: boolean('allowed_in_strict_free').notNull(),
    paidFallbackAllowed: boolean('paid_fallback_allowed').notNull(),
    lastDocumentationVerificationAt: timestamp('last_documentation_verification_at', {
      withTimezone: true,
    }),
    lastLiveProbeAt: timestamp('last_live_probe_at', { withTimezone: true }),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    sunsetAt: timestamp('sunset_at', { withTimezone: true }),
    replacementOperationId: text('replacement_operation_id'),
    verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }).notNull(),
    forbiddenOutputFields: text('forbidden_output_fields').array().notNull(),
    negativeCapabilities: text('negative_capabilities').array().notNull(),
    currentState: text('current_state').notNull(),
    healthStatus: text('health_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.operationId, t.version] })],
);

export const provOperationDependencies = prov.table('prov_operation_dependencies', {
  dependencyId: text('dependency_id').primaryKey(),
  consumerKind: text('consumer_kind').notNull(),
  consumerKey: text('consumer_key').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  active: boolean('active').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
});

export const provLifecycleEvents = prov.table('prov_lifecycle_events', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  eventId: text('event_id').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  version: text('version').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reasonClass: text('reason_class').notNull(),
  actor: text('actor').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
});

// --- g0_prov_0002_verification_ttl ---------------------------------------------

export const provVerificationTtlConfigs = prov.table('prov_verification_ttl_configs', {
  configId: text('config_id').primaryKey(),
  providerId: text('provider_id'),
  kind: text('kind').notNull(),
  ttlSeconds: integer('ttl_seconds').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const provVerificationRecords = prov.table('prov_verification_records', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  verificationId: text('verification_id').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  kind: text('kind').notNull(),
  source: text('source').notNull(),
  outcome: text('outcome').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  notes: text('notes'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
});

// --- g0_prov_0003_migration_exceptions ------------------------------------------

export const provMigrationExceptions = prov.table('prov_migration_exceptions', {
  exceptionId: text('exception_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  approver: text('approver').notNull(),
  reason: text('reason').notNull(),
  replacementPlanId: text('replacement_plan_id').notNull(),
  replacementPlan: jsonb('replacement_plan'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  exceptionExpiresAt: timestamp('exception_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: text('revoked_by'),
});

// --- g0_prov_0004_quarantine ------------------------------------------------------
// Deliberately NO payload-body column — quarantine persists metadata only
// (plan material decision 6).

export const provResponseQuarantine = prov.table('prov_response_quarantine', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  quarantineId: text('quarantine_id').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  detectedClasses: text('detected_classes').array().notNull(),
  fieldPaths: text('field_paths').array().notNull(),
  payloadSha256: text('payload_sha256').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  disposition: text('disposition').notNull(),
  modelContextExclusion: text('model_context_exclusion').notNull(),
  auditChainRef: text('audit_chain_ref').notNull(),
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }).notNull(),
  details: text('details'),
});

// --- g0_prov_0005_rights_fingerprints ---------------------------------------------

export const provRightsDeclarations = prov.table('prov_rights_declarations', {
  declarationId: text('declaration_id').primaryKey(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  rightsVersion: integer('rights_version').notNull(),
  // the sixteen §15.6 fields
  commercialUseAllowed: boolean('commercial_use_allowed').notNull(),
  personalResearchAllowed: boolean('personal_research_allowed').notNull(),
  cacheAllowed: boolean('cache_allowed').notNull(),
  maximumCacheDurationSeconds: integer('maximum_cache_duration_seconds').notNull(),
  rawRetentionAllowed: boolean('raw_retention_allowed').notNull(),
  derivedFeaturesAllowed: boolean('derived_features_allowed').notNull(),
  modelTrainingAllowed: boolean('model_training_allowed').notNull(),
  redistributionAllowed: boolean('redistribution_allowed').notNull(),
  publicAlertDerivativeAllowed: boolean('public_alert_derivative_allowed').notNull(),
  attributionRequired: boolean('attribution_required').notNull(),
  userByokRequired: boolean('user_byok_required').notNull(),
  rawExportAllowed: boolean('raw_export_allowed').notNull(),
  jurisdictionRestrictions: text('jurisdiction_restrictions').array().notNull(),
  termsVersion: text('terms_version').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }).notNull(),
  declaredAt: timestamp('declared_at', { withTimezone: true }).notNull(),
});

export const provRightsChanges = prov.table('prov_rights_changes', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  changeId: text('change_id').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  fromRightsVersion: integer('from_rights_version').notNull(),
  toRightsVersion: integer('to_rights_version').notNull(),
  newlyProhibitedUses: text('newly_prohibited_uses').array().notNull(),
  tightened: boolean('tightened').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  actor: text('actor').notNull(),
  auditChainRef: text('audit_chain_ref').notNull(),
});

export const provProviderArtifacts = prov.table('prov_provider_artifacts', {
  artifactId: text('artifact_id').primaryKey(),
  objectRef: text('object_ref').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  rightsVersion: integer('rights_version').notNull(),
  state: text('state').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const provRightsChangeActions = prov.table('prov_rights_change_actions', {
  actionId: text('action_id').primaryKey(),
  changeId: text('change_id').notNull(),
  artifactId: text('artifact_id').notNull(),
  action: text('action').notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
  details: text('details'),
});

export const provSourceFingerprints = prov.table('prov_source_fingerprints', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  fingerprintId: text('fingerprint_id').notNull(),
  providerId: text('provider_id').notNull(),
  operationId: text('operation_id').notNull(),
  operationVersion: text('operation_version').notNull(),
  kind: text('kind').notNull(),
  fingerprintPayloadCanonical: text('fingerprint_payload_canonical').notNull(),
  fingerprintSha256: text('fingerprint_sha256').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  estimatorInputRefs: jsonb('estimator_input_refs').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
});
