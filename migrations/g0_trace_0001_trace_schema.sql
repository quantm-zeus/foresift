-- @requirement FR-TRACE-002 FR-TRACE-004
CREATE SCHEMA IF NOT EXISTS trace;

CREATE OR REPLACE FUNCTION trace.refuse_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'trace records are insert-only'; END $$;

CREATE TABLE trace.id_supersessions (
  replaced_id text PRIMARY KEY,
  superseded_by_id text NOT NULL,
  namespace text NOT NULL,
  recorded_at timestamptz NOT NULL,
  reason text NOT NULL
);

CREATE TABLE trace.gate_evidence (
  evidence_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  signature text NOT NULL,
  gate_kind text NOT NULL,
  approver text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  recorded_at timestamptz NOT NULL
);

CREATE TRIGGER id_supersessions_insert_only BEFORE UPDATE OR DELETE ON trace.id_supersessions
FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
CREATE TRIGGER gate_evidence_insert_only BEFORE UPDATE OR DELETE ON trace.gate_evidence
FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
