-- FR-TRACE-002 / FR-TRACE-004: immutable traceability and signed gate evidence.
CREATE SCHEMA IF NOT EXISTS trace;

CREATE OR REPLACE FUNCTION trace.refuse_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trace ledgers are insert-only';
END;
$$;

CREATE TABLE trace.id_supersessions (
  replaced_id text PRIMARY KEY,
  superseded_by_id text NOT NULL,
  namespace text NOT NULL CHECK (namespace IN ('requirement', 'acceptance', 'invariant', 'adr', 'feature', 'schema', 'api', 'tool', 'policy', 'artifact', 'test')),
  recorded_at timestamptz NOT NULL,
  reason text NOT NULL,
  CHECK (replaced_id <> superseded_by_id)
);

CREATE TABLE trace.gate_evidence (
  evidence_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$'),
  gate_kind text NOT NULL CHECK (gate_kind IN ('MANUAL', 'LEGAL', 'RIGHTS', 'STATISTICAL', 'OWNER_APPROVAL')),
  approver text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  recorded_at timestamptz NOT NULL,
  CHECK (expires_at > issued_at)
);

CREATE TRIGGER id_supersessions_insert_only BEFORE UPDATE OR DELETE ON trace.id_supersessions
FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
CREATE TRIGGER gate_evidence_insert_only BEFORE UPDATE OR DELETE ON trace.gate_evidence
FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();

-- Rollback: DROP SCHEMA trace CASCADE; only before any released trace record exists.
