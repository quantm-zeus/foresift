-- g0_prov_0005_rights_fingerprints.sql
-- Sixteen-field rights declarations, rights changes, the provider-artifact
-- registry with its change-action ledger, and provider source fingerprints
-- (FR-PROV-009, §15.6; FR-PROV-010, §15.7).
--
-- Rules encoded here:
--   * rights matrices carry all SIXTEEN §15.6 fields with terms_version and
--     verification window (verification_expires_at > verified_at); they tie
--     into the FR-PROV-002 TTL engine.
--   * rights changes record from/to versions and the newly-prohibited use
--     paths CHECK-pinned to the seven-path alphabet.
--   * artifacts are capture-time registrations bound to the rights version
--     at ingestion; state moves ACTIVE|QUARANTINED|RETIRED only through the
--     change-action ledger.
--   * change actions are UNIQUE per (change, artifact) so a replayed
--     tightening cannot double-execute (INV-009).
--   * fingerprints store CANONICAL JSON payloads plus their sha256 and
--     estimator-input references — inputs for the future dependence
--     estimator, never verdicts.

CREATE TABLE prov.prov_rights_declarations (
    declaration_id         text PRIMARY KEY,
    provider_id            text NOT NULL REFERENCES prov.prov_providers(provider_id),
    operation_id           text NOT NULL,
    rights_version         integer NOT NULL CHECK (rights_version >= 1),
    -- the sixteen §15.6 fields
    commercial_use_allowed            boolean NOT NULL,
    personal_research_allowed         boolean NOT NULL,
    cache_allowed                     boolean NOT NULL,
    maximum_cache_duration_seconds    integer NOT NULL CHECK (maximum_cache_duration_seconds >= 0),
    raw_retention_allowed             boolean NOT NULL,
    derived_features_allowed          boolean NOT NULL,
    model_training_allowed            boolean NOT NULL,
    redistribution_allowed            boolean NOT NULL,
    public_alert_derivative_allowed   boolean NOT NULL,
    attribution_required              boolean NOT NULL,
    user_byok_required                boolean NOT NULL,
    raw_export_allowed                boolean NOT NULL,
    jurisdiction_restrictions         text[] NOT NULL DEFAULT '{}'::text[],
    terms_version                     text NOT NULL,
    verified_at                       timestamptz NOT NULL,
    verification_expires_at           timestamptz NOT NULL,
    declared_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prov_rights_declaration_window CHECK (
        verification_expires_at > verified_at),
    UNIQUE (provider_id, operation_id, rights_version)
);

-- Rights changes key the OPERATION IDENTITY (provider_id, operation_id):
-- rights policy spans operation versions, so unlike the version-scoped tables
-- above there is deliberately NO foreign key into prov_operations here —
-- referential integrity is enforced by the engine, which resolves every
-- change against registered operations before writing.
CREATE TABLE prov.prov_rights_changes (
    seq                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    change_id             text NOT NULL UNIQUE,
    provider_id           text NOT NULL REFERENCES prov.prov_providers(provider_id),
    operation_id          text NOT NULL,
    from_rights_version   integer NOT NULL CHECK (from_rights_version >= 1),
    to_rights_version     integer NOT NULL CHECK (to_rights_version >= 1),
    newly_prohibited_uses text[] NOT NULL DEFAULT '{}'::text[] CHECK (
                              newly_prohibited_uses <@ ARRAY[
                                'STORAGE',
                                'DERIVED_USE',
                                'REDISTRIBUTION',
                                'CACHING',
                                'EXPORT',
                                'MODEL_TRAINING',
                                'PUBLIC_ALERT']::text[]),
    tightened             boolean NOT NULL,
    changed_at            timestamptz NOT NULL,
    actor                 text NOT NULL,
    audit_chain_ref       text NOT NULL,
    CONSTRAINT prov_rights_change_versions_differ CHECK (
        to_rights_version <> from_rights_version)
);

CREATE INDEX prov_rights_changes_target_idx
    ON prov.prov_rights_changes (provider_id, operation_id, changed_at);

CREATE TABLE prov.prov_provider_artifacts (
    artifact_id       text PRIMARY KEY,
    object_ref        text NOT NULL,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
    rights_version    integer NOT NULL CHECK (rights_version >= 1),
    state             text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN (
                        'ACTIVE', 'QUARANTINED', 'RETIRED')),
    captured_at       timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL,
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations (provider_id, operation_id, version)
);

CREATE INDEX prov_provider_artifacts_target_idx
    ON prov.prov_provider_artifacts (provider_id, operation_id, state);

CREATE TABLE prov.prov_rights_change_actions (
    action_id   text PRIMARY KEY,
    change_id   text NOT NULL REFERENCES prov.prov_rights_changes(change_id),
    artifact_id text NOT NULL REFERENCES prov.prov_provider_artifacts(artifact_id),
    action      text NOT NULL CHECK (action IN ('QUARANTINE', 'RETIRE')),
    executed_at timestamptz NOT NULL,
    details     text,
    -- INV-009: a replayed change execution resolves to the SAME action row.
    UNIQUE (change_id, artifact_id)
);

CREATE TABLE prov.prov_source_fingerprints (
    seq                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fingerprint_id               text NOT NULL UNIQUE,
    provider_id                  text NOT NULL,
    operation_id                 text NOT NULL,
    operation_version            text NOT NULL,
    kind                         text NOT NULL CHECK (kind IN (
                                   'UPSTREAM_LINEAGE',
                                   'VALUE_CORRELATION',
                                   'TIMING_BEHAVIOR',
                                   'OUTAGE_CORRELATION',
                                   'SCHEMA_CHARACTERISTICS',
                                   'FIRST_SEEN_BEHAVIOR')),
    fingerprint_payload_canonical text NOT NULL CHECK (
                                   length(fingerprint_payload_canonical) > 0),
    fingerprint_sha256           text NOT NULL CHECK (fingerprint_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    computed_at                  timestamptz NOT NULL,
    estimator_input_refs         jsonb NOT NULL DEFAULT '[]'::jsonb,
    recorded_at                  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations (provider_id, operation_id, version),
    -- identical recomputation does not duplicate storage (INV-009 retry fence)
    CONSTRAINT prov_source_fingerprints_retry_fenced UNIQUE (
        provider_id, operation_id, operation_version, kind, fingerprint_sha256)
);

CREATE INDEX prov_source_fingerprints_lookup_idx
    ON prov.prov_source_fingerprints (provider_id, operation_id, operation_version, kind);
