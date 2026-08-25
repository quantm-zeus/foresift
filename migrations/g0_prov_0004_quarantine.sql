-- g0_prov_0004_quarantine.sql
-- Metadata-only response quarantine records (FR-PROV-008; AC-271).
--
-- Rules encoded here:
--   * detected_classes is CHECK-pinned to the five malicious-response
--     classes and must name at least one class. cardinality() (not
--     array_length()) is used deliberately: array_length returns NULL for a
--     zero-length array, which would silently satisfy the >= 1 comparison.
--   * NO payload-body column exists: hazardous material is structurally
--     unpersistable. Only field paths, sha256 hash, byte size, disposition,
--     audit reference, and the model-context exclusion constant persist
--     (private-key material is never persisted even for forensics).
--   * disposition is always REJECTED and model_context_exclusion is always
--     ENFORCED — there is no representable state in which quarantined bytes
--     reach a model-context envelope or durable storage.

CREATE TABLE prov.prov_response_quarantine (
    quarantine_id          text PRIMARY KEY,
    provider_id            text NOT NULL,
    operation_id           text NOT NULL,
    detected_classes       text[] NOT NULL CHECK (
                             cardinality(detected_classes) >= 1 AND
                             detected_classes <@ ARRAY[
                               'TRANSACTION_PAYLOAD',
                               'SIGNING_REQUEST',
                               'EXECUTABLE_INSTRUCTION',
                               'PRIVATE_KEY_FIELD',
                               'UNEXPECTED_WRITE_CAPABILITY']::text[]),
    field_paths            jsonb NOT NULL DEFAULT '[]'::jsonb
                             CHECK (jsonb_typeof(field_paths) = 'array'),
    payload_sha256         text NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    byte_size              bigint NOT NULL CHECK (byte_size >= 0),
    disposition            text NOT NULL DEFAULT 'REJECTED' CHECK (disposition = 'REJECTED'),
    audit_ref              text NOT NULL,
    model_context_exclusion text NOT NULL DEFAULT 'ENFORCED'
                             CHECK (model_context_exclusion = 'ENFORCED'),
    detected_at            timestamptz NOT NULL
);

CREATE INDEX prov_response_quarantine_op_idx
    ON prov.prov_response_quarantine (provider_id, operation_id, detected_at);
