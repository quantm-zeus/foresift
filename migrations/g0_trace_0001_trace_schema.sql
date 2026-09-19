-- @requirement FR-TRACE-002 FR-TRACE-004
-- Apply as one transaction. Rollback: DROP SCHEMA trace CASCADE.
CREATE SCHEMA trace;

CREATE FUNCTION trace.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trace ledgers are insert-only';
END;
$$;

CREATE TABLE trace.id_supersessions (
  replaced_id text PRIMARY KEY,
  replacement_id text NOT NULL UNIQUE,
  namespace text NOT NULL CHECK (namespace IN
    ('FR','AC','INV','ADR','FEATURE','SCHEMA','API','TOOL','POLICY','ARTIFACT','TEST')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  recorded_at timestamptz NOT NULL,
  CHECK (replaced_id <> replacement_id),
  CHECK (split_part(replaced_id, '-', 1) = namespace),
  CHECK (split_part(replacement_id, '-', 1) = namespace)
);

CREATE TABLE trace.gate_evidence (
  evidence_id text PRIMARY KEY,
  gate_kind text NOT NULL CHECK (gate_kind IN ('MANUAL','LEGAL','RIGHTS','STATISTICAL','OWNER_APPROVAL')),
  scope_refs jsonb NOT NULL CHECK (jsonb_typeof(scope_refs) = 'array'),
  subject text NOT NULL,
  approver text NOT NULL,
  payload jsonb NOT NULL,
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signature text NOT NULL CHECK (signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revocation_ref text,
  CHECK (expires_at > issued_at)
);

CREATE TRIGGER id_supersessions_append_only BEFORE UPDATE OR DELETE ON trace.id_supersessions
  FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
CREATE TRIGGER id_supersessions_no_truncate BEFORE TRUNCATE ON trace.id_supersessions
  FOR EACH STATEMENT EXECUTE FUNCTION trace.refuse_mutation();
CREATE TRIGGER gate_evidence_append_only BEFORE UPDATE OR DELETE ON trace.gate_evidence
  FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
CREATE TRIGGER gate_evidence_no_truncate BEFORE TRUNCATE ON trace.gate_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION trace.refuse_mutation();
