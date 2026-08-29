-- Rollback: DROP SCHEMA col CASCADE; DROP SCHEMA disc CASCADE;
BEGIN;
CREATE SCHEMA IF NOT EXISTS col;

CREATE TABLE col.collector_scopes (
  scope_id text NOT NULL,
  scope_version integer NOT NULL CHECK (scope_version > 0),
  chain_id text NOT NULL,
  program_id text NOT NULL,
  program_version text NOT NULL,
  account_layout_version text NOT NULL,
  event_families text[] NOT NULL CHECK (cardinality(event_families) > 0),
  account_filters text[] NOT NULL DEFAULT '{}',
  coverage_start_slot numeric NOT NULL CHECK (coverage_start_slot >= 0),
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

CREATE TABLE col.collector_gap_registry (
  gap_id text PRIMARY KEY,
  partition_id text NOT NULL REFERENCES col.collector_partitions(partition_id),
  start_position numeric NOT NULL CHECK (start_position >= 0),
  end_position numeric NOT NULL CHECK (end_position >= start_position),
  status text NOT NULL CHECK (status IN (
    'OPEN','BACKFILL_QUEUED','BACKFILLING','RESOLVED_COMPLETE',
    'RESOLVED_EMPTY_PROOF','PARTIAL','UNRESOLVED','WAIVED_FOR_NARROW_SCOPE'
  )),
  waiver_scope text,
  waiver_signature text,
  waiver_expires_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK (
    status <> 'WAIVED_FOR_NARROW_SCOPE'
    OR (waiver_scope IS NOT NULL AND waiver_signature IS NOT NULL AND waiver_expires_at IS NOT NULL)
  )
);

CREATE TABLE col.collector_watermarks (
  watermark_key text PRIMARY KEY,
  contiguous_through numeric NOT NULL CHECK (contiguous_through >= 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE col.program_support_manifests (
  content_hash text PRIMARY KEY, manifest_json jsonb NOT NULL, valid_from timestamptz NOT NULL,
  valid_until timestamptz, verified boolean NOT NULL DEFAULT false
);
COMMIT;
