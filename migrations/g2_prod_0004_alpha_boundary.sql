-- g2_prod_0004_alpha_boundary.sql
-- §33.7 bounded precomputed alpha matching on live paths and the
-- §10.3/§35.14 isolated export/import trust boundary (FR-PROD-006, AC-279).
--
-- Additive only; no ALTER of a foreign family. All tables live in the dedicated
-- `prod` schema (ADR-G2PROD-1).

-- --- §33.7 bounded precomputed alpha envelopes ------------------------------

-- A live path may read only a versioned precomputed lookup whose
-- candidate/row/edge/latency/cost ceilings are ALL declared and strictly
-- positive. A bound without ceilings is refused by NOT NULL + CHECK rather than
-- silently treated as unbounded, and every bound expires so a stale envelope
-- can never back a current claim.
CREATE TABLE IF NOT EXISTS prod.precomputed_alpha_bounds (
    bound_id         text PRIMARY KEY CHECK (length(bound_id) > 0),
    live_path        text NOT NULL CHECK (length(live_path) > 0),
    artifact_ref     text NOT NULL CHECK (length(artifact_ref) > 0),
    artifact_set_hash text NOT NULL CHECK (artifact_set_hash ~ '^sha256:[0-9a-f]{64}$'),
    max_candidates   integer NOT NULL CHECK (max_candidates > 0),
    max_rows         integer NOT NULL CHECK (max_rows > 0),
    max_edges        integer NOT NULL CHECK (max_edges > 0),
    max_latency_ms   integer NOT NULL CHECK (max_latency_ms > 0),
    max_cost_usd     numeric NOT NULL CHECK (max_cost_usd > 0),
    dataset_cutoff   timestamptz NOT NULL,
    verified_at      timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    CONSTRAINT precomputed_alpha_bounds_expiry_order CHECK (expires_at > verified_at)
);

CREATE INDEX IF NOT EXISTS precomputed_alpha_bounds_live_path_idx
    ON prod.precomputed_alpha_bounds (live_path, expires_at);

-- --- §33.7 served/refused live-path reads -----------------------------------

-- Every live-path precomputed read is recorded as served or refused with a
-- typed reason: an unbounded/expired request is refused, never truncated into a
-- different claim.
CREATE TABLE IF NOT EXISTS prod.live_path_alpha_reads (
    read_id        text PRIMARY KEY CHECK (length(read_id) > 0),
    live_path      text NOT NULL CHECK (length(live_path) > 0),
    bound_id       text NOT NULL CHECK (length(bound_id) > 0),
    request_hash   text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
    served         boolean NOT NULL,
    refusal_reason text,
    latency_ms     integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
    read_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT live_path_alpha_reads_bound_fk
        FOREIGN KEY (bound_id) REFERENCES prod.precomputed_alpha_bounds(bound_id),
    CONSTRAINT live_path_alpha_reads_outcome_consistency CHECK (
        (served = true AND refusal_reason IS NULL)
        OR (served = false AND refusal_reason IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS live_path_alpha_reads_path_idx
    ON prod.live_path_alpha_reads (live_path, read_at);

-- --- §10.3/§35.14 live-path artifact-boundary assertions --------------------

-- Heavy Alpha Lab mining, cross-fitting, replay, and adversarial sweeps never
-- run on a live path; imports flow only through the security `ImportGate` and
-- `sec.import_artifacts` and land in VALIDATING/SHADOW, never ACTIVE. The
-- assertion references the quarantine artifact BY ID (the import tables are
-- never duplicated here). Only IMPORT_SHADOW_ONLY carries that reference.
CREATE TABLE IF NOT EXISTS prod.artifact_boundary_assertions (
    assertion_id        text PRIMARY KEY CHECK (length(assertion_id) > 0),
    live_path           text NOT NULL CHECK (length(live_path) > 0),
    assertion_kind      text NOT NULL CHECK (assertion_kind IN (
                            'NO_HEAVY_JOB',
                            'NO_IMPORT',
                            'NO_PROVIDER_CALL',
                            'IMPORT_SHADOW_ONLY')),
    import_artifact_ref text,
    verdict             text NOT NULL CHECK (verdict IN ('PASS', 'REFUSE')),
    asserted_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT artifact_boundary_assertions_import_fk
        FOREIGN KEY (import_artifact_ref) REFERENCES sec.import_artifacts(artifact_id),
    CONSTRAINT artifact_boundary_assertions_import_ref_consistency CHECK (
        (assertion_kind = 'IMPORT_SHADOW_ONLY' AND import_artifact_ref IS NOT NULL)
        OR (assertion_kind <> 'IMPORT_SHADOW_ONLY' AND import_artifact_ref IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS artifact_boundary_assertions_path_idx
    ON prod.artifact_boundary_assertions (live_path, assertion_kind);
