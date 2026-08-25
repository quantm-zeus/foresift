/**
 * Drizzle mirror of SQL truth (ADR-001) — hand-maintained to match the tables
 * created by `migrations/g0_sec_*.sql` exactly, inside the dedicated `sec`
 * schema namespace (see implementation-notes.md: keeps the proven
 * public-schema parity contract of @foresift/persistence untouched).
 *
 * This file NEVER defines schema semantics on its own: the SQL migrations are
 * the single source of truth and a parity test enumerates
 * `information_schema` (table_schema = 'sec') against these definitions.
 * Update both together, always.
 */
import { bigint, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const sec = pgSchema('sec');

// --- g0_sec_0001_audit_chain -------------------------------------------------

export const secAuditEvents = sec.table('sec_audit_events', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  actor: text('actor').notNull(),
  actionClass: text('action_class').notNull(),
  subject: text('subject').notNull(),
  payloadCanonical: text('payload_canonical').notNull(),
  payloadSha256: text('payload_sha256').notNull(),
  prevEntryHash: text('prev_entry_hash').notNull(),
  entryHash: text('entry_hash').notNull(),
});

export const secAuditCheckpoints = sec.table('sec_audit_checkpoints', {
  checkpointId: text('checkpoint_id').primaryKey(),
  fromSeq: bigint('from_seq', { mode: 'number' }).notNull(),
  toSeq: bigint('to_seq', { mode: 'number' }).notNull(),
  chainHeadHash: text('chain_head_hash').notNull(),
  prevCheckpointHash: text('prev_checkpoint_hash').notNull(),
  checkpointHash: text('checkpoint_hash').notNull(),
  batchSignature: text('batch_signature'),
  storedAt: timestamp('stored_at', { withTimezone: true }).notNull(),
  objectRef: text('object_ref'),
});

export const secAuditVerifyRuns = sec.table('sec_audit_verify_runs', {
  runId: text('run_id').primaryKey(),
  verifiedFromSeq: bigint('verified_from_seq', { mode: 'number' }).notNull(),
  verifiedToSeq: bigint('verified_to_seq', { mode: 'number' }).notNull(),
  verdict: text('verdict').notNull(),
  firstDivergenceSeq: bigint('first_divergence_seq', { mode: 'number' }),
  divergenceKind: text('divergence_kind'),
  expectedHash: text('expected_hash'),
  actualHash: text('actual_hash'),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull(),
});

// --- g0_sec_0002_mcp_credentials ----------------------------------------------

export const mcpCredentials = sec.table('mcp_credentials', {
  credentialId: text('credential_id').primaryKey(),
  keyedHash: text('keyed_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  originPolicyRef: text('origin_policy_ref').notNull(),
  profileBindings: text('profile_bindings').array().notNull(),
  toolBounds: text('tool_bounds').array().notNull(),
  resourceBounds: text('resource_bounds').array().notNull(),
  entityBounds: text('entity_bounds').array().notNull(),
  rateLimitClass: text('rate_limit_class').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipConstraints: text('ip_constraints').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastUsedOrigin: text('last_used_origin'),
});

// --- g0_sec_0003_import_quarantine ---------------------------------------------

export const importArtifacts = sec.table('import_artifacts', {
  artifactId: text('artifact_id').primaryKey(),
  manifestSha256: text('manifest_sha256').notNull(),
  producerKeyId: text('producer_key_id').notNull(),
  format: text('format').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  state: text('state').notNull(),
  stateRank: integer('state_rank').notNull(),
  priorStateRank: integer('prior_state_rank').notNull(),
  stepUpApprovalRef: text('step_up_approval_ref').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull(),
});

export const importScanFindings = sec.table('import_scan_findings', {
  findingId: text('finding_id').primaryKey(),
  artifactId: text('artifact_id').notNull(),
  scanner: text('scanner').notNull(),
  verdict: text('verdict').notNull(),
  detail: text('detail').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
});

// --- g0_sec_0004_incidents_pauses ------------------------------------------------

export const securityIncidents = sec.table('security_incidents', {
  incidentId: text('incident_id').primaryKey(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  owner: text('owner').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  containment: text('containment').notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  notificationFlags: jsonb('notification_flags').notNull(),
  recoveryVerifiedAt: timestamp('recovery_verified_at', { withTimezone: true }),
  postmortemRef: text('postmortem_ref'),
  regressionTestRef: text('regression_test_ref'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const capabilityPauses = sec.table('capability_pauses', {
  pauseId: text('pause_id').primaryKey(),
  scope: text('scope').notNull(),
  reason: text('reason').notNull(),
  openingIncidentId: text('opening_incident_id').notNull(),
  pausedAt: timestamp('paused_at', { withTimezone: true }).notNull(),
  resumedAt: timestamp('resumed_at', { withTimezone: true }),
  resumedByActor: text('resumed_by_actor'),
});

export const activationEvents = sec.table('activation_events', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  scope: text('scope').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  actor: text('actor').notNull(),
  approvedSetSnapshotRef: text('approved_set_snapshot_ref').notNull(),
  restoredFromEventId: text('restored_from_event_id'),
  reevaluationMarker: text('reevaluation_marker'),
  recordedSeq: bigint('recorded_seq', { mode: 'number' }).notNull(),
});
