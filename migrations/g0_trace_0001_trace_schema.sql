-- Traceability identity and signed gate-evidence truth. FR-TRACE-002/004.
CREATE SCHEMA IF NOT EXISTS trace;

CREATE FUNCTION trace.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'TRACE_IMMUTABLE: % on % is refused', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TABLE trace.id_supersessions (
    replaced_id       text PRIMARY KEY,
    superseded_by_id  text NOT NULL,
    namespace         text NOT NULL,
    recorded_at       timestamptz NOT NULL,
    reason            text NOT NULL
);

CREATE TABLE trace.gate_evidence (
    evidence_id       text PRIMARY KEY,
    payload           jsonb NOT NULL,
    payload_sha256    text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    signature         text NOT NULL,
    gate_kind         text NOT NULL CHECK (gate_kind IN ('MANUAL','LEGAL','RIGHTS','STATISTICAL','OWNER_APPROVAL')),
    approver          text NOT NULL,
    issued_at         timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL,
    revoked_at        timestamptz,
    recorded_at       timestamptz NOT NULL,
    CONSTRAINT gate_evidence_window CHECK (expires_at > issued_at)
);

CREATE TRIGGER id_supersessions_append_only
    BEFORE UPDATE OR DELETE ON trace.id_supersessions
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();

CREATE TRIGGER gate_evidence_append_only
    BEFORE UPDATE OR DELETE ON trace.gate_evidence
    FOR EACH ROW EXECUTE FUNCTION trace.refuse_mutation();
