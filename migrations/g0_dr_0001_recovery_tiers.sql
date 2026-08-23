-- g0_dr_0001_recovery_tiers.sql
-- Tiered recovery objectives (FR-DR-001, §34.4): the strictest applicable
-- default governs; deployments may configure stricter targets — never looser.
-- Ceilings: critical metadata <= 15 min RPO; critical observations and
-- checkpoints <= 60 min; replayable raw payloads <= 24 h when rights permit
-- reconstruction. The protected-asset registry maps every table/store created
-- by this package onto its covering tier.

CREATE TABLE recovery_tiers (
    tier_id           text PRIMARY KEY,
    data_class        text NOT NULL CHECK (data_class IN (
                          'CRITICAL_METADATA',
                          'CRITICAL_OBSERVATIONS_CHECKPOINTS',
                          'REPLAYABLE_RAW_PAYLOADS')),
    rpo_target_minutes numeric NOT NULL,
    rto_target_minutes numeric NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recovery_tiers_positive_targets
        CHECK (rpo_target_minutes > 0 AND rto_target_minutes > 0),
    CONSTRAINT recovery_tiers_rpo_within_ceiling
        CHECK (rpo_target_minutes <= CASE data_class
            WHEN 'CRITICAL_METADATA' THEN 15
            WHEN 'CRITICAL_OBSERVATIONS_CHECKPOINTS' THEN 60
            WHEN 'REPLAYABLE_RAW_PAYLOADS' THEN 1440
        END)
);

CREATE TABLE protected_assets (
    asset_key  text PRIMARY KEY,
    data_class text NOT NULL CHECK (data_class IN (
                   'CRITICAL_METADATA',
                   'CRITICAL_OBSERVATIONS_CHECKPOINTS',
                   'REPLAYABLE_RAW_PAYLOADS')),
    tier_id    text NOT NULL REFERENCES recovery_tiers(tier_id),
    registered_at timestamptz NOT NULL DEFAULT now()
);

-- §34.10: recovery MUST NOT backdate observations; measured outcomes of
-- drills are recorded per tier for RPO/RTO evaluation.
CREATE TABLE tier_measurements (
    measurement_id       text PRIMARY KEY,
    tier_id              text NOT NULL REFERENCES recovery_tiers(tier_id),
    achieved_rpo_minutes numeric NOT NULL CHECK (achieved_rpo_minutes >= 0),
    achieved_rto_minutes numeric NOT NULL CHECK (achieved_rto_minutes >= 0),
    outcome              text NOT NULL CHECK (outcome IN (
                             'WITHIN_TIER', 'MISSED_RPO', 'MISSED_RTO', 'MISSED_BOTH')),
    incident_id          text,
    measured_at          timestamptz NOT NULL,
    CONSTRAINT tier_measurements_incident_on_miss
        CHECK (outcome = 'WITHIN_TIER' OR incident_id IS NOT NULL)
);
