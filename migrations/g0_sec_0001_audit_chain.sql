-- g0_sec_0001_audit_chain.sql
-- Append-only hash-chained audit substrate (FR-SEC-002, §35.9, ADR-056).
--
-- Tables live in the dedicated `sec` schema namespace: the security
-- perimeter owns a failure domain separate from operational data truth,
-- and the proven public-schema parity contract of @foresift/persistence
-- stays byte-identical (this migration adds zero public objects).
--
-- Rules encoded here:
--   * sec_audit_events is APPEND-ONLY in SQL: BEFORE UPDATE/DELETE raise
--     AUDIT_IMMUTABLE. Corrections are compensating events, never edits.
--   * hashes are `sha256:<hex>`; entry_hash chains prev_entry_hash with the
--     canonical payload (chain math verified continuously by @foresift/security).
--   * action_class is CHECK-pinned to the §35.9 coverage vocabulary.
--   * checkpoints carry a batch range, chained checkpoint hash, optional batch
--     signature, and the object-store reference of the independently
--     verifiable copy.
--   * verify runs record the continuous verifier's verdict with first-divergence
--     diagnostics; a FAILED run must name its divergence kind.

CREATE SCHEMA IF NOT EXISTS sec;

CREATE TABLE sec.sec_audit_events (
    seq               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at       timestamptz NOT NULL,
    actor             text NOT NULL,
    action_class      text NOT NULL CHECK (action_class IN (
                        'AUTHENTICATION_AUTHORIZATION',
                        'TOOL_RESOURCE_ACCESS',
                        'PROVIDER_COLLECTOR_ACCESS',
                        'BLOCKED_OPERATION',
                        'CONFIGURATION_CHANGE',
                        'CAPABILITY_CHANGE',
                        'COST_CHANGE',
                        'RIGHTS_CHANGE',
                        'SOURCE_DEPENDENCE_CHANGE',
                        'POOL_ADAPTER_CHANGE',
                        'PUBLIC_GATE_CHANGE',
                        'APPROVAL_STEP_UP',
                        'IMPORT_PROMOTION',
                        'PAUSE_RETIREMENT_ROLLBACK',
                        'SECRET_LIFECYCLE',
                        'INCIDENT_RECOVERY')),
    subject           text NOT NULL,
    payload_canonical text NOT NULL CHECK (length(payload_canonical) > 0),
    payload_sha256    text NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    prev_entry_hash   text NOT NULL CHECK (prev_entry_hash = 'GENESIS'
                        OR prev_entry_hash ~ '^sha256:[0-9a-f]{64}$'),
    entry_hash        text NOT NULL CHECK (entry_hash ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX sec_audit_events_occurred_idx ON sec.sec_audit_events (occurred_at);
CREATE INDEX sec_audit_events_class_idx ON sec.sec_audit_events (action_class);

-- Shared append-only guard: every trigger using it raises a message prefixed
-- AUDIT_IMMUTABLE (the machine-detectable refusal contract).
CREATE FUNCTION sec.refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'AUDIT_IMMUTABLE: % on % is refused', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER sec_audit_events_append_only
    BEFORE UPDATE OR DELETE ON sec.sec_audit_events
    FOR EACH ROW EXECUTE FUNCTION sec.refuse_mutation();

CREATE TABLE sec.sec_audit_checkpoints (
    checkpoint_id        text PRIMARY KEY,
    from_seq             bigint NOT NULL REFERENCES sec.sec_audit_events(seq),
    to_seq               bigint NOT NULL REFERENCES sec.sec_audit_events(seq),
    chain_head_hash      text NOT NULL CHECK (chain_head_hash ~ '^sha256:[0-9a-f]{64}$'),
    prev_checkpoint_hash text NOT NULL CHECK (prev_checkpoint_hash = 'GENESIS'
                            OR prev_checkpoint_hash ~ '^sha256:[0-9a-f]{64}$'),
    checkpoint_hash      text NOT NULL CHECK (checkpoint_hash ~ '^sha256:[0-9a-f]{64}$'),
    batch_signature      text,
    stored_at            timestamptz NOT NULL,
    object_ref           text,
    CONSTRAINT sec_audit_checkpoints_range CHECK (to_seq >= from_seq)
);

-- Checkpoints are tamper-EVIDENT anchors: once written they never change either.
CREATE TRIGGER sec_audit_checkpoints_append_only
    BEFORE UPDATE OR DELETE ON sec.sec_audit_checkpoints
    FOR EACH ROW EXECUTE FUNCTION sec.refuse_mutation();

CREATE TABLE sec.sec_audit_verify_runs (
    run_id               text PRIMARY KEY,
    verified_from_seq    bigint NOT NULL,
    verified_to_seq      bigint NOT NULL,
    verdict              text NOT NULL CHECK (verdict IN ('OK', 'FAILED')),
    first_divergence_seq bigint,
    divergence_kind      text CHECK (divergence_kind IN (
                            'GAP', 'REORDERING', 'MUTATION', 'DELETION', 'CHAIN_BREAK')),
    expected_hash        text,
    actual_hash          text,
    ran_at               timestamptz NOT NULL,
    CONSTRAINT sec_audit_verify_runs_range CHECK (verified_to_seq >= verified_from_seq),
    CONSTRAINT sec_audit_verify_runs_diag_required CHECK (
        (verdict = 'FAILED') = (divergence_kind IS NOT NULL)),
    CONSTRAINT sec_audit_verify_runs_ok_clean CHECK (
        verdict <> 'OK' OR first_divergence_seq IS NULL)
);
