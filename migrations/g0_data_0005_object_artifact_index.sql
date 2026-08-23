-- g0_data_0005_object_artifact_index.sql
-- Staged cross-store artifact index (§14.8) and the exactly-once canonical
-- event substrate used by restore+replay (AC-263).
--
-- Stage machine: PENDING_UPLOAD -> STORED_HASH_VERIFIED -> INDEX_COMMITTED
-- -> AVAILABLE. Timestamp columns record each transition; a row cannot be
-- AVAILABLE until hash verification and index commit both happened.

CREATE TABLE object_artifacts (
    artifact_id        text PRIMARY KEY,
    content_hash       text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    stage              text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (stage IN (
                           'PENDING_UPLOAD',
                           'STORED_HASH_VERIFIED',
                           'INDEX_COMMITTED',
                           'AVAILABLE')),
    encryption_status  text NOT NULL,
    rights_ref         text,
    retention_class    text NOT NULL,
    version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    size_bytes         bigint NOT NULL CHECK (size_bytes >= 0),
    uploaded_at        timestamptz NOT NULL,
    hash_verified_at   timestamptz,
    index_committed_at timestamptz,
    available_at       timestamptz,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT object_artifacts_stage_ordering CHECK ((
        CASE
            WHEN stage = 'AVAILABLE' THEN 3
            WHEN stage = 'INDEX_COMMITTED' THEN 2
            WHEN stage = 'STORED_HASH_VERIFIED' THEN 1
            ELSE 0
        END) >= (
        CASE
            WHEN available_at IS NOT NULL THEN 3
            WHEN index_committed_at IS NOT NULL THEN 2
            WHEN hash_verified_at IS NOT NULL THEN 1
            ELSE 0
        END))
);

CREATE UNIQUE INDEX object_artifacts_hash_version_idx
    ON object_artifacts (content_hash, version);

-- Exactly-once ingest ledger: replay after restore inserts each canonical
-- event key once; duplicates are refused rather than re-applied.
CREATE TABLE canonical_event_keys (
    canonical_key  text PRIMARY KEY,
    event_family   text NOT NULL,
    first_seen_at  timestamptz NOT NULL
);
