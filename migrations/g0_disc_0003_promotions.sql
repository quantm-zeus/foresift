-- g0_disc_0003_promotions.sql
-- Rollback: DROP TABLE disc.promotion_decisions;
-- Deterministic, versioned cheap-monitor promotion decisions (FR-DISC-005,
-- §63.6, §63.9, Appendix O.4). A replay with the same canonical inputs hash
-- resolves to the already-recorded decision rather than creating a new row.

CREATE SCHEMA IF NOT EXISTS disc;

CREATE TABLE disc.promotion_decisions (
    promotion_decision_id    text PRIMARY KEY,
    candidate_id             text NOT NULL CHECK (length(candidate_id) > 0),
    frozen_feature_versions  jsonb NOT NULL CHECK (
                                 jsonb_typeof(frozen_feature_versions) = 'object'
                                 AND frozen_feature_versions <> '{}'::jsonb),
    policy_version           text NOT NULL CHECK (length(policy_version) > 0),
    inputs_hash              text NOT NULL UNIQUE CHECK (inputs_hash ~ '^sha256:.+$'),
    decision                 text NOT NULL CHECK (decision IN (
                                 'REJECT_CHEAP',
                                 'MONITOR_CHEAP',
                                 'PROMOTE_TO_VERIFY')),
    decided_at               timestamptz NOT NULL,
    decision_version         text NOT NULL CHECK (length(decision_version) > 0)
);

CREATE INDEX promotion_decisions_candidate_time_idx
    ON disc.promotion_decisions (candidate_id, decided_at);

-- The feature/policy/input bundle is frozen historical decision truth.
-- Re-evaluation writes a new versioned row with a new inputs hash.
CREATE TRIGGER promotion_decisions_append_only
    BEFORE UPDATE OR DELETE ON disc.promotion_decisions
    FOR EACH ROW EXECUTE FUNCTION disc.refuse_mutation();

CREATE TRIGGER promotion_decisions_immutable_truncate
    BEFORE TRUNCATE ON disc.promotion_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION disc.refuse_mutation();
