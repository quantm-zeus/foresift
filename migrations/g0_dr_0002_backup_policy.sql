-- g0_dr_0002_backup_policy.sql
-- Durable backup governance, restore drills, and machine-readable recovery
-- health (FR-DR-002, §34.5–§34.9).
--
-- Key separation is structural: policies store an opaque `key_reference`
-- (`keyref:` prefix) into a separately protected keystore — never key material.

CREATE TABLE backup_policies (
    policy_id        text PRIMARY KEY,
    retention_days   integer NOT NULL CHECK (retention_days >= 1),
    encryption_status text NOT NULL,
    location_ref     text NOT NULL,
    rights_ref       text NOT NULL,
    legal_hold       boolean NOT NULL DEFAULT false,
    deletion_policy  text NOT NULL,
    key_reference    text NOT NULL CHECK (key_reference ~ '^keyref:[A-Za-z0-9._/-]+$'),
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT backup_policies_nonempty_governance_refs
        CHECK (length(trim(encryption_status)) > 0
           AND length(trim(location_ref)) > 0
           AND length(trim(rights_ref)) > 0
           AND length(trim(deletion_policy)) > 0)
);

CREATE TABLE backup_runs (
    run_id         text PRIMARY KEY,
    policy_id      text NOT NULL REFERENCES backup_policies(policy_id),
    started_at     timestamptz NOT NULL,
    finished_at    timestamptz,
    status         text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    artifact_refs  text[] NOT NULL DEFAULT ARRAY[]::text[],
    failure_reason text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT backup_runs_success_is_complete
        CHECK (status <> 'SUCCEEDED' OR (finished_at IS NOT NULL AND array_length(artifact_refs, 1) >= 1)),
    CONSTRAINT backup_runs_failure_has_reason
        CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL)
);

-- Clean-environment restore drills (AC-261): the DDL structurally requires a
-- PASSED outcome to carry the separately provided credential provider and
-- completion; "all recorded checks green" is additionally enforced by the
-- restore-drill runtime (drill/restore.ts), not by this table.
CREATE TABLE restore_drills (
    drill_id                    text PRIMARY KEY,
    started_at                  timestamptz NOT NULL,
    finished_at                 timestamptz,
    outcome                     text NOT NULL CHECK (outcome IN ('PASSED', 'FAILED', 'BLOCKED')),
    checks                      jsonb NOT NULL DEFAULT '[]'::jsonb,
    credential_provider_present boolean NOT NULL DEFAULT false,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT restore_drills_passed_requires_credentials_and_completion
        CHECK (outcome <> 'PASSED' OR (
            credential_provider_present IS TRUE AND finished_at IS NOT NULL))
);

CREATE TABLE recovery_health_states (
    health_state_id                        text PRIMARY KEY,
    capability                             text NOT NULL,
    kind                                   text NOT NULL CHECK (kind IN ('HEALTHY', 'DEGRADED')),
    confirmed_opportunity_influence_blocked boolean NOT NULL,
    deterministic_risk_monitoring_allowed   boolean NOT NULL,
    incident_id                            text,
    evaluated_at                           timestamptz NOT NULL,
    reason                                 text NOT NULL,
    CONSTRAINT recovery_health_degraded_requires_incident_and_block
        CHECK (kind <> 'DEGRADED' OR (incident_id IS NOT NULL AND confirmed_opportunity_influence_blocked)),
    CONSTRAINT recovery_health_healthy_has_no_incident
        CHECK (kind <> 'HEALTHY' OR incident_id IS NULL),
    -- Risk monitoring is never suppressed alongside opportunity influence.
    CONSTRAINT recovery_health_preserves_risk_monitoring
        CHECK (deterministic_risk_monitoring_allowed)
);
