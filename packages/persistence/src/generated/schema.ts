/**
 * Drizzle mirror of SQL truth (ADR-001) — hand-maintained to match the tables
 * created by `migrations/g*_*_*.sql` (G0 data/dr + G1 solsec/trd/sup/exec)
 * exactly.
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
  retrievedAsBackfill: boolean('retrieved_as_backfill').notNull(),
  unavailabilityReason: text('unavailability_reason'),
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
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  method: text('method').notNull(),
  evidenceIds: text('evidence_ids').array().notNull(),
  confidence: doublePrecision('confidence').notNull(),
  effectiveIndependenceMultiplier: doublePrecision('effective_independence_multiplier').notNull(),
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
  candidateStateAtRequest: text('candidate_state_at_request'),
  requestedFields: text('requested_fields').array().notNull(),
  expectedValueOfInformation: doublePrecision('expected_value_of_information'),
  estimatedCost: numeric('estimated_cost'),
  actualCost: numeric('actual_cost'),
  failureKind: text('failure_kind'),
  acquisitionSeed: text('acquisition_seed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const evidenceBundles = pgTable('evidence_bundles', {
  bundleId: text('bundle_id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  manifest: jsonb('manifest').notNull(),
  frozenAt: timestamp('frozen_at', { withTimezone: true }).notNull(),
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

// --- g0_mcp_0001_sessions -----------------------------------------------------

export const g0McpSessions = pgTable('g0_mcp_sessions', {
  sessionId: text('session_id').primaryKey(),
  actor: text('actor').notNull(),
  credentialId: text('credential_id').notNull(),
  profileId: text('profile_id').notNull(),
  origin: text('origin'),
  protocolRevision: text('protocol_revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
});

// --- g0_mcp_0002_rate_state ---------------------------------------------------

export const g0McpRateState = pgTable(
  'g0_mcp_rate_state',
  {
    credentialId: text('credential_id').notNull(),
    rateLimitClass: text('rate_limit_class').notNull(),
    bucketCapacity: numeric('bucket_capacity').notNull(),
    availableTokens: numeric('available_tokens').notNull(),
    refillTokensPerSec: numeric('refill_tokens_per_sec').notNull(),
    lastRefilledAt: timestamp('last_refilled_at', { withTimezone: true }).notNull(),
    inFlight: integer('in_flight').notNull(),
    concurrencyLimit: integer('concurrency_limit').notNull(),
    fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.credentialId, t.rateLimitClass] })],
);

// --- g1_data_0001_decision_semantics -----------------------------------------

export const candidateDecisionTimelines = pgTable(
  'candidate_decision_timelines',
  {
    candidateId: text('candidate_id').notNull(),
    policyVersion: text('policy_version').notNull(),
    decisionReadyAt: timestamp('decision_ready_at', { withTimezone: true }).notNull(),
    policyDecidedAt: timestamp('policy_decided_at', { withTimezone: true }).notNull(),
    workflowCompletedAt: timestamp('workflow_completed_at', { withTimezone: true }).notNull(),
    deliveryEligibleAt: timestamp('delivery_eligible_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    counterfactualDeliveryVersion: text('counterfactual_delivery_version'),
    counterfactualDeliveryAt: timestamp('counterfactual_delivery_at', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.candidateId, t.policyVersion, t.decisionReadyAt],
    }),
  ],
);

// --- g1_data_0002_dependence_conflicts ---------------------------------------

export const empiricalDependenceObservations = pgTable('empirical_dependence_observations', {
  observationId: text('observation_id').primaryKey(),
  sourceA: text('source_a').notNull(),
  sourceB: text('source_b').notNull(),
  correlatedValues: doublePrecision('correlated_values').notNull(),
  correlatedErrors: doublePrecision('correlated_errors').notNull(),
  updateTimingSync: doublePrecision('update_timing_sync').notNull(),
  firstSeenSync: doublePrecision('first_seen_sync').notNull(),
  outageOverlap: doublePrecision('outage_overlap').notNull(),
  schemaFingerprintSimilarity: doublePrecision('schema_fingerprint_similarity').notNull(),
  commonMissingness: doublePrecision('common_missingness').notNull(),
  declaredUpstreamRelationship: text('declared_upstream_relationship').notNull(),
  estimatedAt: timestamp('estimated_at', { withTimezone: true }).notNull(),
  estimatedFrom: timestamp('estimated_from', { withTimezone: true }).notNull(),
  estimatedTo: timestamp('estimated_to', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const providerConflicts = pgTable('provider_conflicts', {
  conflictId: text('conflict_id').primaryKey(),
  subjectObservationIds: text('subject_observation_ids').array().notNull(),
  conflictClass: text('conflict_class').notNull(),
  fieldPath: text('field_path').notNull(),
  resolvedByRule: text('resolved_by_rule'),
  qualityCode: text('quality_code').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_sup_0001_supply_assessments ------------------------------------------

export const supplyAssessments = pgTable('supply_assessments', {
  assessmentId: text('assessment_id').primaryKey(),
  assetRepresentationId: text('asset_representation_id').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  totalSupplyRaw: text('total_supply_raw').notNull(),
  estimatedCirculatingSupplyRaw: text('estimated_circulating_supply_raw'),
  excludedSupplyRaw: text('excluded_supply_raw'),
  source: text('source').notNull(),
  method: text('method').notNull(),
  confidence: doublePrecision('confidence').notNull(),
  exclusionEvidenceIds: text('exclusion_evidence_ids').array().notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  marketCapBasis: text('market_cap_basis').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const marketCapFallbackDecisions = pgTable('market_cap_fallback_decisions', {
  decisionId: text('decision_id').primaryKey(),
  assessmentId: text('assessment_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  lowConfidenceMarketCap: boolean('low_confidence_market_cap').notNull(),
  hardRejected: boolean('hard_rejected').notNull(),
  marketCapIsSoleHardRejection: boolean('market_cap_is_sole_hard_rejection').notNull(),
  approvedLiquidityFallbackAvailable: boolean('approved_liquidity_fallback_available').notNull(),
  approvedActivityFallbackAvailable: boolean('approved_activity_fallback_available').notNull(),
  appliedFallback: text('applied_fallback'),
  policyVersion: text('policy_version').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  rationale: text('rationale').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_trd_0001_economic_trade_events ---------------------------------------

export const economicTradeEvents = pgTable('economic_trade_events', {
  eventId: text('event_id').primaryKey(),
  chainId: text('chain_id').notNull(),
  transactionHash: text('transaction_hash').notNull(),
  actorEntityId: text('actor_entity_id'),
  actorResolutionState: text('actor_resolution_state').notNull(),
  actorResolutionConfidence: doublePrecision('actor_resolution_confidence').notNull(),
  actorUncertaintyFactor: doublePrecision('actor_uncertainty_factor').notNull(),
  contributionFactor: doublePrecision('contribution_factor').notNull(),
  assetRepresentationId: text('asset_representation_id').notNull(),
  netAssetDeltaRaw: text('net_asset_delta_raw').notNull(),
  netQuoteDeltaUsd: text('net_quote_delta_usd'),
  side: text('side').notNull(),
  routeLegIds: text('route_leg_ids').array().notNull(),
  classificationConfidence: doublePrecision('classification_confidence').notNull(),
  eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const economicRouteLegs = pgTable('economic_route_legs', {
  routeLegId: text('route_leg_id').primaryKey(),
  eventId: text('event_id').notNull(),
  legIndex: integer('leg_index').notNull(),
  kind: text('kind').notNull(),
  fromAccount: text('from_account'),
  toAccount: text('to_account'),
  assetRepresentationId: text('asset_representation_id').notNull(),
  netAssetDeltaRaw: text('net_asset_delta_raw').notNull(),
  rawObservationIds: text('raw_observation_ids').array().notNull(),
  eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// ── G1 solsec (migrations/g1_solsec_*.sql) — Solana security analyzer ───────

export const tokenProgramAssessments = pgTable('token_program_assessments', {
  assessmentId: text('assessment_id').primaryKey(),
  assetRepresentationId: text('asset_representation_id').notNull(),
  chainId: text('chain_id').notNull(),
  programOwner: text('program_owner').notNull(),
  programVersion: text('program_version').notNull(),
  analyzerVersion: text('analyzer_version').notNull(),
  decimals: integer('decimals').notNull(),
  totalSupplyRaw: text('total_supply_raw').notNull(),
  transferSemanticsSupport: text('transfer_semantics_support').notNull(),
  deterministicEvidenceIds: text('deterministic_evidence_ids').array().notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  schemaRegistryVersion: integer('schema_registry_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const tokenControlFindings = pgTable('token_control_findings', {
  findingId: text('finding_id').primaryKey(),
  assessmentId: text('assessment_id').notNull(),
  control: text('control').notNull(),
  controlState: text('control_state').notNull(),
  severity: text('severity'),
  authorityAddress: text('authority_address'),
  extensionDataHash: text('extension_data_hash'),
  evidenceIds: text('evidence_ids').array().notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const tokenExtensionSupport = pgTable(
  'token_extension_support',
  {
    assessmentId: text('assessment_id').notNull(),
    extensionType: text('extension_type').notNull(),
    extensionDataHash: text('extension_data_hash').notNull(),
    support: text('support').notNull(),
    verdictPolicyVersion: text('verdict_policy_version').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
    qualityCodes: text('quality_codes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.assessmentId, t.extensionType, t.verdictPolicyVersion] })],
);

export const poolSecurityAssessments = pgTable('pool_security_assessments', {
  assessmentId: text('assessment_id').primaryKey(),
  poolId: text('pool_id').notNull(),
  adapterId: text('adapter_id').notNull(),
  adapterVersion: text('adapter_version').notNull(),
  adapterSupportState: text('adapter_support_state').notNull(),
  lpControlState: text('lp_control_state'),
  withdrawalAuthorityState: text('withdrawal_authority_state'),
  liquidityRemovalRisk: text('liquidity_removal_risk'),
  quoteParityState: text('quote_parity_state'),
  stateCompleteness: text('state_completeness').notNull(),
  migrationLineageId: text('migration_lineage_id'),
  liquidityConcentration: text('liquidity_concentration'),
  evidenceIds: text('evidence_ids').array().notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  schemaRegistryVersion: integer('schema_registry_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const securityProviderReports = pgTable('security_provider_reports', {
  reportId: text('report_id').primaryKey(),
  assessmentId: text('assessment_id').notNull(),
  sourceId: text('source_id').notNull(),
  providerReportId: text('provider_report_id').notNull(),
  providerVersion: text('provider_version').notNull(),
  verdict: text('verdict').notNull(),
  rawPayloadRef: text('raw_payload_ref').notNull(),
  findingIds: text('finding_ids').array().notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const securityConflicts = pgTable('security_conflicts', {
  conflictId: text('conflict_id').primaryKey(),
  assessmentId: text('assessment_id').notNull(),
  providerReportId: text('provider_report_id').notNull(),
  conflictClass: text('conflict_class').notNull(),
  deterministicFindingIds: text('deterministic_finding_ids').array().notNull(),
  resolution: text('resolution').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const systemAddressRegistry = pgTable('system_address_registry', {
  registryEntryId: text('registry_entry_id').primaryKey(),
  chainId: text('chain_id').notNull(),
  address: text('address').notNull(),
  role: text('role').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  sourceId: text('source_id').notNull(),
  confidence: doublePrecision('confidence').notNull(),
  reviewState: text('review_state').notNull(),
  registryVersion: integer('registry_version').notNull(),
  evidenceIds: text('evidence_ids').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const systemAddressExclusionsApplied = pgTable('system_address_exclusions_applied', {
  exclusionId: text('exclusion_id').primaryKey(),
  registryEntryId: text('registry_entry_id').notNull(),
  economicEventId: text('economic_event_id').notNull(),
  excluded: boolean('excluded').notNull(),
  rawFlowRef: text('raw_flow_ref').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull(),
  registryVersion: integer('registry_version').notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// ── G1 exec (migrations/g1_exec_*.sql) — execution-aware simulation ─────────

export const executionScenarios = pgTable('execution_scenarios', {
  scenarioId: text('scenario_id').primaryKey(),
  version: text('version').notNull(),
  notionalUsd: text('notional_usd').notNull(),
  deterministicActionDelaySeconds: integer('deterministic_action_delay_seconds').notNull(),
  empiricalActionDelayPolicyId: text('empirical_action_delay_policy_id'),
  entryPolicyVersionId: text('entry_policy_version_id').notNull(),
  exitPolicyVersionId: text('exit_policy_version_id').notNull(),
  maximumEntryImpact: doublePrecision('maximum_entry_impact').notNull(),
  maximumExitImpact: doublePrecision('maximum_exit_impact').notNull(),
  allowPartialFill: boolean('allow_partial_fill').notNull(),
  minimumFillFraction: doublePrecision('minimum_fill_fraction').notNull(),
  maximumFillDurationSeconds: integer('maximum_fill_duration_seconds').notNull(),
  feePolicyVersionId: text('fee_policy_version_id').notNull(),
  conservativeStressPolicyId: text('conservative_stress_policy_id').notNull(),
  requiredPoolAdapterCoverage: text('required_pool_adapter_coverage').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const exitPolicyExperiments = pgTable('exit_policy_experiments', {
  experimentId: text('experiment_id').primaryKey(),
  scenarioId: text('scenario_id').notNull(),
  scenarioVersion: text('scenario_version').notNull(),
  exitPolicyKind: text('exit_policy_kind').notNull(),
  exitPolicyVersionId: text('exit_policy_version_id').notNull(),
  isPrimary: boolean('is_primary').notNull(),
  parameters: jsonb('parameters').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const executionSimulations = pgTable('execution_simulations', {
  simulationId: text('simulation_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  scenarioId: text('scenario_id').notNull(),
  scenarioVersion: text('scenario_version').notNull(),
  outcomeProfileVersion: text('outcome_profile_version').notNull(),
  requestedQuantity: text('requested_quantity').notNull(),
  filledQuantity: text('filled_quantity').notNull(),
  fillFraction: doublePrecision('fill_fraction').notNull(),
  averageExecutionPrice: text('average_execution_price').notNull(),
  marginalPriceImpact: doublePrecision('marginal_price_impact').notNull(),
  averagePriceImpact: doublePrecision('average_price_impact').notNull(),
  failedAmount: text('failed_amount').notNull(),
  entryStartedAt: timestamp('entry_started_at', { withTimezone: true }).notNull(),
  entryCompletedAt: timestamp('entry_completed_at', { withTimezone: true }).notNull(),
  entryStatus: text('entry_status').notNull(),
  exitPolicyVersionId: text('exit_policy_version_id'),
  exitTriggerAt: timestamp('exit_trigger_at', { withTimezone: true }),
  exitCompletedAt: timestamp('exit_completed_at', { withTimezone: true }),
  exitFillFraction: doublePrecision('exit_fill_fraction'),
  exitStatus: text('exit_status'),
  grossReturnUsd: text('gross_return_usd').notNull(),
  poolFeesUsd: text('pool_fees_usd').notNull(),
  aggregatorFeesUsd: text('aggregator_fees_usd').notNull(),
  tokenTransferFeesUsd: text('token_transfer_fees_usd').notNull(),
  priorityNetworkFeesUsd: text('priority_network_fees_usd').notNull(),
  executionImpactUsd: text('execution_impact_usd').notNull(),
  failedAttemptsUsd: text('failed_attempts_usd').notNull(),
  partialFillPenaltyUsd: text('partial_fill_penalty_usd').notNull(),
  residualInventoryUsd: text('residual_inventory_usd').notNull(),
  adverseSelectionMevBufferUsd: text('adverse_selection_mev_buffer_usd').notNull(),
  quoteConversionDepegUsd: text('quote_conversion_depeg_usd').notNull(),
  accountCreationRentUsd: text('account_creation_rent_usd').notNull(),
  netReturnUsd: text('net_return_usd').notNull(),
  signalLabel: text('signal_label'),
  tradableLabel: text('tradable_label'),
  tradableFailureReason: text('tradable_failure_reason'),
  tradabilityVerdict: text('tradability_verdict').notNull(),
  primaryOrdering: text('primary_ordering').notNull(),
  pathAmbiguous: boolean('path_ambiguous').notNull(),
  outcomeMaturity: text('outcome_maturity').notNull(),
  censorReason: text('censor_reason'),
  stateSnapshotId: text('state_snapshot_id').notNull(),
  replayManifestId: text('replay_manifest_id').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  schemaRegistryVersion: integer('schema_registry_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const replayManifests = pgTable('replay_manifests', {
  replayId: text('replay_id').primaryKey(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  datasetVersion: text('dataset_version').notNull(),
  populationClaim: text('population_claim').notNull(),
  candidateUniverseHash: text('candidate_universe_hash').notNull(),
  observationCutoff: timestamp('observation_cutoff', { withTimezone: true }).notNull(),
  collectorCoverageManifestId: text('collector_coverage_manifest_id').notNull(),
  providerDependenceVersion: text('provider_dependence_version').notNull(),
  featureVersion: text('feature_version').notNull(),
  rankingVersion: text('ranking_version').notNull(),
  workflowVersion: text('workflow_version').notNull(),
  promptVersion: text('prompt_version').notNull(),
  toolProfileVersion: text('tool_profile_version').notNull(),
  modelProfileVersion: text('model_profile_version').notNull(),
  outcomeProfileVersion: text('outcome_profile_version').notNull(),
  policyVersion: text('policy_version').notNull(),
  deliveryLatencyPolicyVersion: text('delivery_latency_policy_version').notNull(),
  capacityContractVersion: text('capacity_contract_version').notNull(),
  assumptionsHash: text('assumptions_hash').notNull(),
  scenarioPayloads: jsonb('scenario_payloads').notNull(),
  poolMathAdapterVersions: text('pool_math_adapter_versions').array().notNull(),
  executionScenarioVersions: text('execution_scenario_versions').array().notNull(),
  artifactIds: text('artifact_ids').array().notNull(),
  holdoutExposureSnapshotId: text('holdout_exposure_snapshot_id').notNull(),
  codeAndDependencyHash: text('code_and_dependency_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const outcomeObservationPlans = pgTable(
  'outcome_observation_plans',
  {
    planId: text('plan_id').notNull(),
    planVersion: text('plan_version').notNull(),
    candidateId: text('candidate_id').notNull(),
    triggerClass: text('trigger_class').notNull(),
    cadenceSeconds: integer('cadence_seconds').notNull(),
    observedFields: text('observed_fields').array().notNull(),
    providerSourceIds: text('provider_source_ids').array().notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    quotaCeiling: jsonb('quota_ceiling').notNull(),
    degradationPolicyId: text('degradation_policy_id').notNull(),
    resolutionTemporalSeconds: integer('resolution_temporal_seconds').notNull(),
    resolutionPoolStateComplete: boolean('resolution_pool_state_complete').notNull(),
    resolutionLiquidityDepthMinUsd: text('resolution_liquidity_depth_min_usd').notNull(),
    inclusionProbability: doublePrecision('inclusion_probability'),
    stratum: text('stratum'),
    populationLimit: text('population_limit'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.planVersion] })],
);

export const poolMathAdapterRegistry = pgTable(
  'pool_math_adapter_registry',
  {
    adapterId: text('adapter_id').notNull(),
    version: text('version').notNull(),
    chainId: text('chain_id').notNull(),
    programId: text('program_id').notNull(),
    supportedProgramVersions: text('supported_program_versions').array().notNull(),
    curveTypes: text('curve_types').array().notNull(),
    adapterFamily: text('adapter_family').notNull(),
    accountLayoutVersion: text('account_layout_version').notNull(),
    supportState: text('support_state').notNull(),
    parityGateVersion: text('parity_gate_version'),
    fixtureBundleHash: text('fixture_bundle_hash'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.adapterId, t.version, t.chainId, t.programId, t.accountLayoutVersion],
    }),
  ],
);

export const executionStateSnapshots = pgTable('execution_state_snapshots', {
  snapshotId: text('snapshot_id').primaryKey(),
  chainId: text('chain_id').notNull(),
  programId: text('program_id').notNull(),
  programVersion: text('program_version').notNull(),
  slot: text('slot').notNull(),
  blockHash: text('block_hash').notNull(),
  finality: text('finality').notNull(),
  rawAccountStateHashes: text('raw_account_state_hashes').array().notNull(),
  reserveVaultState: jsonb('reserve_vault_state').notNull(),
  tickArrays: jsonb('tick_arrays'),
  binArrays: jsonb('bin_arrays'),
  curveState: jsonb('curve_state'),
  positions: jsonb('positions'),
  bondingCurveState: jsonb('bonding_curve_state'),
  feeConfiguration: jsonb('fee_configuration').notNull(),
  dynamicFeeParameters: jsonb('dynamic_fee_parameters'),
  oracleQuoteInputs: jsonb('oracle_quote_inputs'),
  transferFeeSemantics: jsonb('transfer_fee_semantics'),
  transferHookSemantics: jsonb('transfer_hook_semantics'),
  defaultAccountState: jsonb('default_account_state'),
  quoteConversionSource: text('quote_conversion_source').notNull(),
  quoteConversionAt: timestamp('quote_conversion_at', { withTimezone: true }).notNull(),
  routeLegs: jsonb('route_legs').notNull(),
  sharedLiquidityIdentifiers: text('shared_liquidity_identifiers').array().notNull(),
  poolMathAdapterId: text('pool_math_adapter_id').notNull(),
  poolMathAdapterVersion: text('pool_math_adapter_version').notNull(),
  stateCompleteness: text('state_completeness').notNull(),
  relativeUncertainty: doublePrecision('relative_uncertainty'),
  uncertaintyPolicyLimit: doublePrecision('uncertainty_policy_limit'),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const adapterIncidents = pgTable('adapter_incidents', {
  incidentId: text('incident_id').primaryKey(),
  adapterId: text('adapter_id').notNull(),
  adapterVersion: text('adapter_version').notNull(),
  cause: text('cause').notNull(),
  affectedScope: jsonb('affected_scope').notNull(),
  resultingSupportState: text('resulting_support_state').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
  evidenceIds: text('evidence_ids').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const quoteEvidence = pgTable('quote_evidence', {
  quoteId: text('quote_id').primaryKey(),
  sourceId: text('source_id').notNull(),
  sourceKind: text('source_kind').notNull(),
  inTokenMint: text('in_token_mint').notNull(),
  outTokenMint: text('out_token_mint').notNull(),
  inAmount: text('in_amount').notNull(),
  outAmount: text('out_amount').notNull(),
  quoteAt: timestamp('quote_at', { withTimezone: true }).notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  routeLegs: jsonb('route_legs').notNull(),
  transactionConstructionRefused: boolean('transaction_construction_refused').notNull(),
  transactionPayloadRef: text('transaction_payload_ref'),
  relativeUncertainty: doublePrecision('relative_uncertainty'),
  qualityCodes: text('quality_codes').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const tradabilityGateDecisions = pgTable('tradability_gate_decisions', {
  decisionId: text('decision_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  outcomeProfileVersion: text('outcome_profile_version').notNull(),
  scenarioId: text('scenario_id').notNull(),
  scenarioVersion: text('scenario_version').notNull(),
  requiredKinds: text('required_kinds').array().notNull(),
  scenarioMatrix: jsonb('scenario_matrix').notNull(),
  matrixPassed: boolean('matrix_passed').notNull(),
  conservativeControlled: boolean('conservative_controlled').notNull(),
  tradabilityVerdict: text('tradability_verdict').notNull(),
  confirmedOpportunity: boolean('confirmed_opportunity').notNull(),
  blockReason: text('block_reason'),
  preservedSignalLabel: text('preserved_signal_label'),
  uncertaintyBlocked: boolean('uncertainty_blocked').notNull(),
  primaryOrdering: text('primary_ordering').notNull(),
  pathAmbiguous: boolean('path_ambiguous').notNull(),
  replayManifestId: text('replay_manifest_id').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const concurrentShadowPositions = pgTable('concurrent_shadow_positions', {
  positionId: text('position_id').primaryKey(),
  aggregateId: text('aggregate_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  poolId: text('pool_id'),
  routeId: text('route_id'),
  quoteAssetId: text('quote_asset_id'),
  sharedLiquidityIdentifiers: text('shared_liquidity_identifiers').array().notNull(),
  exitWindowStart: timestamp('exit_window_start', { withTimezone: true }).notNull(),
  exitWindowEnd: timestamp('exit_window_end', { withTimezone: true }).notNull(),
  requestedExitUsd: text('requested_exit_usd').notNull(),
  preExitDepthUsd: text('pre_exit_depth_usd').notNull(),
  fillFraction: doublePrecision('fill_fraction').notNull(),
  rejected: boolean('rejected').notNull(),
  competitionResolutionVersion: text('competition_resolution_version').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
