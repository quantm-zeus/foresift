-- g0_prov_0005_rights_fingerprints.sql
-- Rights matrices, rights changes, the provider-artifact registry, change
-- actions, and source fingerprints (FR-PROV-009, FR-PROV-010; AC-272, AC-273;
-- §15.6/§15.7).
--
-- Rules encoded here:
--   * prov_rights_declarations carries the SIXTEEN §15.6 fields verbatim
--     (rights_version + terms_version + verified/expires included), unique per
--     (provider, operation, version) — declarations are immutable history.
--   * prov_rights_changes records from→to versions with newly_prohibited_uses
--     CHECK-pinned to a SUBSET of the seven use-path values and non-empty
--     (a recorded change that prohibits nothing new is not a tightening).
--   * prov_provider_artifacts is the capture-time registry: object ref +
--     operation ref + rights version AT CAPTURE. State is CHECK-pinned to
--     ACTIVE | QUARANTINED | RETIRED.
--   * prov_rights_change_actions durably names each (change, artifact,
--     QUARANTINE|RETIRE) decision exactly once.
--   * prov_source_fingerprints stores the SIX fingerprint kinds as canonical
--     JSON + sha256, versioned monotonically per (ref, kind), carrying
--     estimator-input references for the future ProviderDependenceEstimator.

CREATE TABLE prov.prov_rights_declarations (
    declaration_id                  text PRIMARY KEY,
    provider_id                     text NOT NULL,
    operation_id                    text NOT NULL,
    operation_version               text NOT NULL,
    rights_version                  text NOT NULL,
    commercial_use_allowed          boolean NOT NULL,
    personal_research_allowed       boolean NOT NULL,
    cache_allowed                   boolean NOT NULL,
    maximum_cache_duration          text,
    raw_retention_allowed           boolean NOT NULL,
    derived_features_allowed        boolean NOT NULL,
    model_training_allowed          boolean NOT NULL,
    redistribution_allowed          boolean NOT NULL,
    public_alert_derivative_allowed boolean NOT NULL,
    attribution_required            boolean NOT NULL,
    user_byok_required              boolean NOT NULL,
    raw_export_allowed              boolean NOT NULL,
    jurisdiction_restrictions       jsonb NOT NULL CHECK (
                                      jsonb_typeof(jurisdiction_restrictions) = 'array'),
    terms_version                   text NOT NULL,
    verified_at                     timestamptz NOT NULL,
    verification_expires_at         timestamptz NOT NULL,
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations(provider_id, operation_id, version),
    CONSTRAINT prov_rights_declaration_unique UNIQUE (
        provider_id, operation_id, operation_version, rights_version),
    CONSTRAINT prov_rights_expiry CHECK (verification_expires_at > verified_at),
    CONSTRAINT prov_rights_cache_duration_shape CHECK (
        cache_allowed = false OR maximum_cache_duration IS NOT NULL)
);

CREATE TABLE prov.prov_rights_changes (
    change_id              text PRIMARY KEY,
    provider_id            text NOT NULL,
    operation_id           text NOT NULL,
    from_rights_version    text NOT NULL,
    to_rights_version      text NOT NULL,
    newly_prohibited_uses  text[] NOT NULL CHECK (
                             cardinality(newly_prohibited_uses) >= 1 AND newly_prohibited_uses <@ ARRAY[
                               'CACHE', 'RAW_RETENTION', 'EXPORT', 'REDISTRIBUTION',
                               'MODEL_USE', 'STORAGE', 'DERIVED_FEATURES']::text[]),
    changed_at             timestamptz NOT NULL,
    declared_by            text NOT NULL,
    evidence_refs          jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array')
);

CREATE TABLE prov.prov_provider_artifacts (
    artifact_id                text PRIMARY KEY,
    object_ref                 text NOT NULL UNIQUE,
    provider_id                text NOT NULL,
    operation_id               text NOT NULL,
    operation_version          text NOT NULL,
    rights_version_at_capture  text NOT NULL,
    state                      text NOT NULL DEFAULT 'ACTIVE' CHECK (
                                 state IN ('ACTIVE', 'QUARANTINED', 'RETIRED')),
    captured_at                timestamptz NOT NULL
);

CREATE INDEX prov_provider_artifacts_capture_idx
    ON prov.prov_provider_artifacts (provider_id, operation_id, operation_version);

CREATE TABLE prov.prov_rights_change_actions (
    action_id   text PRIMARY KEY,
    change_id   text NOT NULL REFERENCES prov.prov_rights_changes(change_id),
    artifact_id text NOT NULL REFERENCES prov.prov_provider_artifacts(artifact_id),
    action      text NOT NULL CHECK (action IN ('QUARANTINE', 'RETIRE')),
    executed_at timestamptz NOT NULL,
    executed_by text NOT NULL,
    CONSTRAINT prov_rights_change_action_unique UNIQUE (change_id, artifact_id)
);

CREATE TABLE prov.prov_source_fingerprints (
    fingerprint_id    text PRIMARY KEY,
    provider_id       text NOT NULL,
    operation_id      text NOT NULL,
    operation_version text NOT NULL,
    kind              text NOT NULL CHECK (kind IN (
                        'UPSTREAM_LINEAGE',
                        'VALUE_CORRELATION',
                        'TIMING_BEHAVIOR',
                        'OUTAGE_CORRELATION',
                        'SCHEMA_CHARACTERISTICS',
                        'FIRST_SEEN_BEHAVIOR')),
    version           integer NOT NULL CHECK (version >= 1),
    payload_canonical text NOT NULL CHECK (length(payload_canonical) > 0),
    payload_sha256    text NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    computed_at       timestamptz NOT NULL,
    estimator_inputs  jsonb NOT NULL CHECK (jsonb_typeof(estimator_inputs) = 'object'),
    FOREIGN KEY (provider_id, operation_id, operation_version)
        REFERENCES prov.prov_operations(provider_id, operation_id, version),
    CONSTRAINT prov_source_fingerprint_versioned UNIQUE (
        provider_id, operation_id, operation_version, kind, version)
);
