-- g2_alert_0001_alert_state.sql
-- Alert lifecycle state: immutable per-class policy versions, §26.4 alert
-- records, and the fingerprint/cooldown ledger
-- (FR-ALERT-001, FR-ALERT-002, FR-ALERT-004).
--
-- Every table lives in the dedicated `alert` schema, never `public`
-- (ADR-G2ALERT-1): the recovery probe asserts the absence of unqualified
-- workflow/alert tables, and the admin/recovery packages get stable qualified
-- names. Additive only; no ALTER of any foreign family.

CREATE SCHEMA IF NOT EXISTS alert;

-- --- §26.1/§26.2 per-class policy versions ---------------------------------

-- One immutable policy version per alert class. A policy change inserts a NEW
-- row and then sets the OLD row's superseded_by exactly once; every other
-- rewrite (identity, class, ttl, cooldown, flags, thresholds, timestamps,
-- delete, truncate) is refused by the trigger below.
CREATE TABLE IF NOT EXISTS alert.alert_policies (
    policy_id               text PRIMARY KEY CHECK (length(policy_id) > 0),
    alert_class             text NOT NULL CHECK (alert_class IN (
                                'EARLY_WATCH',
                                'CONFIRMED_OPPORTUNITY',
                                'THESIS_STRENGTHENING',
                                'THESIS_WEAKENING',
                                'OPPORTUNITY_EXPIRED',
                                'RISK_ALERT')),
    version                 integer NOT NULL CHECK (version > 0),
    config_hash             text NOT NULL CHECK (config_hash ~ '^sha256:[0-9a-f]{64}$'),
    config                  jsonb NOT NULL,
    ttl_seconds             integer NOT NULL CHECK (ttl_seconds > 0),
    cooldown_seconds        integer NOT NULL CHECK (cooldown_seconds >= 0),
    -- FR-ALERT-002: only the confirmed-opportunity class may use
    -- high-conviction language; the renderer reads this flag, never a guess.
    high_conviction_allowed boolean NOT NULL DEFAULT false,
    -- FR-ALERT-005: confirmed-precision/recall denominator membership. EARLY_WATCH
    -- is never a member, so class-scoped denominators cannot be pooled by accident.
    confirmed_denominator   boolean NOT NULL DEFAULT false,
    thresholds              jsonb NOT NULL,
    superseded_by           text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alert_policies_class_version_unique UNIQUE (alert_class, version),
    CONSTRAINT alert_policies_superseded_by_fk
        FOREIGN KEY (superseded_by) REFERENCES alert.alert_policies(policy_id),
    -- ALERT-002 TTL/precision law: the TTL is a whole, strictly positive number
    -- of seconds, and an EARLY_WATCH watch expires strictly sooner than the
    -- default confirmed-opportunity TTL (3600 s), so a watch can never outlive
    -- the full-evidence class it is a low-commitment precursor of.
    CONSTRAINT alert_policies_early_watch_short_ttl CHECK (
        alert_class <> 'EARLY_WATCH' OR ttl_seconds < 3600
    )
);

CREATE INDEX IF NOT EXISTS alert_policies_class_idx
    ON alert.alert_policies (alert_class, version DESC);

-- Immutable by construction. TRUNCATE is handled FIRST: statement-level
-- truncate rows have no OLD/NEW, so a fall-through would compare all-NULL and
-- wrongly allow it. The ONLY legal UPDATE is a one-time supersede pointer:
-- superseded_by goes NULL -> non-null and every other column stays byte-identical.
CREATE OR REPLACE FUNCTION alert.foresift_alert_refuse_policy_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'alert policy versions are immutable: policy changes create a new version (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.policy_id IS DISTINCT FROM OLD.policy_id
        OR NEW.alert_class IS DISTINCT FROM OLD.alert_class
        OR NEW.version IS DISTINCT FROM OLD.version
        OR NEW.config_hash IS DISTINCT FROM OLD.config_hash
        OR NEW.config IS DISTINCT FROM OLD.config
        OR NEW.ttl_seconds IS DISTINCT FROM OLD.ttl_seconds
        OR NEW.cooldown_seconds IS DISTINCT FROM OLD.cooldown_seconds
        OR NEW.high_conviction_allowed IS DISTINCT FROM OLD.high_conviction_allowed
        OR NEW.confirmed_denominator IS DISTINCT FROM OLD.confirmed_denominator
        OR NEW.thresholds IS DISTINCT FROM OLD.thresholds
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.superseded_by IS NULL
        OR OLD.superseded_by IS NOT NULL
    THEN
        RAISE EXCEPTION 'alert policy versions are immutable: only a one-time supersede pointer may be set'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS alert_policies_no_rewrite ON alert.alert_policies;
