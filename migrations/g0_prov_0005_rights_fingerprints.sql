-- g0_prov_0005_rights_fingerprints.sql
-- Sixteen-field rights declarations, rights changes, the provider-artifact
-- registry with its change-action ledger, and source fingerprints
-- (FR-PROV-009, FR-PROV-010; §15.6/§15.7, AC-273).
--
-- Rules encoded here:
--   * rights versions advance monotonically per operation; changes record
--     from/to versions plus the computed newly_prohibited_uses set.
--   * artifacts carry the rights version captured AT INGESTION — use-time
--     decisions evaluate against that captured version (fail-closed).
--   * every artifact named by a tightening change gets exactly one durable
--     QUARANTINE|RETIRE action row; execution is recorded, never implied.
--   * fingerprints store canonical JSON payloads + estimator-input
--     references only — never response payload material.

CREATE TABLE prov.prov_rights_declarations (
    provider_id     text NOT NULL,
    operation_id    text NOT NULL,
    rights_version  integer NOT NULL CHECK (rights_version >= 1),
    -- The sixteen §15.6 fields:
    commercial_use_allowed            boolean NOT NULL,
    personal_research_allowed         boolean NOT NULL,
    cache_allowed                     boolean NOT NULL,
    maximum_cache_duration_seconds    bigint,
    raw_retention_allowed             boolean NOT NULL,
    derived_features_allowed          boolean NOT NULL,
    model_training_allowed            boolean NOT NULL,
    redistribution_allowed            boolean NOT NULL,
    public_alert_derivative_allowed   boolean NOT NULL,
    attribution_required              boolean NOT NULL,
    user_byok_required                boolean NOT NULL,
    raw_export_allowed                boolean NOT NULL,
    jurisdiction_restrictions         jsonb NOT NULL DEFAULT '[]'::jsonb
                                        CHECK (jsonb_typeof(jurisdiction_restrictions) = 'array'),
    terms_version                     text NOT NULL,
    verified_at                       timestamptz NOT NULL,
    verification_expires_at           timestamptz NOT NULL,
    declared_at     timestamptz NOT NULL,
    PRIMARY KEY (provider_id, operation_id, rights_version),
    CONSTRAINT prov_rights_declaration_window CHECK (verification_expires_at > verified_at),
    CONSTRAINT prov_rights_cache_duration_required CHECK (
      cache_allowed = false OR maximum_cache_duration_seconds IS NOT NULL)
);

CREATE TABLE prov.prov_rights_changes (
    change_id              text PRIMARY KEY,
    provider_id            text NOT NULL,
    operation_id           text NOT NULL,
    from_rights_version    integer NOT NULL,
    to_rights_version      integer NOT NULL,
    newly_prohibited_uses  text[] NOT NULL CHECK (
                             newly_prohibited_uses <@ ARRAY[
                               'COMMERCIAL_USE',
                               'PERSONAL_RESEARCH',
                               'CACHE',
                               'RAW_RETENTION_STORAGE',
                               'DERIVED_FEATURES',
                               'MODEL_TRAINING_USE',
                               'REDISTRIBUTION',
                               'PUBLIC_ALERT_DERIVATIVE',
                               'RAW_EXPORT']::text[]),
    changed_at             timestamptz NOT NULL,
    changed_by             text NOT NULL,
    CONSTRAINT prov_rights_changes_progress CHECK (to_rights_version > from_rights_version),
    FOREIGN KEY (provider_id, operation_id, from_rights_version)
      REFERENCES prov.prov_rights_declarations (provider_id, operation_id, rights_version),
    FOREIGN KEY (provider_id, operation_id, to_rights_version)
      REFERENCES prov.prov_rights_declarations (provider_id, operation_id, rights_version)
);

CREATE TABLE prov.prov_provider_artifacts (
    artifact_id       text PRIMARY KEY,
    object_ref        text NOT NULL UNIQUE,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
    rights_version    integer NOT NULL,
    state             text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN (
                        'ACTIVE', 'QUARANTINED', 'RETIRED')),
    captured_at       timestamptz NOT NULL
);

CREATE INDEX prov_provider_artifacts_op_idx
    ON prov.prov_provider_artifacts (provider_id, operation_id) WHERE state = 'ACTIVE';

CREATE TABLE prov.prov_rights_change_actions (
    action_id    text PRIMARY KEY,
    change_id    text NOT NULL REFERENCES prov.prov_rights_changes (change_id),
    artifact_id  text NOT NULL REFERENCES prov.prov_provider_artifacts (artifact_id),
    action       text NOT NULL CHECK (action IN ('QUARANTINE', 'RETIRE')),
    created_at   timestamptz NOT NULL,
    executed_at  timestamptz,
    CONSTRAINT prov_rights_change_actions_unique_per_artifact
      UNIQUE (change_id, artifact_id)
);

CREATE TABLE prov.prov_source_fingerprints (
    provider_id        text NOT NULL,
    operation_id       text NOT NULL,
    operation_version  text NOT NULL,
    fingerprint_kind   text NOT NULL CHECK (fingerprint_kind IN (
                         'UPSTREAM_LINEAGE',
                         'VALUE_CORRELATION',
                         'TIMING_BEHAVIOR',
                         'OUTAGE_CORRELATION',
                         'SCHEMA_CHARACTERISTICS',
                         'FIRST_SEEN_BEHAVIOR')),
    fingerprint_version integer NOT NULL CHECK (fingerprint_version >= 1),
    payload_canonical  text NOT NULL CHECK (length(payload_canonical) > 0),
    estimator_input_refs jsonb NOT NULL DEFAULT '[]'::jsonb
                           CHECK (jsonb_typeof(estimator_input_refs) = 'array'),
    computed_at        timestamptz NOT NULL,
    PRIMARY KEY (provider_id, operation_id, operation_version, fingerprint_kind,
                 fingerprint_version)
);
