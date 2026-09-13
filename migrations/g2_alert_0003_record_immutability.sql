-- g2_alert_0003_record_immutability.sql
-- Alert-record classification immutability (FR-ALERT-001/004, ADR-G2ALERT-1/2).
--
-- `alert.alert_records` is the §26.4 re-assessment source: a changed
-- classification is a NEW record that supersedes the old one, never an in-place
-- rewrite. The only legal mutation is the clock/event-driven actionability
-- transition (`transitionAlertActionability`). This mirrors the
-- `alert.alert_policies` immutability law from 0001, including the explicit
-- `TG_OP IN ('DELETE','TRUNCATE')` branch: TRUNCATE is handled first because a
-- statement-level truncate row has no OLD/NEW and a fall-through would compare
-- all-NULL and wrongly allow it.
--
-- Additive only; no ALTER of any existing column and no change to any other
-- family. The Drizzle mirror needs no update because no column changed.

CREATE OR REPLACE FUNCTION alert.foresift_alert_refuse_record_rewrite() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'alert records are immutable: a reassessment records a new record (delete/truncate refused)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.alert_id IS DISTINCT FROM OLD.alert_id
        OR NEW.decision_ref IS DISTINCT FROM OLD.decision_ref
        OR NEW.run_ref IS DISTINCT FROM OLD.run_ref
        OR NEW.alert_class IS DISTINCT FROM OLD.alert_class
        OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
        OR NEW.thesis_version IS DISTINCT FROM OLD.thesis_version
        OR NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state
        OR NEW.risk_state IS DISTINCT FROM OLD.risk_state
        OR NEW.severity IS DISTINCT FROM OLD.severity
        OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
        OR NEW.execution_assumptions IS DISTINCT FROM OLD.execution_assumptions
        OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
        OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
        OR NEW.supersedes_alert_id IS DISTINCT FROM OLD.supersedes_alert_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'alert record classification fields are immutable: only actionability_state may transition'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS alert_records_no_rewrite ON alert.alert_records;
CREATE TRIGGER alert_records_no_rewrite
    BEFORE UPDATE OR DELETE ON alert.alert_records
    FOR EACH ROW EXECUTE FUNCTION alert.foresift_alert_refuse_record_rewrite();
DROP TRIGGER IF EXISTS alert_records_no_truncate ON alert.alert_records;
CREATE TRIGGER alert_records_no_truncate
    BEFORE TRUNCATE ON alert.alert_records
    FOR EACH STATEMENT EXECUTE FUNCTION alert.foresift_alert_refuse_record_rewrite();
-- Schema hygiene: retire any pre-fix function that lived in `public` via
-- search_path.
DROP FUNCTION IF EXISTS public.foresift_alert_refuse_record_rewrite();