CREATE TRIGGER alert_policies_no_rewrite
    BEFORE UPDATE OR DELETE ON alert.alert_policies
    FOR EACH ROW EXECUTE FUNCTION alert.foresift_alert_refuse_policy_rewrite();
DROP TRIGGER IF EXISTS alert_policies_no_truncate ON alert.alert_policies;
CREATE TRIGGER alert_policies_no_truncate
    BEFORE TRUNCATE ON alert.alert_policies
    FOR EACH STATEMENT EXECUTE FUNCTION alert.foresift_alert_refuse_policy_rewrite();
-- Schema hygiene: retire any pre-fix function that lived in `public` via
-- search_path.
DROP FUNCTION IF EXISTS public.foresift_alert_refuse_policy_rewrite();

-- --- §26.4 alert records ----------------------------------------------------

CREATE TABLE IF NOT EXISTS alert.alert_records (
    alert_id              text PRIMARY KEY CHECK (length(alert_id) > 0),
    decision_ref          text NOT NULL CHECK (length(decision_ref) > 0),
    run_ref               text NOT NULL CHECK (length(run_ref) > 0),
    alert_class           text NOT NULL CHECK (alert_class IN (
                              'EARLY_WATCH',
                              'CONFIRMED_OPPORTUNITY',
                              'THESIS_STRENGTHENING',
                              'THESIS_WEAKENING',
                              'OPPORTUNITY_EXPIRED',
                              'RISK_ALERT')),
    fingerprint           text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    thesis_version        integer NOT NULL CHECK (thesis_version >= 0),
    lifecycle_state       text NOT NULL CHECK (lifecycle_state IN (
                              'DISCOVERED',
                              'QUALIFIED',
                              'EMERGING',
                              'CONFIRMED',
                              'MONITORING',
                              'DECAYING',
                              'REJECTED',
                              'ARCHIVED')),
    risk_state            text NOT NULL CHECK (risk_state IN (
                              'UNKNOWN',
                              'LOW',
                              'MEDIUM',
                              'HIGH',
                              'CRITICAL',
                              'CONFLICTING')),
    severity              double precision NOT NULL CHECK (severity >= 0 AND severity <= 1),
    actionability_state   text NOT NULL CHECK (actionability_state IN (
                              'ACTIONABLE',
                              'EXPIRING',
                              'EXPIRED',
                              'CANCELLED')),
    valid_until           timestamptz NOT NULL,
    execution_assumptions jsonb NOT NULL,
    evidence_refs         jsonb NOT NULL,
    content_hash          text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    supersedes_alert_id   text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    -- A replacement alert points at the record it replaces; history is never
    -- rewritten in place.
    CONSTRAINT alert_records_supersedes_fk
        FOREIGN KEY (supersedes_alert_id) REFERENCES alert.alert_records(alert_id)
);

CREATE INDEX IF NOT EXISTS alert_records_class_created_idx
    ON alert.alert_records (alert_class, created_at);
CREATE INDEX IF NOT EXISTS alert_records_fingerprint_idx
    ON alert.alert_records (fingerprint, created_at);

-- --- §26.4 fingerprint/cooldown ledger -------------------------------------

-- Mutable ledger state (the ONLY mutable alert table): one row per §26.4
-- fingerprint recording the last delivered severity/thesis/material-evidence
-- hash and the per-class cooldown window. A repeat is allowed only when
-- severity, thesis, or material evidence changes beyond the class thresholds.
CREATE TABLE IF NOT EXISTS alert.alert_fingerprints (
    fingerprint                 text PRIMARY KEY CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    alert_class                 text NOT NULL CHECK (alert_class IN (
                                    'EARLY_WATCH',
                                    'CONFIRMED_OPPORTUNITY',
                                    'THESIS_STRENGTHENING',
                                    'THESIS_WEAKENING',
                                    'OPPORTUNITY_EXPIRED',
                                    'RISK_ALERT')),
    last_alert_id               text NOT NULL CHECK (length(last_alert_id) > 0),
    last_severity               double precision NOT NULL CHECK (last_severity >= 0 AND last_severity <= 1),
    last_thesis_version         integer NOT NULL CHECK (last_thesis_version >= 0),
    last_material_evidence_hash text NOT NULL CHECK (last_material_evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
    last_delivered_at           timestamptz,
    cooldown_until              timestamptz NOT NULL,
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_fingerprints_class_cooldown_idx
    ON alert.alert_fingerprints (alert_class, cooldown_until);
