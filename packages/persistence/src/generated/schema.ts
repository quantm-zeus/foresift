/**
 * Drizzle mirror of SQL truth (ADR-001) — hand-maintained to match the tables
 * created by the versioned migration families, including the `sig` and `wf`
 * schemas, exactly.
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
  interval,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const sigSchema = pgSchema('sig');
export const wfSchema = pgSchema('wf');

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

// --- g1_exec_0001_scenarios_simulations --------------------------------------

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

// --- g1_exec_0002_replay_observation -----------------------------------------

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

// --- g1_exec_0003_adapter_registry_state -------------------------------------

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

// --- g1_exec_0004_quotes_gates ------------------------------------------------

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

// --- g1_sig_0001_feature_registry ----------------------------------------

export const sigFeatureDefinitions = sigSchema.table(
  'feature_definitions',
  {
    featureId: text('feature_id').notNull(),
    version: integer('version').notNull(),
    description: text('description').notNull(),
    formula: text('formula').notNull(),
    inputFields: text('input_fields').array().notNull(),
    unit: text('unit').notNull(),
    windows: text('windows').array().notNull(),
    minimumObservations: integer('minimum_observations').notNull(),
    nullPolicy: text('null_policy').notNull(),
    outlierPolicy: text('outlier_policy').notNull(),
    updatePolicy: text('update_policy').notNull(),
    freshnessLimitSeconds: integer('freshness_limit_seconds').notNull(),
    cohortDefinitionId: text('cohort_definition_id'),
    evidenceRequirements: text('evidence_requirements').array().notNull(),
    minimumDenominator: integer('minimum_denominator'),
    isNumeric: boolean('is_numeric').notNull(),
    stabilityTransform: text('stability_transform'),
    shrinkagePolicy: text('shrinkage_policy'),
    cappedContribution: doublePrecision('capped_contribution'),
    outlierPolicyIsRobust: boolean('outlier_policy_is_robust').notNull(),
    cohortFallbackPolicyId: text('cohort_fallback_policy_id'),
    economicEventRequired: boolean('economic_event_required').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.featureId, t.version] })],
);

export const sigFeatureLineage = sigSchema.table('feature_lineage', {
  lineageId: text('lineage_id').primaryKey(),
  featureId: text('feature_id').notNull(),
  featureVersion: integer('feature_version').notNull(),
  entityId: text('entity_id').notNull(),
  profileId: text('profile_id').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  inputObservationIds: text('input_observation_ids').array().notNull(),
  inputEvidenceIds: text('input_evidence_ids').array().notNull(),
  inputHashes: text('input_hashes').array().notNull(),
  calculationCodeVersion: text('calculation_code_version').notNull(),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull(),
  qualityCodes: text('quality_codes').array().notNull(),
  eventTimeResolvedAt: timestamp('event_time_resolved_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const sigCohortSnapshots = sigSchema.table('cohort_snapshots', {
  snapshotId: text('snapshot_id').primaryKey(),
  featureId: text('feature_id').notNull(),
  featureVersion: integer('feature_version').notNull(),
  entityId: text('entity_id').notNull(),
  cohortChain: text('cohort_chain').notNull(),
  cohortLaunchpad: text('cohort_launchpad'),
  cohortAgeBand: text('cohort_age_band'),
  cohortMarketCapBand: text('cohort_market_cap_band'),
  cohortLiquidityBand: text('cohort_liquidity_band'),
  cohortNarrative: text('cohort_narrative'),
  cohortRegime: text('cohort_regime'),
  fallbackLevel: text('fallback_level').notNull(),
  cohortSize: integer('cohort_size').notNull(),
  effectiveSampleSize: doublePrecision('effective_sample_size').notNull(),
  peerPercentile: doublePrecision('peer_percentile'),
  lowSampleWarning: boolean('low_sample_warning').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
});

// --- g1_sig_0002_funnel_vectors_ranking ----------------------------------

export const sigCandidateFunnelStages = sigSchema.table('candidate_funnel_stages', {
  stageId: text('stage_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  profileId: text('profile_id').notNull(),
  profileVersion: text('profile_version').notNull(),
  stage: text('stage').notNull(),
  enteredAt: timestamp('entered_at', { withTimezone: true }).notNull(),
  passed: boolean('passed').notNull(),
  gateCode: text('gate_code'),
  gateProfileVersion: text('gate_profile_version').notNull(),
  evidenceRefs: text('evidence_refs').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const sigCandidateVectors = sigSchema.table('candidate_vectors', {
  vectorId: text('vector_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  profileVersion: text('profile_version').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  vectorKind: text('vector_kind').notNull(),
  components: jsonb('components').notNull(),
  algorithmVersion: text('algorithm_version').notNull(),
  lineageRef: text('lineage_ref').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const sigRankingAudits = sigSchema.table('ranking_audits', {
  auditId: text('audit_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  rankAtTime: integer('rank_at_time').notNull(),
  rankingVersion: text('ranking_version').notNull(),
  profileVersion: text('profile_version').notNull(),
  componentValues: jsonb('component_values').notNull(),
  hardGateResults: jsonb('hard_gate_results').notNull(),
  paretoStatus: text('pareto_status').notNull(),
  diversityAdjustment: jsonb('diversity_adjustment').notNull(),
  explorationSelected: boolean('exploration_selected').notNull(),
  cutoffReason: text('cutoff_reason').notNull(),
  selectionArm: text('selection_arm').notNull(),
  selectionProbability: doublePrecision('selection_probability'),
  protectedAllocations: jsonb('protected_allocations').notNull(),
  capacityAdmission: jsonb('capacity_admission').notNull(),
  algorithmVersion: text('algorithm_version').notNull(),
  tDecisionReady: timestamp('t_decision_ready', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_sig_0003_lifecycle_rechecks --------------------------------------

export const sigCandidateLifecycle = sigSchema.table('candidate_lifecycle', {
  transitionId: text('transition_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  profileVersion: text('profile_version').notNull(),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  reason: text('reason').notNull(),
  persistenceMeasure: doublePrecision('persistence_measure'),
  dwellSincePriorTransition: interval('dwell_since_prior_transition'),
  policyVersion: text('policy_version').notNull(),
  tradabilityVerdict: text('tradability_verdict'),
  diagnosticSignalLabels: text('diagnostic_signal_labels').array().notNull(),
  thesisInvalidationConditions: jsonb('thesis_invalidation_conditions'),
  transitionedAt: timestamp('transitioned_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const sigRecheckBudgets = sigSchema.table(
  'recheck_budgets',
  {
    candidateId: text('candidate_id').notNull(),
    profileVersion: text('profile_version').notNull(),
    maxRechecks: integer('max_rechecks').notNull(),
    maxRecheckProviderCalls: integer('max_recheck_provider_calls').notNull(),
    maxRecheckModelCost: doublePrecision('max_recheck_model_cost').notNull(),
    backoffFactor: doublePrecision('backoff_factor').notNull(),
    minimumExpectedInformationGain: doublePrecision('minimum_expected_information_gain').notNull(),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rechecksUsed: integer('rechecks_used').notNull(),
    providerCallsUsed: integer('provider_calls_used').notNull(),
    modelCostUsed: doublePrecision('model_cost_used').notNull(),
    starvedSince: timestamp('starved_since', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.candidateId, t.profileVersion] })],
);

export const sigRecheckDecisions = sigSchema.table('recheck_decisions', {
  decisionId: text('decision_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  profileVersion: text('profile_version').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  decision: text('decision').notNull(),
  expectedDecisionImpact: doublePrecision('expected_decision_impact'),
  boundaryProximity: doublePrecision('boundary_proximity'),
  expectedStateChange: doublePrecision('expected_state_change'),
  informationGap: doublePrecision('information_gap'),
  riskUrgency: doublePrecision('risk_urgency'),
  candidateUtility: doublePrecision('candidate_utility'),
  quotaCost: doublePrecision('quota_cost'),
  informationValue: doublePrecision('information_value'),
  providerCallsCosted: integer('provider_calls_costed').notNull(),
  modelCostCosted: doublePrecision('model_cost_costed').notNull(),
  protectedReserveClass: text('protected_reserve_class'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_mat_0001_maturity_ledger -------------------------------------------

export const outcomeMaturityStates = pgTable('outcome_maturity_states', {
  maturityStateId: text('maturity_state_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  outcomeProfileId: text('outcome_profile_id').notNull(),
  outcomeProfileVersion: text('outcome_profile_version').notNull(),
  horizon: text('horizon').notNull(),
  scenarioId: text('scenario_id').notNull(),
  scenarioVersion: text('scenario_version').notNull(),
  maturityState: text('maturity_state').notNull(),
  censorReason: text('censor_reason'),
  invalidReason: text('invalid_reason'),
  maturedAt: timestamp('matured_at', { withTimezone: true }),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const maturityTransitions = pgTable('maturity_transitions', {
  transitionId: text('transition_id').primaryKey(),
  maturityStateId: text('maturity_state_id').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reason: text('reason').notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  transitionedAt: timestamp('transitioned_at', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
});

export const outcomeDenominatorDisclosures = pgTable('outcome_denominator_disclosures', {
  disclosureId: text('disclosure_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  outcomeProfileId: text('outcome_profile_id').notNull(),
  outcomeProfileVersion: text('outcome_profile_version').notNull(),
  horizon: text('horizon').notNull(),
  observationCollectionScope: text('observation_collection_scope').notNull(),
  reportScope: text('report_scope').notNull(),
  eligibleCount: bigint('eligible_count', { mode: 'number' }).notNull(),
  fullyMaturedValidCount: bigint('fully_matured_valid_count', { mode: 'number' }).notNull(),
  pendingCount: bigint('pending_count', { mode: 'number' }).notNull(),
  partiallyMaturedCount: bigint('partially_matured_count', { mode: 'number' }).notNull(),
  censoredCount: bigint('censored_count', { mode: 'number' }).notNull(),
  invalidDataCount: bigint('invalid_data_count', { mode: 'number' }).notNull(),
  lowResolutionCount: bigint('low_resolution_count', { mode: 'number' }).notNull(),
  rightsBlockedCount: bigint('rights_blocked_count', { mode: 'number' }).notNull(),
  unobservedCount: bigint('unobserved_count', { mode: 'number' }).notNull(),
  disclosedAt: timestamp('disclosed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const subjectiveUtilityRecords = pgTable('subjective_utility_records', {
  subjectiveUtilityId: text('subjective_utility_id').primaryKey(),
  subjectId: text('subject_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  labelFamily: text('label_family').notNull(),
  utilityLabel: text('utility_label').notNull(),
  utilityValue: text('utility_value'),
  rationale: text('rationale'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const outcomeSamplingStrata = pgTable('outcome_sampling_strata', {
  stratumId: text('stratum_id').primaryKey(),
  samplingPlanId: text('sampling_plan_id').notNull(),
  dimensions: jsonb('dimensions').notNull(),
  eligibleCount: bigint('eligible_count', { mode: 'number' }).notNull(),
  targetSampleCount: bigint('target_sample_count', { mode: 'number' }).notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const outcomeSamplingAssignments = pgTable('outcome_sampling_assignments', {
  assignmentId: text('assignment_id').primaryKey(),
  samplingPlanId: text('sampling_plan_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  stratumId: text('stratum_id').notNull(),
  inclusionProbability: doublePrecision('inclusion_probability').notNull(),
  selected: boolean('selected').notNull(),
  selectionTime: timestamp('selection_time', { withTimezone: true }).notNull(),
  selectionReason: text('selection_reason').notNull(),
  seedProvenance: text('seed_provenance').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_mat_0002_promotion_evidence ----------------------------------------

export const promotionEvidenceRecords = pgTable('promotion_evidence_records', {
  promotionEvidenceId: text('promotion_evidence_id').primaryKey(),
  candidateId: text('candidate_id').notNull(),
  outcomeProfileId: text('outcome_profile_id').notNull(),
  outcomeProfileVersion: text('outcome_profile_version').notNull(),
  scenarioId: text('scenario_id').notNull(),
  scenarioVersion: text('scenario_version').notNull(),
  outcomeLabel: text('outcome_label').notNull(),
  outcomeMaturity: text('outcome_maturity').notNull(),
  evidenceResolution: text('evidence_resolution').notNull(),
  requiredNotional: text('required_notional').notNull(),
  requiredDelayPolicyId: text('required_delay_policy_id').notNull(),
  requiredAdapterVersion: text('required_adapter_version').notNull(),
  requiredRouteId: text('required_route_id').notNull(),
  requiredExitPolicyId: text('required_exit_policy_id').notNull(),
  exactConfigurationMatch: boolean('exact_configuration_match').notNull(),
  productionPromotionEligible: boolean('production_promotion_eligible').notNull(),
  primaryOrdering: text('primary_ordering').notNull(),
  pathAmbiguous: boolean('path_ambiguous').notNull(),
  optimisticSensitivity: jsonb('optimistic_sensitivity'),
  expirySideEffect: text('expiry_side_effect'),
  expirySideEffectAt: timestamp('expiry_side_effect_at', { withTimezone: true }),
  gainObservedAt: timestamp('gain_observed_at', { withTimezone: true }),
  postExpiryGainExcluded: boolean('post_expiry_gain_excluded').notNull(),
  capacityLimited: boolean('capacity_limited').notNull(),
  maximumExecutableNotional: text('maximum_executable_notional'),
  totalDeployablePortfolioCapacity: text('total_deployable_portfolio_capacity'),
  largerCapitalSimulationRef: text('larger_capital_simulation_ref'),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_eval_0001_profiles_datasets_registry -------------------------------

export const outcomeProfiles = pgTable(
  'outcome_profiles',
  {
    profileId: text('profile_id').notNull(),
    version: text('version').notNull(),
    humanName: text('human_name').notNull(),
    researchOnlyDisclosure: text('research_only_disclosure').notNull(),
    populationScope: text('population_scope').notNull(),
    inclusionMechanism: jsonb('inclusion_mechanism').notNull(),
    eligibility: jsonb('eligibility').notNull(),
    signalSuccess: jsonb('signal_success').notNull(),
    tradableSuccess: jsonb('tradable_success').notNull(),
    tradableFailure: jsonb('tradable_failure').notNull(),
    neutral: jsonb('neutral').notNull(),
    censoringPolicy: jsonb('censoring_policy').notNull(),
    invalidDataPolicy: jsonb('invalid_data_policy').notNull(),
    horizons: jsonb('horizons').notNull(),
    maturityPolicy: jsonb('maturity_policy').notNull(),
    observationResolutionPolicy: jsonb('observation_resolution_policy').notNull(),
    riskSurvivalConstraints: jsonb('risk_survival_constraints').notNull(),
    requiredCapabilities: jsonb('required_capabilities').notNull(),
    requiredEvidenceFamilies: jsonb('required_evidence_families').notNull(),
    executionScenarioMatrix: jsonb('execution_scenario_matrix').notNull(),
    owner: text('owner').notNull(),
    approvalArtifactRef: text('approval_artifact_ref').notNull(),
    rollbackTarget: text('rollback_target').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.version] })],
);

export const evaluationDatasets = pgTable(
  'evaluation_datasets',
  {
    datasetId: text('dataset_id').notNull(),
    version: text('version').notNull(),
    partition: text('partition').notNull(),
    holdoutExposure: text('holdout_exposure').notNull(),
    frozen: boolean('frozen').notNull(),
    populationScope: text('population_scope').notNull(),
    candidateUniverseHash: text('candidate_universe_hash').notNull(),
    universeManifestRef: text('universe_manifest_ref').notNull(),
    observationStart: timestamp('observation_start', { withTimezone: true }).notNull(),
    observationEnd: timestamp('observation_end', { withTimezone: true }).notNull(),
    embargoStart: timestamp('embargo_start', { withTimezone: true }),
    embargoEnd: timestamp('embargo_end', { withTimezone: true }),
    leakageGroupKeys: jsonb('leakage_group_keys').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.version] })],
);

export const evaluationExperiments = pgTable('evaluation_experiments', {
  experimentId: text('experiment_id').primaryKey(),
  hypothesis: text('hypothesis').notNull(),
  primaryMetric: text('primary_metric').notNull(),
  hardConstraints: jsonb('hard_constraints').notNull(),
  candidatePopulation: jsonb('candidate_population').notNull(),
  profileScope: jsonb('profile_scope').notNull(),
  regimeScope: jsonb('regime_scope').notNull(),
  executionScope: jsonb('execution_scope').notNull(),
  championVersion: text('champion_version').notNull(),
  challengerVersion: text('challenger_version').notNull(),
  preprocessingFeatures: jsonb('preprocessing_features').notNull(),
  sampleSizePowerTarget: jsonb('sample_size_power_target').notNull(),
  clusterDefinition: text('cluster_definition').notNull(),
  multipleTestingFamily: text('multiple_testing_family').notNull(),
  statisticalMethod: text('statistical_method').notNull(),
  stoppingRule: jsonb('stopping_rule').notNull(),
  confirmatory: boolean('confirmatory').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_eval_0002_runs_metrics_controls ------------------------------------

export const evaluationRuns = pgTable('evaluation_runs', {
  evaluationRunId: text('evaluation_run_id').primaryKey(),
  experimentId: text('experiment_id').notNull(),
  replayKind: text('replay_kind').notNull(),
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
  poolMathAdapterVersions: jsonb('pool_math_adapter_versions').notNull(),
  executionScenarioVersions: jsonb('execution_scenario_versions').notNull(),
  artifactIds: jsonb('artifact_ids').notNull(),
  holdoutExposureSnapshotId: text('holdout_exposure_snapshot_id').notNull(),
  codeAndDependencyHash: text('code_and_dependency_hash').notNull(),
  execReplayManifestRef: text('exec_replay_manifest_ref').notNull(),
  networkAccess: boolean('network_access').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const evaluationMetricResults = pgTable('evaluation_metric_results', {
  metricResultId: text('metric_result_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  metricKind: text('metric_kind').notNull(),
  metricValue: text('metric_value').notNull(),
  lowerBound: text('lower_bound'),
  upperBound: text('upper_bound'),
  maturityScope: text('maturity_scope').notNull(),
  finalResult: boolean('final_result').notNull(),
  denominatorDisclosureRef: text('denominator_disclosure_ref').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const clusteredIntervalRuns = pgTable('clustered_interval_runs', {
  intervalRunId: text('interval_run_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  metricKind: text('metric_kind').notNull(),
  intervalMethod: text('interval_method').notNull(),
  clusterDefinition: text('cluster_definition').notNull(),
  naiveSampleSize: bigint('naive_sample_size', { mode: 'number' }).notNull(),
  clusterCount: bigint('cluster_count', { mode: 'number' }).notNull(),
  effectiveIndependentSampleSize: doublePrecision('effective_independent_sample_size').notNull(),
  minimumEffectiveSampleSize: doublePrecision('minimum_effective_sample_size').notNull(),
  essGatePassed: boolean('ess_gate_passed').notNull(),
  promotionEligible: boolean('promotion_eligible').notNull(),
  pointEstimate: text('point_estimate').notNull(),
  lowerBound: text('lower_bound').notNull(),
  upperBound: text('upper_bound').notNull(),
  alternateClusterSensitivity: jsonb('alternate_cluster_sensitivity').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const negativeControlRuns = pgTable('negative_control_runs', {
  controlRunId: text('control_run_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  controlKind: text('control_kind').notNull(),
  seedProvenance: text('seed_provenance').notNull(),
  observedLift: text('observed_lift').notNull(),
  materialLiftThreshold: text('material_lift_threshold').notNull(),
  unexpectedMaterialLift: boolean('unexpected_material_lift').notNull(),
  promotionBlocked: boolean('promotion_blocked').notNull(),
  incidentId: text('incident_id'),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const evaluationIncidents = pgTable('evaluation_incidents', {
  incidentId: text('incident_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  incidentTrigger: text('incident_trigger').notNull(),
  affectedScope: jsonb('affected_scope').notNull(),
  influencePaused: boolean('influence_paused').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionRef: text('resolution_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_eval_0003_baseline_missed_controls ---------------------------------

export const baselineResults = pgTable('baseline_results', {
  baselineResultId: text('baseline_result_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  baselineKind: text('baseline_kind').notNull(),
  baselineVersion: text('baseline_version').notNull(),
  metricKind: text('metric_kind').notNull(),
  metricValue: text('metric_value').notNull(),
  candidateUniverseHash: text('candidate_universe_hash').notNull(),
  comparatorUniverseHash: text('comparator_universe_hash').notNull(),
  dataCutoff: timestamp('data_cutoff', { withTimezone: true }).notNull(),
  actionTimePolicyVersion: text('action_time_policy_version').notNull(),
  executionScenarioVersion: text('execution_scenario_version').notNull(),
  capitalBudget: text('capital_budget').notNull(),
  strongestEligible: boolean('strongest_eligible').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const missedOpportunities = pgTable('missed_opportunities', {
  missedOpportunityId: text('missed_opportunity_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  outcomeProfileId: text('outcome_profile_id').notNull(),
  outcomeProfileVersion: text('outcome_profile_version').notNull(),
  declaredPopulationBoundary: text('declared_population_boundary').notNull(),
  existedInDiscoveryCoverage: boolean('existed_in_discovery_coverage').notNull(),
  firstSource: text('first_source'),
  firstSourceObservedAt: timestamp('first_source_observed_at', { withTimezone: true }),
  firstSystemAvailableAt: timestamp('first_system_available_at', { withTimezone: true }),
  funnelExit: text('funnel_exit').notNull(),
  evidenceAcquisitionExit: text('evidence_acquisition_exit'),
  missClassification: text('miss_classification').notNull(),
  delayDecomposition: jsonb('delay_decomposition').notNull(),
  counterfactualActionTime: timestamp('counterfactual_action_time', {
    withTimezone: true,
  }).notNull(),
  frozenEvidenceRefs: jsonb('frozen_evidence_refs').notNull(),
  frozenVersionRefs: jsonb('frozen_version_refs').notNull(),
  nextEvaluationDatasetId: text('next_evaluation_dataset_id').notNull(),
  nextEvaluationDatasetVersion: text('next_evaluation_dataset_version').notNull(),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const championChallengerComparisons = pgTable('champion_challenger_comparisons', {
  comparisonId: text('comparison_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  championVersion: text('champion_version').notNull(),
  challengerVersion: text('challenger_version').notNull(),
  candidateUniverseHash: text('candidate_universe_hash').notNull(),
  frozenAvailabilityBoundary: timestamp('frozen_availability_boundary', {
    withTimezone: true,
  }).notNull(),
  championBudget: text('champion_budget').notNull(),
  challengerBudget: text('challenger_budget').notNull(),
  budgetsEqualized: boolean('budgets_equalized').notNull(),
  externalSideEffectCount: bigint('external_side_effect_count', { mode: 'number' }).notNull(),
  hardConstraintsPassed: boolean('hard_constraints_passed').notNull(),
  primaryUtilityGatePassed: boolean('primary_utility_gate_passed').notNull(),
  deterministicStackResultRef: text('deterministic_stack_result_ref').notNull(),
  modelRemovedResultRef: text('model_removed_result_ref'),
  comparedAt: timestamp('compared_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const driftCalibrationControls = pgTable('drift_calibration_controls', {
  controlId: text('control_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  controlKind: text('control_kind').notNull(),
  scope: jsonb('scope').notNull(),
  referenceDatasetRef: text('reference_dataset_ref').notNull(),
  observedValue: text('observed_value').notNull(),
  thresholdValue: text('threshold_value').notNull(),
  driftDetected: boolean('drift_detected').notNull(),
  response: text('response').notNull(),
  influenceDegraded: boolean('influence_degraded').notNull(),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const selectionBiasDiagnostics = pgTable('selection_bias_diagnostics', {
  diagnosticId: text('diagnostic_id').primaryKey(),
  evaluationRunId: text('evaluation_run_id').notNull(),
  diagnosticKind: text('diagnostic_kind').notNull(),
  estimatorKind: text('estimator_kind').notNull(),
  diagnostics: jsonb('diagnostics').notNull(),
  maximumWeight: doublePrecision('maximum_weight'),
  diagnosticsValid: boolean('diagnostics_valid').notNull(),
  claimRestriction: text('claim_restriction').notNull(),
  populationClaim: text('population_claim').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_obj_0001_objective_runs --------------------------------------------

export const objectiveRuns = pgTable('objective_runs', {
  runId: text('run_id').primaryKey(),
  configContentHash: text('config_content_hash').notNull(),
  candidateUniverseId: text('candidate_universe_id').notNull(),
  candidateUniverseHash: text('candidate_universe_hash').notNull(),
  populationClaimId: text('population_claim_id').notNull(),
  capitalMicros: bigint('capital_micros', { mode: 'number' }).notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  executionScenarioId: text('execution_scenario_id').notNull(),
  executionScenarioVersion: text('execution_scenario_version').notNull(),
  delayPolicyId: text('delay_policy_id').notNull(),
  delayPolicyVersion: text('delay_policy_version').notNull(),
  dataCutoff: timestamp('data_cutoff', { withTimezone: true }).notNull(),
  correlatedExposureConstraints: text('correlated_exposure_constraints').array().notNull(),
  comparability: text('comparability').notNull(),
  exploratoryReason: text('exploratory_reason'),
  schemaRegistryVersion: integer('schema_registry_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g1_obj_0002_utility_ledger --------------------------------------------

export const capitalDayUtility = pgTable(
  'capital_day_utility',
  {
    runId: text('run_id').notNull(),
    capitalDay: text('capital_day').notNull(),
    grossReturnMicros: bigint('gross_return_micros', { mode: 'number' }).notNull(),
    executionCostsMicros: bigint('execution_costs_micros', { mode: 'number' }).notNull(),
    failedPartialFillsMicros: bigint('failed_partial_fills_micros', {
      mode: 'number',
    }).notNull(),
    drawdownMicros: bigint('drawdown_micros', { mode: 'number' }).notNull(),
    cvarMicros: bigint('cvar_micros', { mode: 'number' }).notNull(),
    capitalUtilizationMicros: bigint('capital_utilization_micros', {
      mode: 'number',
    }).notNull(),
    turnoverMicros: bigint('turnover_micros', { mode: 'number' }).notNull(),
    opportunityCostMicros: bigint('opportunity_cost_micros', { mode: 'number' }).notNull(),
    concentrationMicros: bigint('concentration_micros', { mode: 'number' }).notNull(),
    sharedLiquidityImpactMicros: bigint('shared_liquidity_impact_micros', {
      mode: 'number',
    }).notNull(),
    providerModelInfraCostMicros: bigint('provider_model_infra_cost_micros', {
      mode: 'number',
    }).notNull(),
    uncertaintyMicros: bigint('uncertainty_micros', { mode: 'number' }).notNull(),
    dailyNetMicros: bigint('daily_net_micros', { mode: 'number' }).notNull(),
    consumedEssReference: text('consumed_ess_reference').notNull(),
    lowerBoundUtilityMicros: bigint('lower_bound_utility_micros', {
      mode: 'number',
    }).notNull(),
    schemaRegistryVersion: integer('schema_registry_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.capitalDay] })],
);

// --- g1_obj_0003_integrity_claims ------------------------------------------

export const integrityIncidents = pgTable('integrity_incidents', {
  incidentId: text('incident_id').primaryKey(),
  runId: text('run_id').notNull(),
  signal: text('signal').notNull(),
  verdict: text('verdict').notNull(),
  reason: text('reason'),
  evidenceRefs: text('evidence_refs').array().notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const claimScopeRecords = pgTable('claim_scope_records', {
  scopeId: text('scope_id').primaryKey(),
  runId: text('run_id').notNull(),
  supportedPopulation: text('supported_population').notNull(),
  profile: text('profile').notNull(),
  policy: text('policy').notNull(),
  executionScenario: text('execution_scenario').notNull(),
  delayDistribution: text('delay_distribution').notNull(),
  calendarInterval: text('calendar_interval').notNull(),
  marketRegimes: text('market_regimes').array().notNull(),
  capabilityState: text('capability_state').notNull(),
  sampleSize: integer('sample_size').notNull(),
  clusterEffectiveSampleSize: numeric('cluster_effective_sample_size').notNull(),
  uncertaintyMethod: text('uncertainty_method').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const promotionDecisions = pgTable('promotion_decisions', {
  decisionId: text('decision_id').primaryKey(),
  runId: text('run_id').notNull(),
  verdict: text('verdict').notNull(),
  gateTrail: jsonb('gate_trail').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const outputLanguageScreens = pgTable('output_language_screens', {
  screenId: text('screen_id').primaryKey(),
  outputId: text('output_id').notNull(),
  prohibitedClaimsFound: text('prohibited_claims_found').array().notNull(),
  disclosure: text('disclosure').notNull(),
  screenPassed: boolean('screen_passed').notNull(),
  screenedAt: timestamp('screened_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g2_wf_0001_schedules_runs ---------------------------------------------

export const wfSchedules = wfSchema.table('schedules', {
  scheduleId: text('schedule_id').primaryKey(),
  name: text('name').notNull(),
  concurrencyPolicy: text('concurrency_policy').notNull(),
  status: text('status').notNull(),
  currentVersionId: text('current_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const wfScheduleVersions = wfSchema.table('schedule_versions', {
  versionId: text('version_id').primaryKey(),
  scheduleId: text('schedule_id').notNull(),
  configHash: text('config_hash').notNull(),
  resolvedConfig: jsonb('resolved_config').notNull(),
  shadow: boolean('shadow').notNull(),
  supersededBy: text('superseded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const wfTriggerInbox = wfSchema.table('trigger_inbox', {
  inboxId: text('inbox_id').primaryKey(),
  source: text('source').notNull(),
  externalMessageId: text('external_message_id').notNull(),
  canonicalExternalMessageId: text('canonical_external_message_id').notNull(),
  scheduleId: text('schedule_id').notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  payloadHash: text('payload_hash').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  processedRunId: text('processed_run_id'),
  status: text('status').notNull(),
});

export const wfRuns = wfSchema.table('runs', {
  runId: text('run_id').primaryKey(),
  scheduleId: text('schedule_id').notNull(),
  resolvedScheduleVersion: text('resolved_schedule_version').notNull(),
  inboxId: text('inbox_id').notNull(),
  triggerSource: text('trigger_source').notNull(),
  triggerExternalMessageId: text('trigger_external_message_id').notNull(),
  triggerCanonicalExternalMessageId: text('trigger_canonical_external_message_id').notNull(),
  concurrencyPolicy: text('concurrency_policy').notNull(),
  concurrencyOutcome: text('concurrency_outcome').notNull(),
  shadow: boolean('shadow').notNull(),
  status: text('status').notNull(),
  deadline: timestamp('deadline', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const wfSteps = wfSchema.table('steps', {
  stepId: text('step_id').primaryKey(),
  runId: text('run_id').notNull(),
  stepType: text('step_type').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  attempt: integer('attempt').notNull(),
  inputHash: text('input_hash'),
  outputHash: text('output_hash'),
  status: text('status').notNull(),
  leaseOwner: text('lease_owner'),
  leaseVersion: integer('lease_version').notNull(),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorClass: text('error_class'),
  retryable: boolean('retryable'),
});

export const wfStepLeases = wfSchema.table('step_leases', {
  resourceKey: text('resource_key').primaryKey(),
  owner: text('owner').notNull(),
  fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
});

// --- g2_wf_0002_outbox_deadletter ------------------------------------------

export const wfNotificationOutbox = wfSchema.table('notification_outbox', {
  outboxId: text('outbox_id').primaryKey(),
  decisionRef: text('decision_ref').notNull(),
  alertRef: text('alert_ref'),
  channel: text('channel').notNull(),
  payloadHash: text('payload_hash').notNull(),
  status: text('status').notNull(),
  claimOwner: text('claim_owner'),
  claimFencingToken: bigint('claim_fencing_token', { mode: 'number' }),
  claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
  attempts: integer('attempts').notNull(),
  enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  lastError: text('last_error'),
});

export const wfDeadLetters = wfSchema.table('dead_letters', {
  deadLetterId: text('dead_letter_id').primaryKey(),
  runId: text('run_id').notNull(),
  stepId: text('step_id'),
  errorClass: text('error_class').notNull(),
  context: jsonb('context').notNull(),
  lastValidCheckpointRef: text('last_valid_checkpoint_ref'),
  status: text('status').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const wfReconciliationReports = wfSchema.table('reconciliation_reports', {
  reportId: text('report_id').primaryKey(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  diff: jsonb('diff').notNull(),
  incidentRefs: text('incident_refs').array().notNull(),
});

// --- g2_wf_0003_schedule_forecasts -----------------------------------------

export const wfScheduleForecasts = wfSchema.table('schedule_forecasts', {
  forecastId: text('forecast_id').primaryKey(),
  scheduleId: text('schedule_id').notNull(),
  versionId: text('version_id').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
  payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// --- g2_wf_0004_decision_outbox --------------------------------------------

export const wfDecisionCommits = wfSchema.table('decision_commits', {
  decisionId: text('decision_id').primaryKey(),
  runId: text('run_id').notNull(),
  decisionKind: text('decision_kind').notNull(),
  payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  committedAt: timestamp('committed_at', { withTimezone: true }).notNull(),
});

export const wfAlertRecords = wfSchema.table('alert_records', {
  alertId: text('alert_id').primaryKey(),
  decisionId: text('decision_id').notNull(),
  alertClass: text('alert_class').notNull(),
  payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
