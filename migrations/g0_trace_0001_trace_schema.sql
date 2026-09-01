-- g0_trace_0001_trace_schema.sql
-- Rollback: DROP SCHEMA trace CASCADE;
-- Append-only ID supersession and signed gate-evidence truth (FR-TRACE-002, FR-TRACE-004).

CREATE SCHEMA IF NOT EXISTS trace;

CREATE FUNCTION trace.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'TRACE_APPEND_ONLY: % on %.% is refused',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TABLE trace.id_supersessions (
    superseded_id  text NOT NULL CHECK (length(btrim(superseded_id)) > 0),
    superseding_id text NOT NULL CHECK (length(btrim(superseding_id)) > 0),
    namespace      text NOT NULL CHECK (namespace IN (
                       'requirement', 'acceptance', 'invariant', 'adr',
                       'feature', 'schema', 'api', 'tool', 'policy',
                       'artifact', 'test')),
    reason         text NOT NULL CHECK (length(btrim(reason)) > 0),
    recorded_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT id_supersessions_single_successor PRIMARY KEY (namespace, superseded_id),
    CONSTRAINT id_supersessions_distinct_ids CHECK (superseded_id <> superseding_id)
);

CREATE TRIGGER id_supersessions_append_only
    BEFORE UPDATE OR DELETE ON trace.id_supersessions
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();

CREATE TABLE trace.gate_evidence (
    evidence_id     text PRIMARY KEY CHECK (length(btrim(evidence_id)) > 0),
    payload         jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_sha256  text NOT NULL CHECK (payload_sha256 ~ '^(sha256:)?[0-9a-f]{64}$'),
    signature       text NOT NULL CHECK (signature ~ '^(sha256:)?[0-9a-f]{64}$'),
    gate_kind       text NOT NULL CHECK (gate_kind IN (
                        'MANUAL', 'LEGAL', 'RIGHTS', 'STATISTICAL', 'OWNER_APPROVAL')),
    scope_refs      text[] NOT NULL CHECK (cardinality(scope_refs) > 0),
    approver        text NOT NULL CHECK (length(btrim(approver)) > 0),
    issued_at       timestamptz NOT NULL,
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    revocation_ref  text,
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gate_evidence_valid_window CHECK (expires_at > issued_at),
    CONSTRAINT gate_evidence_revocation_complete CHECK (
        (revoked_at IS NULL AND revocation_ref IS NULL)
        OR (revoked_at IS NOT NULL AND revocation_ref IS NOT NULL
            AND length(btrim(revocation_ref)) > 0))
);

CREATE TRIGGER gate_evidence_append_only
    BEFORE UPDATE OR DELETE ON trace.gate_evidence
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
