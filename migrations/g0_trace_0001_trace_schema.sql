-- Traceability identity and signed gate evidence (FR-TRACE-002, FR-TRACE-004).
CREATE SCHEMA IF NOT EXISTS trace;

CREATE FUNCTION trace.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'trace records are insert-only'
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TABLE trace.id_supersessions (
    replaced_id       text PRIMARY KEY,
    superseded_by_id  text NOT NULL,
    namespace         text NOT NULL,
    recorded_at       timestamptz NOT NULL,
    reason            text NOT NULL
);

CREATE TRIGGER id_supersessions_immutable
    BEFORE UPDATE OR DELETE ON trace.id_supersessions
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();

CREATE TABLE trace.gate_evidence (
    evidence_id     text PRIMARY KEY,
    payload         jsonb NOT NULL,
    payload_sha256  text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    signature       text NOT NULL CHECK (signature ~ '^[a-f0-9]{64}$'),
    gate_kind       text NOT NULL CHECK (gate_kind IN (
                        'MANUAL', 'LEGAL', 'RIGHTS', 'STATISTICAL', 'OWNER_APPROVAL')),
    approver        text NOT NULL CHECK (length(btrim(approver)) > 0),
    issued_at       timestamptz NOT NULL,
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    recorded_at     timestamptz NOT NULL,
    CHECK (expires_at > issued_at)
);

CREATE TRIGGER gate_evidence_immutable
    BEFORE UPDATE OR DELETE ON trace.gate_evidence
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();

CREATE TRIGGER gate_evidence_immutable_truncate
    BEFORE TRUNCATE ON trace.gate_evidence
    FOR EACH STATEMENT EXECUTE FUNCTION trace.refuse_mutation();
