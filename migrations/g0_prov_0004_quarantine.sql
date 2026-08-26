-- g0_prov_0004_quarantine.sql
-- Metadata-only response quarantine (FR-PROV-008, AC-271; plan material
-- decision 6).
--
-- THE STRUCTURAL RULE: there is NO payload-body column in this table, by
-- design. Quarantine persists detection class, field paths, sha256, byte
-- size, disposition, audit-chain reference, and the model-context exclusion
-- constant — NEVER the hazardous response material itself. Persisting a
-- transaction payload, signing request, executable instruction, or private-
-- key field here is structurally impossible, not merely discouraged
-- (private-key material must not be persisted even for forensics).

CREATE TABLE prov.prov_response_quarantine (
    seq                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quarantine_id           text NOT NULL UNIQUE,
    provider_id             text NOT NULL,
    operation_id            text NOT NULL,
    operation_version       text NOT NULL,
    detected_classes        text[] NOT NULL CHECK (
                              array_length(detected_classes, 1) >= 1 AND
                              detected_classes <@ ARRAY[
                                'TRANSACTION_PAYLOAD',
                                'SIGNING_REQUEST',
                                'EXECUTABLE_INSTRUCTION',
                                'PRIVATE_KEY_FIELD',
                                'UNEXPECTED_WRITE_CAPABILITY']::text[]),
    field_paths             text[] NOT NULL CHECK (array_length(field_paths, 1) >= 1),
    payload_sha256          text NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    byte_size               bigint NOT NULL CHECK (byte_size >= 0),
    disposition             text NOT NULL DEFAULT 'REJECTED' CHECK (disposition = 'REJECTED'),
    model_context_exclusion text NOT NULL DEFAULT 'ENFORCED'
                              CHECK (model_context_exclusion = 'ENFORCED'),
    audit_chain_ref         text NOT NULL,
    quarantined_at          timestamptz NOT NULL,
    details                 text,
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations (provider_id, operation_id, version)
);

CREATE INDEX prov_response_quarantine_target_idx
    ON prov.prov_response_quarantine (provider_id, operation_id, operation_version, quarantined_at);

CREATE TRIGGER prov_response_quarantine_append_only
    BEFORE UPDATE OR DELETE ON prov.prov_response_quarantine
    FOR EACH ROW EXECUTE FUNCTION prov.refuse_mutation();

CREATE TRIGGER prov_response_quarantine_immutable_truncate
    BEFORE TRUNCATE ON prov.prov_response_quarantine
    FOR EACH STATEMENT EXECUTE FUNCTION prov.refuse_mutation();
