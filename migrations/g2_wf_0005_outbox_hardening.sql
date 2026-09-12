-- g2_wf_0005_outbox_hardening.sql
-- Hardening for the §26.5 transactional outbox and the §33.6 forecast store
-- (FR-WF-004, FR-WF-006; AC-063). Additive only; no ALTER of an applied
-- migration's statements and no rewrite of an applied migration.
--
-- 1. `wf.notification_outbox.decision_ref` / `.alert_ref` gain their missing
--    foreign keys, so §26.5's "a committed outbox row always has its decision
--    and alert" invariant is enforced at the storage layer and not only by the
--    `commitDecisionWithOutbox` application path. `decision_ref` is NOT NULL,
--    `alert_ref` is nullable (a row may legitimately have no alert record).
-- 2. `wf.schedule_forecasts` becomes immutable: a forecast is a frozen artifact
--    backing the AC-063 freshness/version binding, so corrections are NEW rows,
--    never an in-place rewrite (an UPDATE of `computed_at` previously made a
--    stale forecast look fresh).
--
-- All tables live in the dedicated `wf` schema (ADR-G2WF-1).

-- --- 1. §26.5 outbox reference integrity ------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'notification_outbox_decision_ref_fk'
          AND conrelid = 'wf.notification_outbox'::regclass
    ) THEN
        ALTER TABLE wf.notification_outbox
            ADD CONSTRAINT notification_outbox_decision_ref_fk
            FOREIGN KEY (decision_ref) REFERENCES wf.decision_commits(decision_id);
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'notification_outbox_alert_ref_fk'
          AND conrelid = 'wf.notification_outbox'::regclass
    ) THEN
        ALTER TABLE wf.notification_outbox
            ADD CONSTRAINT notification_outbox_alert_ref_fk
            FOREIGN KEY (alert_ref) REFERENCES wf.alert_records(alert_id);
    END IF;
END;
$$;

-- The delivery workers resolve the owning run through `decision_ref`, so this
-- reference is read on every claim.
CREATE INDEX IF NOT EXISTS notification_outbox_decision_ref_idx
    ON wf.notification_outbox (decision_ref);

-- --- 2. §33.6 forecast immutability -----------------------------------------

-- A forecast is a frozen artifact: the AC-063 gate trusts its `computed_at`
-- and `version_id`, so mutating either in place would let a stale/foreign
-- forecast re-enable a schedule. UPDATE, DELETE, and TRUNCATE are all refused;
-- a correction is a NEW `schedule_forecasts` row.
CREATE OR REPLACE FUNCTION wf.foresift_wf_refuse_forecast_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'schedule forecasts are immutable: corrections create a new forecast (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'schedule forecasts are immutable: corrections create a new forecast (update refused)'
        USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schedule_forecasts_no_rewrite ON wf.schedule_forecasts;
CREATE TRIGGER schedule_forecasts_no_rewrite
    BEFORE UPDATE OR DELETE ON wf.schedule_forecasts
    FOR EACH ROW EXECUTE FUNCTION wf.foresift_wf_refuse_forecast_rewrite();
DROP TRIGGER IF EXISTS schedule_forecasts_no_truncate ON wf.schedule_forecasts;
CREATE TRIGGER schedule_forecasts_no_truncate
    BEFORE TRUNCATE ON wf.schedule_forecasts
    FOR EACH STATEMENT EXECUTE FUNCTION wf.foresift_wf_refuse_forecast_rewrite();
