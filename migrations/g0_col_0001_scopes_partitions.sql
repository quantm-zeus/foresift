-- Rollback: DROP SCHEMA col CASCADE; DROP SCHEMA disc CASCADE;
BEGIN;
CREATE SCHEMA IF NOT EXISTS col;
CREATE SCHEMA IF NOT EXISTS disc;

CREATE TABLE col.collector_scopes (
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  chain_id text NOT NULL,
  program_id text NOT NULL,
  program_version text NOT NULL,
  event_families text[] NOT NULL CHECK (cardinality(event_families) > 0),
  account_filters text[] NOT NULL DEFAULT '{}',
  coverage_start timestamptz NOT NULL,
  finality_policy text NOT NULL CHECK (finality_policy IN ('PROCESSED','CONFIRMED','FINALIZED')),
  decoder_version text NOT NULL,
  byte_envelope bigint NOT NULL CHECK (byte_envelope > 0),
  quota_envelope numeric NOT NULL CHECK (quota_envelope >= 0),
  max_lag_slots bigint NOT NULL CHECK (max_lag_slots >= 0),
  max_gap_age_ms bigint NOT NULL CHECK (max_gap_age_ms >= 0),
  rights_policy_ref text NOT NULL,
  retention_policy_ref text NOT NULL,
  support_manifest_ref text NOT NULL CHECK (support_manifest_ref ~ '^sha256:[0-9a-f]{64}$'),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, scope_version)
);
CREATE UNIQUE INDEX collector_scopes_one_active_version ON col.collector_scopes(scope_id) WHERE active;

CREATE TABLE col.collector_partitions (
  partition_id text PRIMARY KEY,
  scope_id text NOT NULL,
  scope_version integer NOT NULL,
  state text NOT NULL CHECK (state IN ('DISABLED','STARTING','SYNCING','LIVE','DEGRADED','GAP_DETECTED','BACKFILLING','PAUSED','FAILED')),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  shard_id text NOT NULL,
  lease_ref text NOT NULL,
  checkpoint bigint NOT NULL DEFAULT 0 CHECK (checkpoint >= 0),
  transitioned_at timestamptz NOT NULL,
  audit_ref text NOT NULL,
  reason text NOT NULL,
  FOREIGN KEY (scope_id, scope_version) REFERENCES col.collector_scopes(scope_id, scope_version)
);
CREATE TABLE col.collector_partition_transitions (
  transition_id text PRIMARY KEY, partition_id text NOT NULL REFERENCES col.collector_partitions(partition_id),
  from_state text NOT NULL, to_state text NOT NULL, fencing_token bigint NOT NULL,
  occurred_at timestamptz NOT NULL, audit_ref text NOT NULL, reason text NOT NULL
);
CREATE OR REPLACE FUNCTION col.guard_partition_monotonicity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fencing_token < OLD.fencing_token OR (NEW.fencing_token = OLD.fencing_token AND NEW.checkpoint < OLD.checkpoint) THEN
    RAISE EXCEPTION 'collector partition fencing/checkpoint regression';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER collector_partition_monotonic BEFORE UPDATE ON col.collector_partitions
FOR EACH ROW EXECUTE FUNCTION col.guard_partition_monotonicity();

CREATE TABLE col.program_support_manifests (
  content_hash text PRIMARY KEY, manifest_json jsonb NOT NULL, valid_from timestamptz NOT NULL,
  valid_until timestamptz, verified boolean NOT NULL DEFAULT false
);
CREATE TABLE col.collector_decode_pauses (
  pause_id text PRIMARY KEY, scope_id text NOT NULL, program_id text NOT NULL, program_version text NOT NULL,
  decoder_version text NOT NULL, reason text NOT NULL, raw_events_preserved boolean NOT NULL CHECK (raw_events_preserved),
  paused_at timestamptz NOT NULL, revalidated_at timestamptz, incident_id text NOT NULL
);
CREATE UNIQUE INDEX collector_active_decode_pause ON col.collector_decode_pauses(scope_id) WHERE revalidated_at IS NULL;
CREATE TABLE col.collector_incidents (
  incident_id text PRIMARY KEY, scope_id text, partition_id text, kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')), opened_at timestamptz NOT NULL,
  resolved_at timestamptz, evidence_refs text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE col.collector_health (
  partition_id text NOT NULL, measured_at timestamptz NOT NULL, snapshot_json jsonb NOT NULL,
  PRIMARY KEY (partition_id, measured_at)
);
CREATE TABLE col.collector_first_seen_spans (
  subject_id text NOT NULL, scope_id text NOT NULL, recorded_at timestamptz NOT NULL, spans_json jsonb NOT NULL,
  PRIMARY KEY (subject_id, scope_id, recorded_at)
);
CREATE TABLE col.collector_watermarks (
  watermark_key text PRIMARY KEY, contiguous_through bigint NOT NULL CHECK (contiguous_through >= 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0), updated_at timestamptz NOT NULL
);
CREATE TABLE col.collector_gap_registry (
  gap_id text PRIMARY KEY, partition_id text NOT NULL, start_position bigint NOT NULL, end_position bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','BACKFILL_QUEUED','BACKFILLING','RESOLVED_COMPLETE','RESOLVED_EMPTY_PROOF','PARTIAL','UNRESOLVED','WAIVED_FOR_NARROW_SCOPE')),
  waiver_scope text, waiver_signature text, waiver_expires_at timestamptz, updated_at timestamptz NOT NULL,
  CHECK (start_position <= end_position),
  CHECK (status <> 'WAIVED_FOR_NARROW_SCOPE' OR (waiver_scope IS NOT NULL AND waiver_signature IS NOT NULL AND waiver_expires_at IS NOT NULL))
);

CREATE TABLE disc.coverage_population_manifests (
  manifest_id text PRIMARY KEY, population_id text NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
  manifest_json jsonb NOT NULL, content_hash text NOT NULL UNIQUE
);
CREATE TABLE disc.discovery_universe_entries (
  entry_id text PRIMARY KEY, subject_id text NOT NULL, population_id text NOT NULL,
  first_seen_at timestamptz NOT NULL, valid_from timestamptz NOT NULL, valid_until timestamptz,
  entry_json jsonb NOT NULL
);
CREATE INDEX discovery_universe_at_t ON disc.discovery_universe_entries(population_id, valid_from, valid_until);
CREATE TABLE disc.discovery_attributions (
  entry_id text NOT NULL REFERENCES disc.discovery_universe_entries(entry_id), source_id text NOT NULL,
  source_timestamp timestamptz NOT NULL, system_timestamp timestamptz NOT NULL, source_rank integer NOT NULL,
  attribution_json jsonb NOT NULL, PRIMARY KEY(entry_id, source_id, system_timestamp)
);
CREATE TABLE disc.cheap_monitor_rows (
  monitor_id text PRIMARY KEY, candidate_id text NOT NULL UNIQUE, state text NOT NULL,
  checks_completed integer NOT NULL, max_checks integer NOT NULL, next_check_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, row_json jsonb NOT NULL
);
CREATE TABLE disc.promotion_decisions (
  decision_id text PRIMARY KEY, candidate_id text NOT NULL, inputs_hash text NOT NULL UNIQUE,
  decision_version text NOT NULL, decision_json jsonb NOT NULL, decided_at timestamptz NOT NULL
);
CREATE TABLE disc.monitor_observations (
  observation_id text PRIMARY KEY, monitor_id text NOT NULL REFERENCES disc.cheap_monitor_rows(monitor_id),
  observed_at timestamptz NOT NULL, observation_json jsonb NOT NULL
);
COMMIT;
