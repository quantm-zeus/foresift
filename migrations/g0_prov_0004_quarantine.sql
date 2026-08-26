-- g0_prov_0004_quarantine.sql
-- Metadata-only response quarantine (FR-PROV-008; AC-271).
--
-- Rules encoded here:
--   * detected_classes is a non-empty array SUBSET of the five FR-PROV-008
--     malicious-response classes.
--   * disposition is CHECK-pinned to REJECTED and model_context_exclusion to
--     ENFORCED — a quarantined response that was not rejected, or that could
--     still reach model context, is unrepresentable.
--   * NO payload-body column exists. The record stores detection class, field
--     paths, sha256, byte size, detector version, and the audit-chain
--     reference ONLY — persisting transaction payloads or key material is
--     structurally impossible (Constitution XV), not merely discouraged.
--   * Records are append-only in SQL (PROV_IMMUTABLE triggers): quarantine
--     history is audit evidence and never edited away.

CREATE TABLE prov.prov_response_quarantine (
    quarantine_id          text PRIMARY KEY,
    provider_id            text NOT NULL,
    operation_id           text NOT NULL,
    operation_version      text NOT NULL,
    detected_classes       text[] NOT NULL CHECK (
                             cardinality(detected_classes) >= 1 AND detected_classes <@ ARRAY[
                               'TRANSACTION_PAYLOAD',
                               'SIGNING_REQUEST',
                               'EXECUTABLE_INSTRUCTION',
                               'PRIVATE_KEY_FIELD',
                               'WRITE_CAPABILITY']::text[]),
    field_paths            jsonb NOT NULL CHECK (jsonb_typeof(field_paths) = 'array'),
    payload_sha256         text NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    byte_size              integer NOT NULL CHECK (byte_size >= 0),
    disposition            text NOT NULL CHECK (disposition = 'REJECTED'),
    model_context_exclusion text NOT NULL CHECK (model_context_exclusion = 'ENFORCED'),
    detector_version       text NOT NULL,
    audit_entry_seq        bigint,
    detected_at            timestamptz NOT NULL
);

CREATE TRIGGER prov_response_quarantine_append_only
    BEFORE UPDATE OR DELETE ON prov.prov_response_quarantine
    FOR EACH ROW EXECUTE FUNCTION prov.refuse_mutation();

CREATE TRIGGER prov_response_quarantine_immutable_truncate
    BEFORE TRUNCATE ON prov.prov_response_quarantine
    FOR EACH STATEMENT EXECUTE FUNCTION prov.refuse_mutation();
