/**
 * Drizzle mirror of SQL truth (ADR-001) — hand-maintained to match the tables
 * created by `migrations/g0_(data|dr)_*.sql` exactly.
 *
 * This file NEVER defines schema semantics on its own: the SQL migrations are
 * the single source of truth and a parity test enumerates
 * `information_schema` against these definitions (columns, nullability, type
 * classes, primary keys). Update both together, always.
 */
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// --- g0_data_0001_identity -------------------------------------------------

export const chains = pgTable('chains', {
  chainId: text('chain_id').primaryKey(),
  namespace: text('namespace').notNull(),
  reference: text('reference').notNull(),
  mappingQuality: text('mapping_quality').notNull(),
  internalIdVersion: integer('internal_id_version'),
});

export const qualityCodes = pgTable('quality_codes', {
  code: text('code').primaryKey(),
});

export const dexes = pgTable(
  'dexes',
  {
    chainId: text('chain_id').notNull(),
    dexId: text('dex_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.dexId] })],
);

export const assets = pgTable('assets', {
  assetId: text('asset_id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const assetRepresentations = pgTable(
  'asset_representations',
  {
    chainId: text('chain_id').notNull(),
    canonicalAddress: text('canonical_address').notNull(),
    decimalsState: text('decimals_state').notNull(),
    decimals: integer('decimals'),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.canonicalAddress] })],
);

export const assetMemberships = pgTable(
  'asset_memberships',
  {
    assetId: text('asset_id').notNull(),
    chainId: text('chain_id').notNull(),
    canonicalAddress: text('canonical_address').notNull(),
    verification: text('verification').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.canonicalAddress] })],
);

