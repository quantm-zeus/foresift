-- g2_alert_0002_updates_metrics.sql
-- Explicit update/cancellation notifications for prior actionable alerts and
-- the class-scoped metric observations
-- (FR-ALERT-004, FR-ALERT-005, AC-140, AC-141).
--
-- Additive only; no ALTER of a foreign family, no rewrite of an applied
-- migration. All tables live in the dedicated `alert` schema (ADR-G2ALERT-1).

-- --- §26.2/§26.4 update / cancellation notifications -----------------------

CREATE TABLE IF NOT EXISTS alert.alert_updates (
    update_id       text PRIMARY KEY CHECK (length(update_id) > 0),
    prior_alert_ref text NOT NULL CHECK (length(prior_alert_ref) > 0),
    update_kind     text NOT NULL CHECK (update_kind IN (
                        'MATERIAL_DETERIORATION',
                        'CANCELLATION',
                        'EXPIRY',
                        'RISK')),
    fingerprint     text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    -- The deterministic idempotency key is (prior_alert, update_kind,
    -- fingerprint, thesis_version); a replayed update collapses onto the
    -- existing row instead of producing a second notification (AC-141).
    idempotency_key text NOT NULL CHECK (length(idempotency_key) > 0),
    alert_ref       text NOT NULL CHECK (length(alert_ref) > 0),
    outbox_ref      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alert_updates_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS alert_updates_prior_idx
    ON alert.alert_updates (prior_alert_ref, created_at);

-- --- FR-ALERT-005 class-scoped metric observations -------------------------

-- Every observation is bound to exactly one alert class, and the metric key
-- must belong to that class (the composite class-scope CHECK below mirrors
-- ALERT_METRIC_KEYS_BY_CLASS in packages/domain/src/alert.ts). EARLY_WATCH and
-- CONFIRMED_OPPORTUNITY share no key, so a pooled cross-class denominator is
-- impossible at the storage layer.
CREATE TABLE IF NOT EXISTS alert.alert_metric_observations (
    metric_id    text PRIMARY KEY CHECK (length(metric_id) > 0),
    alert_class  text NOT NULL CHECK (alert_class IN (
                     'EARLY_WATCH',
                     'CONFIRMED_OPPORTUNITY',
                     'THESIS_STRENGTHENING',
                     'THESIS_WEAKENING',
                     'OPPORTUNITY_EXPIRED',
                     'RISK_ALERT')),
    metric_key   text NOT NULL CHECK (metric_key IN (
                     'EARLY_WATCH_PRECISION',
                     'EARLY_WATCH_RECALL',
                     'CONFIRMED_PRECISION',
                     'CONFIRMED_RECALL',
                     'THESIS_STRENGTHENING_RECALL',
                     'THESIS_WEAKENING_RECALL',
                     'EXPIRY_TIMELINESS',
                     'RISK_PRECISION',
                     'RISK_RECALL')),
    numerator    integer NOT NULL CHECK (numerator >= 0),
    denominator  integer NOT NULL CHECK (denominator >= 0),
    sample_size  integer NOT NULL CHECK (sample_size >= 0),
    window_start timestamptz NOT NULL,
    window_end   timestamptz NOT NULL,
    observed_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alert_metric_observations_numerator_within_denominator
        CHECK (numerator <= denominator),
    CONSTRAINT alert_metric_observations_sample_within_denominator
        CHECK (sample_size <= denominator),
    CONSTRAINT alert_metric_observations_window_order
        CHECK (window_end > window_start),
    CONSTRAINT alert_metric_observations_class_scope CHECK (
        (alert_class = 'EARLY_WATCH'
            AND metric_key IN ('EARLY_WATCH_PRECISION', 'EARLY_WATCH_RECALL'))
        OR (alert_class = 'CONFIRMED_OPPORTUNITY'
            AND metric_key IN ('CONFIRMED_PRECISION', 'CONFIRMED_RECALL'))
        OR (alert_class = 'THESIS_STRENGTHENING'
            AND metric_key IN ('THESIS_STRENGTHENING_RECALL'))
        OR (alert_class = 'THESIS_WEAKENING'
            AND metric_key IN ('THESIS_WEAKENING_RECALL'))
        OR (alert_class = 'OPPORTUNITY_EXPIRED'
            AND metric_key IN ('EXPIRY_TIMELINESS'))
        OR (alert_class = 'RISK_ALERT'
            AND metric_key IN ('RISK_PRECISION', 'RISK_RECALL'))
    )
);

CREATE INDEX IF NOT EXISTS alert_metric_observations_class_idx
    ON alert.alert_metric_observations (alert_class, observed_at);
