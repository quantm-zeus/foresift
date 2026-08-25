-- g0_sec_0004_incidents_pauses.sql
-- Security incidents, capability pauses, and the activation-event ledger
-- (FR-SEC-011, §34, §35.9; AC-278, AC-279).
--
-- Rules encoded here:
--   * incidents carry the SEV1..SEV4 severity taxonomy, an owner, a kind,
--     containment state, evidence references (>= 1 — an incident without
--     preserved evidence is not recordable), notification-policy flags, and
--     recovery-verification/postmortem/regression-test linkage.
--   * capability pauses capture the SMALLEST affected scope with a durable
--     reason linked to its opening incident; resumed_at NULL means paused.
--     Resume requires BOTH the instant and the explicit auditing actor
--     (machine-checked auto-reactivation refusal lives in the typed layer).
--   * activation_events is an APPEND-ONLY ledger (SQL trigger refuses
--     UPDATE/DELETE) of activate/rollback events over immutable approved-set
--     snapshot references, with actionable-candidate re-evaluation markers.

CREATE TABLE sec.security_incidents (
    incident_id          text PRIMARY KEY,
    kind                 text NOT NULL CHECK (kind IN (
                            'AUDIT_CHAIN_FAILURE',
                            'CREDENTIAL_COMPROMISE',
                            'INTRUSION_SUSPECTED',
                            'DATA_LEAKAGE',
                            'DEPENDENCY_COMPROMISE',
                            'ABUSE_CAMPAIGN',
                            'OTHER')),
    severity             text NOT NULL CHECK (severity IN ('SEV1', 'SEV2', 'SEV3', 'SEV4')),
    owner                text NOT NULL,
    opened_at            timestamptz NOT NULL,
    containment          text NOT NULL DEFAULT 'OPEN' CHECK (containment IN (
                            'OPEN', 'CONTAINED', 'RECOVERY_VERIFIED', 'RESOLVED')),
    evidence_refs        jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'
                            AND jsonb_array_length(evidence_refs) >= 1),
    notification_flags   jsonb NOT NULL CHECK (jsonb_typeof(notification_flags) = 'object'),
    recovery_verified_at timestamptz,
    postmortem_ref       text,
    regression_test_ref  text,
    resolved_at          timestamptz,
    CONSTRAINT security_incidents_resolution_after_opening CHECK (
        resolved_at IS NULL OR resolved_at >= opened_at),
    CONSTRAINT security_incidents_resolved_requires_instant CHECK (
        containment <> 'RESOLVED' OR resolved_at IS NOT NULL)
);

CREATE TABLE sec.capability_pauses (
    pause_id            text PRIMARY KEY,
    scope               text NOT NULL,
    reason              text NOT NULL,
    opening_incident_id text NOT NULL REFERENCES sec.security_incidents(incident_id),
    paused_at           timestamptz NOT NULL,
    resumed_at          timestamptz,
    resumed_by_actor    text,
    CONSTRAINT capability_pauses_resume_pair CHECK (
        (resumed_at IS NULL) = (resumed_by_actor IS NULL)),
    CONSTRAINT capability_pauses_resume_after_pause CHECK (
        resumed_at IS NULL OR resumed_at >= paused_at)
);

CREATE TABLE sec.activation_events (
    event_id                 text PRIMARY KEY,
    event_type               text NOT NULL CHECK (event_type IN (
                               'ACTIVATE',
                               'ROLLBACK_RESTORE',
                               'ROLLBACK',
                               'RESUME_AFTER_RE_EVALUATION')),
    scope                    text NOT NULL,
    at                       timestamptz NOT NULL,
    actor                    text NOT NULL,
    approved_set_snapshot_ref text NOT NULL,
    restored_from_event_id   text REFERENCES sec.activation_events(event_id),
    reevaluation_marker      text,
    recorded_seq             bigint GENERATED ALWAYS AS IDENTITY,
    CONSTRAINT activation_events_restore_needs_origin CHECK (
        event_type <> 'ROLLBACK_RESTORE' OR restored_from_event_id IS NOT NULL)
);

CREATE TRIGGER activation_events_append_only
    BEFORE UPDATE OR DELETE ON sec.activation_events
    FOR EACH ROW EXECUTE FUNCTION sec.refuse_mutation();

-- Row-level triggers do not fire on TRUNCATE; refuse it statement-wise too,
-- so the activation ledger cannot be wiped without residue.
CREATE TRIGGER activation_events_immutable_truncate
    BEFORE TRUNCATE ON sec.activation_events
    FOR EACH STATEMENT EXECUTE FUNCTION sec.refuse_mutation();