export const pools = pgTable('pools', {
  poolId: text('pool_id').primaryKey(),
  chainId: text('chain_id').notNull(),
  dexId: text('dex_id').notNull(),
  poolAddress: text('pool_address').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const pairs = pgTable('pairs', {
  pairId: text('pair_id').primaryKey(),
  poolId: text('pool_id').notNull(),
  baseAssetId: text('base_asset_id').notNull(),
  quoteAssetId: text('quote_asset_id').notNull(),
  orientationUnverified: boolean('orientation_unverified').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
});

export const launches = pgTable('launches', {
  launchId: text('launch_id').primaryKey(),
  poolId: text('pool_id').notNull(),
  launchedAt: timestamp('launched_at', { withTimezone: true }),
  sourceRef: text('source_ref').notNull(),
});

export const migrationEdges = pgTable('migration_edges', {
  migrationId: text('migration_id').primaryKey(),
  launchPoolId: text('launch_pool_id').notNull(),
  migratedPoolId: text('migrated_pool_id').notNull(),
  status: text('status').notNull(),
  migratedAt: timestamp('migrated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const tokenDecimalObservations = pgTable('token_decimal_observations', {
  observationId: text('observation_id').primaryKey(),
  chainId: text('chain_id').notNull(),
  canonicalAddress: text('canonical_address').notNull(),
  decimals: integer('decimals').notNull(),
  state: text('state').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  sourceRef: text('source_ref').notNull(),
});

// --- g0_data_0002_observations_revisions -----------------------------------

export const observations = pgTable('observations', {
  observationId: text('observation_id').primaryKey(),
  subjectPoolId: text('subject_pool_id'),
  subjectAssetId: text('subject_asset_id'),
  eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  sourceObservedAt: timestamp('source_observed_at', { withTimezone: true }),
  sourcePublishedAt: timestamp('source_published_at', { withTimezone: true }),
  authorizedAt: timestamp('authorized_at', { withTimezone: true }),
  requestedAt: timestamp('requested_at', { withTimezone: true }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  revisedAt: timestamp('revised_at', { withTimezone: true }),
  availabilityProvenance: text('availability_provenance').notNull(),
  rawAmount: text('raw_amount'),
  decimals: integer('decimals'),
  coordinatesChainId: text('coordinates_chain_id'),
  blockNumberOrSlot: numeric('block_number_or_slot'),
  blockHash: text('block_hash'),
  parentBlockHashOrParentSlot: text('parent_block_hash_or_parent_slot'),
  transactionHash: text('transaction_hash'),
  transactionIndex: integer('transaction_index'),
  instructionIndex: integer('instruction_index'),
  innerInstructionIndex: integer('inner_instruction_index'),
  confirmationLevel: text('confirmation_level'),
  reorgVersion: integer('reorg_version').notNull(),
  collectorOrProviderCursor: text('collector_or_provider_cursor'),
  qualityCodes: text('quality_codes').array().notNull(),
  receiptHash: text('receipt_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const observationRevisions = pgTable('observation_revisions', {
  revisionId: text('revision_id').primaryKey(),
  observationId: text('observation_id').notNull(),
  revisionNo: integer('revision_no').notNull(),
  reason: text('reason').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  availabilityProvenance: text('availability_provenance').notNull(),
  supersededReceiptHash: text('superseded_receipt_hash').notNull(),
  rawAmount: text('raw_amount'),
  decimals: integer('decimals'),
  qualityCodes: text('quality_codes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const compensatingEvents = pgTable('compensating_events', {
  compensationId: text('compensation_id').primaryKey(),
  targetObservationId: text('target_observation_id').notNull(),
  kind: text('kind').notNull(),
  originalReceiptHash: text('original_receipt_hash').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const backfillReceipts = pgTable('backfill_receipts', {
  backfillReceiptId: text('backfill_receipt_id').primaryKey(),
  backfillJobId: text('backfill_job_id').notNull(),
  backfillReason: text('backfill_reason').notNull(),
  historicalEventAt: timestamp('historical_event_at', { withTimezone: true }).notNull(),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  retrospectiveOnly: boolean('retrospective_only').notNull(),
  wouldHaveBeenObservableLive: boolean('would_have_been_observable_live'),
  availabilityProofMethod: text('availability_proof_method').notNull(),
  liveReceiptRef: text('live_receipt_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const watermarks = pgTable(
  'watermarks',
  {
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    collectorShard: text('collector_shard').notNull(),
    programVersion: text('program_version').notNull(),
    chainId: text('chain_id').notNull(),
    highestObservedSlot: numeric('highest_observed_slot').notNull(),
    highestContiguousSlot: numeric('highest_contiguous_slot').notNull(),
    highestFinalizedSlot: numeric('highest_finalized_slot'),
    oldestOpenGapStart: numeric('oldest_open_gap_start'),
    oldestOpenGapEnd: numeric('oldest_open_gap_end'),
    maximumLatenessSeenMs: bigint('maximum_lateness_seen_ms', { mode: 'number' }).notNull(),
    gapRecoveryStatus: text('gap_recovery_status').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.provider, t.operation, t.collectorShard, t.programVersion, t.chainId],
    }),
  ],
);

// --- g0_data_0003_quality_sources ------------------------------------------

export const observationFieldQuality = pgTable('observation_field_quality', {
  fieldQualityId: text('field_quality_id').primaryKey(),
  observationId: text('observation_id').notNull(),
  fieldPath: text('field_path').notNull(),
  valueRaw: text('value_raw'),
  qualityCodes: text('quality_codes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const sourceIdentities = pgTable('source_identities', {
  sourceId: text('source_id').primaryKey(),
  brandProvider: text('brand_provider').notNull(),
  operation: text('operation').notNull(),
  upstreamLineageKey: text('upstream_lineage_key').notNull(),
  endpointRegion: text('endpoint_region').notNull(),
  collectionMethod: text('collection_method').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const independenceGroups = pgTable('independence_groups', {
  groupId: text('group_id').primaryKey(),
  upstreamLineageKey: text('upstream_lineage_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const sourceGroupMemberships = pgTable(
  'source_group_memberships',
  {
    groupId: text('group_id').notNull(),
    sourceIdentityId: text('source_identity_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.sourceIdentityId] })],
);

export const sourceDependenceEdges = pgTable('source_dependence_edges', {
  edgeId: text('edge_id').primaryKey(),
  sourceA: text('source_a').notNull(),
  sourceB: text('source_b').notNull(),
  sharedUpstreamLineageKeys: text('shared_upstream_lineage_keys').array().notNull(),
  valueErrorTimingCorrelation: doublePrecision('value_error_timing_correlation').notNull(),
  outageOverlap: doublePrecision('outage_overlap').notNull(),
  firstSeenLagAgreement: doublePrecision('first_seen_lag_agreement').notNull(),
  fingerprintSimilarity: doublePrecision('fingerprint_similarity').notNull(),
  label: text('label').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g0_data_0004_features_acquisition -------------------------------------

export const featureDefinitions = pgTable('feature_definitions', {
  definitionId: text('definition_id').primaryKey(),
  name: text('name').notNull(),
  version: integer('version').notNull(),
  unitSemantics: text('unit_semantics').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const featureValues = pgTable('feature_values', {
  valueId: text('value_id').primaryKey(),
  definitionId: text('definition_id').notNull(),
  featureVersion: integer('feature_version').notNull(),
  computationCodeVersion: text('computation_code_version').notNull(),
  subjectKey: text('subject_key').notNull(),
  eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
  decimalString: text('decimal_string'),
  scale: integer('scale'),
  qualityCodes: text('quality_codes').array().notNull(),
  populationKind: text('population_kind').notNull(),
  lineageRefs: text('lineage_refs').array().notNull(),
  storeClass: text('store_class').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const evidenceAcquisitionDecisions = pgTable('evidence_acquisition_decisions', {
  decisionId: text('decision_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  evidenceFamily: text('evidence_family').notNull(),
  policyVersion: text('policy_version').notNull(),
  state: text('state').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  assignmentProbability: doublePrecision('assignment_probability'),
  estimatedDecisionImpact: doublePrecision('estimated_decision_impact'),
  estimatedInformationValue: doublePrecision('estimated_information_value'),
  actualDecisionChanged: boolean('actual_decision_changed'),
  evidenceIds: text('evidence_ids').array().notNull(),
  impactRecordedAt: timestamp('impact_recorded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const evidenceBundles = pgTable('evidence_bundles', {
  bundleId: text('bundle_id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  manifest: jsonb('manifest').notNull(),
  frozenAt: timestamp('frozen_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g0_data_0006_probe_assignments -----------------------------------------

export const probeAssignments = pgTable('probe_assignments', {
  decisionId: text('decision_id').primaryKey(),
  eligibilityStratum: text('eligibility_stratum').notNull(),
  assignmentProbability: doublePrecision('assignment_probability').notNull(),
  seedProvenance: text('seed_provenance').notNull(),
  selectionAt: timestamp('selection_at', { withTimezone: true }).notNull(),
  requestedFields: text('requested_fields').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g0_data_0005_object_artifact_index ------------------------------------

export const objectArtifacts = pgTable('object_artifacts', {
  artifactId: text('artifact_id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  stage: text('stage').notNull(),
  encryptionStatus: text('encryption_status').notNull(),
  rightsRef: text('rights_ref'),
  retentionClass: text('retention_class').notNull(),
  version: integer('version').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),
  hashVerifiedAt: timestamp('hash_verified_at', { withTimezone: true }),
  indexCommittedAt: timestamp('index_committed_at', { withTimezone: true }),
  availableAt: timestamp('available_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const canonicalEventKeys = pgTable('canonical_event_keys', {
  canonicalKey: text('canonical_key').primaryKey(),
  eventFamily: text('event_family').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
});

// --- g0_dr_0001_recovery_tiers ----------------------------------------------

export const recoveryTiers = pgTable('recovery_tiers', {
  tierId: text('tier_id').primaryKey(),
  dataClass: text('data_class').notNull(),
  rpoTargetMinutes: numeric('rpo_target_minutes').notNull(),
  rtoTargetMinutes: numeric('rto_target_minutes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const protectedAssets = pgTable('protected_assets', {
  assetKey: text('asset_key').primaryKey(),
  dataClass: text('data_class').notNull(),
  tierId: text('tier_id').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
});

export const tierMeasurements = pgTable('tier_measurements', {
  measurementId: text('measurement_id').primaryKey(),
  tierId: text('tier_id').notNull(),
  achievedRpoMinutes: numeric('achieved_rpo_minutes').notNull(),
  achievedRtoMinutes: numeric('achieved_rto_minutes').notNull(),
  outcome: text('outcome').notNull(),
  incidentId: text('incident_id'),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
});

// --- g0_dr_0002_backup_policy ------------------------------------------------

export const backupPolicies = pgTable('backup_policies', {
  policyId: text('policy_id').primaryKey(),
  retentionDays: integer('retention_days').notNull(),
  encryptionStatus: text('encryption_status').notNull(),
  locationRef: text('location_ref').notNull(),
  rightsRef: text('rights_ref').notNull(),
  legalHold: boolean('legal_hold').notNull(),
  deletionPolicy: text('deletion_policy').notNull(),
  keyReference: text('key_reference').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const backupRuns = pgTable('backup_runs', {
  runId: text('run_id').primaryKey(),
  policyId: text('policy_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull(),
  artifactRefs: text('artifact_refs').array().notNull(),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const restoreDrills = pgTable('restore_drills', {
  drillId: text('drill_id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  outcome: text('outcome').notNull(),
  checks: jsonb('checks').notNull(),
  credentialProviderPresent: boolean('credential_provider_present').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const recoveryHealthStates = pgTable('recovery_health_states', {
  healthStateId: text('health_state_id').primaryKey(),
  capability: text('capability').notNull(),
  kind: text('kind').notNull(),
  confirmedOpportunityInfluenceBlocked: boolean(
    'confirmed_opportunity_influence_blocked',
  ).notNull(),
  deterministicRiskMonitoringAllowed: boolean('deterministic_risk_monitoring_allowed').notNull(),
  incidentId: text('incident_id'),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
});

// --- g0_data_0007_checkpoints_gaps ------------------------------------------

export const collectorCheckpoints = pgTable('collector_checkpoints', {
  shardId: text('shard_id').primaryKey(),
  fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
  cursorPosition: bigint('cursor_position', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const collectorGaps = pgTable('collector_gaps', {
  gapId: text('gap_id').primaryKey(),
  shardId: text('shard_id').notNull(),
  gapStartSlot: bigint('gap_start_slot', { mode: 'number' }).notNull(),
  gapEndSlot: bigint('gap_end_slot', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  recoveryStatus: text('recovery_status').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

// --- g0_dr_0003_incidents ----------------------------------------------------

export const recoveryIncidents = pgTable('recovery_incidents', {
  incidentId: text('incident_id').primaryKey(),
  tierId: text('tier_id'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  kind: text('kind').notNull(),
  reason: text('reason').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});
