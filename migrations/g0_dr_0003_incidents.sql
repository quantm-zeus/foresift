-- g0_dr_0003_incidents.sql
-- Durable recovery-incident records (FR-DR-001, §34.9–§34.10): a recovery
-- that misses a tier's RPO/RTO creates an incident; the affected capability
-- degrades until repair. Measurements and health states reference the
-- incident by id — this table owns its lifecycle (open → resolved).

CREATE TABLE recovery_incidents (
    incident_id text PRIMARY KEY,
    tier_id     text REFERENCES recovery_tiers(tier_id),
    opened_at   timestamptz NOT NULL,
    kind        text NOT NULL CHECK (kind IN (
                    'RPO_MISSED',
                    'RTO_MISSED',
                    'RPO_AND_RTO_MISSED',
                    'RESTORE_FAILED')),
    reason      text NOT NULL,
    resolved_at timestamptz,
    CONSTRAINT recovery_incidents_resolution_after_opening
        CHECK (resolved_at IS NULL OR resolved_at >= opened_at)
);
